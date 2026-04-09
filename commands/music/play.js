/**
 * Core Game Bot — /play Command (FINAL PRODUCTION)
 * Uses yt-dlp with YouTube cookies from env var
 * ONE-TIME SETUP: paste browser cookie → Railway env var → done forever
 * Supports: URL + search + queue + skip
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const colors = require('../../config/colors');

const COOKIES_PATH = path.join(__dirname, '..', '..', 'yt_cookies.txt');

// Queue per server
const queues = new Map();

// Write cookies file from env var (runs once on first play)
let cookiesReady = false;
function ensureCookies() {
  if (cookiesReady) return;
  cookiesReady = true;

  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) {
    console.log('[Music] ⚠️ No YOUTUBE_COOKIES env var — YouTube will be blocked');
    return;
  }

  // Convert browser cookie string to Netscape format for yt-dlp
  const lines = ['# Netscape HTTP Cookie File', '# Generated from browser cookies', ''];
  const pairs = raw.split(';').map(s => s.trim()).filter(Boolean);

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.substring(0, idx).trim();
    const value = pair.substring(idx + 1).trim();
    if (name && value) {
      const exp = Math.floor(Date.now() / 1000) + 365 * 86400; // 1 year
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t${exp}\t${name}\t${value}`);
    }
  }

  fs.writeFileSync(COOKIES_PATH, lines.join('\n'), 'utf-8');
  console.log(`[Music] ✅ Cookies written (${pairs.length} cookies)`);
}

// Get audio info from YouTube
async function getAudioInfo(query) {
  ensureCookies();

  const isUrl = query.startsWith('http');
  let videoUrl = query;
  let title;

  // Build yt-dlp options
  const baseOpts = {
    dumpSingleJson: true,
    noWarnings: true,
    format: 'bestaudio/best',
  };

  // Add cookies if available
  if (fs.existsSync(COOKIES_PATH)) {
    baseOpts.cookies = COOKIES_PATH;
  }

  if (!isUrl) {
    // Search YouTube
    console.log(`[Music] Searching: "${query}"`);
    const searchOpts = { ...baseOpts };
    delete searchOpts.format; // Don't need format for search
    const result = await ytdlp(`ytsearch1:${query}`, searchOpts);
    const entry = result.entries?.[0] || result;
    videoUrl = entry.webpage_url || entry.url;
    title = entry.title;
    console.log(`[Music] Found: "${title}" → ${videoUrl}`);
  }

  // Get audio stream
  console.log(`[Music] Getting audio: ${videoUrl}`);
  const info = await ytdlp(videoUrl, baseOpts);

  return {
    title: title || info.title || 'YouTube Audio',
    audioUrl: info.url,
    videoUrl: info.webpage_url || videoUrl,
    duration: info.duration_string || formatSec(info.duration),
    thumbnail: info.thumbnail,
  };
}

// Play current song in queue — pipe through ffmpeg for real-time streaming
function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}"`);
  console.log(`▶ Audio URL: ${song.audioUrl?.substring(0, 80)}...`);

  try {
    // Spawn ffmpeg to read the YouTube URL and output OGG/Opus for Discord
    const ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', song.audioUrl,
      '-vn',               // no video
      '-c:a', 'libopus',   // Discord uses Opus
      '-f', 'ogg',         // OGG container
      '-ar', '48000',      // 48kHz sample rate
      '-ac', '2',          // stereo
      '-b:a', '128k',      // 128kbps bitrate
      'pipe:1',            // output to stdout
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ffmpeg.stderr.on('data', (data) => {
      // Only log errors, not progress
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error('[FFmpeg]', msg.substring(0, 200));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('[FFmpeg] Spawn error:', err.message);
    });

    // Store ffmpeg process so we can kill it on skip/stop
    queue.ffmpeg = ffmpeg;

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
    });

    queue.player.play(resource);
  } catch (err) {
    console.error('[Music] Play error:', err.message);
    queue.songs.shift();
    if (queue.songs.length > 0) playSong(queue);
    else { queue.connection.destroy(); queues.delete(queue.guildId); }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music in voice — لێدانی مۆسیقا لە ڤۆیس')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name or YouTube URL — ناوی گۆرانی یان لینک')
        .setRequired(true)
    ),

  queues,
  getAudioInfo,
  playSong,

  async execute(interaction) {
    const query = (interaction.options.getString('query') || interaction.options.getString('url') || '').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!query) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const info = await getAudioInfo(query);

      if (!info.audioUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ No audio stream found.')
            .setColor(colors.ERROR)],
        });
      }

      // Get or create queue
      let queue = queues.get(interaction.guild.id);

      if (!queue) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        } catch {
          connection.destroy();
          return interaction.editReply({
            embeds: [new EmbedBuilder().setDescription('❌ Cannot join voice!').setColor(colors.ERROR)],
          });
        }

        const player = createAudioPlayer();
        connection.subscribe(player);

        queue = { connection, player, songs: [], channel: interaction.channel, guildId: interaction.guild.id };
        queues.set(interaction.guild.id, queue);

        player.on(AudioPlayerStatus.Idle, () => {
          queue.songs.shift();
          if (queue.songs.length > 0) {
            playSong(queue);
            queue.channel.send({
              embeds: [new EmbedBuilder()
                .setTitle('🎵 Now Playing')
                .setDescription(`🎶 **${queue.songs[0].title}**\n⏱️ \`${queue.songs[0].duration}\``)
                .setColor(colors.ACCENT)],
            }).catch(() => {});
          } else {
            console.log('■ Queue empty, leaving voice.');
            queue.connection.destroy();
            queues.delete(interaction.guild.id);
          }
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch { connection.destroy(); queues.delete(interaction.guild.id); }
        });
      }

      // Add to queue
      queue.songs.push(info);

      if (queue.songs.length === 1) {
        playSong(queue);
        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${info.title}**\n\n⏱️ \`${info.duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(info.videoUrl)
          .setFooter({ text: '/skip • /queue • /stop' })
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${info.title}**\n📌 #${queue.songs.length} • ⏱️ \`${info.duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] ERROR:', error.message);

      const needsCookies = error.stderr?.includes('Sign in') || error.message?.includes('Sign in');

      if (needsCookies) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('🔑 YouTube Setup Required (one time)')
            .setDescription([
              '**YouTube requires authentication on cloud servers.**\n',
              '**Setup (20 seconds):**',
              '1️⃣ Open **youtube.com** in Chrome (stay logged in)',
              '2️⃣ Press **F12** → **Console** tab',
              '3️⃣ Type: `copy(document.cookie)` → Enter',
              '4️⃣ Go to **Railway** → Variables',
              '5️⃣ Add: `YOUTUBE_COOKIES` → **Ctrl+V** → Save',
              '',
              '✅ Done! Bot restarts and ALL songs work forever.',
            ].join('\n'))
            .setColor(0xFFA500)],
        });
      } else {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Playback Error')
            .setDescription('Could not play. Try again.\n\nتاقی بکەرەوە.')
            .setColor(colors.ERROR)],
        }).catch(() => {});
      }
    }
  },
};

function formatSec(s) {
  if (!s) return 'Live 🔴';
  s = parseInt(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

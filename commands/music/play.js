/**
 * Core Game Bot — /play Command (FINAL - NO COOKIES)
 * Uses yt-dlp with bypass arguments — works on datacenter IPs without login
 * Like pro bots: anonymous public access, no account needed
 * Supports: URL + search + queue + skip
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType,
} = require('@discordjs/voice');
const { spawn, execSync } = require('child_process');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Find yt-dlp binary path
function getYtdlpPath() {
  try {
    // Try system yt-dlp first (from nixpacks)
    return execSync('which yt-dlp 2>/dev/null || where yt-dlp 2>nul', { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {
    // Fallback to node_modules
    const path = require('path');
    const fs = require('fs');
    const modPath = path.join(__dirname, '..', '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
    if (fs.existsSync(modPath)) return modPath;
    const modPath2 = modPath + '.exe';
    if (fs.existsSync(modPath2)) return modPath2;
    return 'yt-dlp'; // hope it's in PATH
  }
}

const YTDLP = getYtdlpPath();
console.log(`[Music] yt-dlp binary: ${YTDLP}`);

// Run yt-dlp as child process and return JSON
function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`yt-dlp exit ${code}`);
        err.stderr = stderr;
        return reject(err);
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`JSON parse failed: ${stdout.substring(0, 100)}`));
      }
    });

    proc.on('error', reject);

    // Timeout after 30 seconds
    setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
  });
}

// Get audio info from YouTube — NO COOKIES, uses bypass arguments
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');
  let videoUrl = query;
  let title;

  // Base yt-dlp arguments — bypass bot detection without cookies
  const baseArgs = [
    '--dump-single-json',
    '--no-warnings',
    '--no-check-certificates',
    '--format', 'bestaudio[ext=webm]/bestaudio/best',
    '--extractor-args', 'youtube:player_client=mediaconnect,tv_embedded',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '--geo-bypass',
    '--no-playlist',
  ];

  if (!isUrl) {
    // Search YouTube
    console.log(`[Music] Searching: "${query}"`);
    const result = await runYtdlp([...baseArgs, `ytsearch1:${query}`]);
    const entry = result.entries?.[0] || result;
    videoUrl = entry.webpage_url || entry.url;
    title = entry.title;
    console.log(`[Music] Found: "${title}" → ${videoUrl}`);
  }

  // Get audio stream URL
  console.log(`[Music] Getting audio: ${videoUrl}`);
  const info = await runYtdlp([...baseArgs, videoUrl]);

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
      if (error.stderr) console.error('[Music] stderr:', error.stderr.substring(0, 300));

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try again.\n\nتاقی بکەرەوە.')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

function formatSec(s) {
  if (!s) return 'Live 🔴';
  s = parseInt(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

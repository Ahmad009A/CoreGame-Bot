/**
 * Core Game Bot — /play Command
 * Hybrid approach like pro bots:
 * - play-dl for instant YouTube search (native Node.js, no CLI)
 * - yt-dlp for getting audio stream URL (handles YouTube changes)
 * - ffmpeg for real-time streaming to Discord (OGG/Opus)
 * No cookies, no account. Anonymous public access.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType, NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const { spawn } = require('child_process');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// ── Get audio URL using yt-dlp (handles all YouTube changes) ──
function getAudioUrl(videoUrl) {
  return new Promise((resolve, reject) => {
    // yt-dlp prints the direct audio stream URL
    const proc = spawn('yt-dlp', [
      '--get-url',
      '--format', 'bestaudio',
      '--no-warnings',
      '--no-check-certificates',
      '--no-playlist',
      videoUrl,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
      const url = stdout.trim().split('\n')[0];
      if (code === 0 && url && url.startsWith('http')) {
        resolve(url);
      } else {
        reject(new Error(`yt-dlp failed (${code}): ${stderr.substring(0, 200)}`));
      }
    });

    proc.on('error', reject);
    setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
  });
}

// ── Search YouTube using play-dl (instant, native Node.js) ──
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');
  let title, videoUrl, duration, thumbnail;

  if (isUrl) {
    console.log(`[Music] URL: ${query}`);
    try {
      const type = await play.validate(query);
      if (type === 'yt_video') {
        const info = await play.video_info(query);
        const v = info.video_details;
        title = v.title;
        videoUrl = v.url;
        duration = v.durationRaw || 'Live 🔴';
        thumbnail = v.thumbnails?.[0]?.url;
      }
    } catch (e) {
      console.log('[Music] play-dl URL info failed, using raw URL');
    }
    // If play-dl failed, use the raw URL
    if (!videoUrl) videoUrl = query;
    if (!title) title = 'YouTube Audio';
  } else {
    // Search YouTube (fast, native Node.js)
    console.log(`[Music] Searching: "${query}"`);
    const results = await play.search(query, { limit: 1 });
    if (results.length === 0) throw new Error('No results found');

    const v = results[0];
    title = v.title;
    videoUrl = v.url;
    duration = v.durationRaw || '?';
    thumbnail = v.thumbnails?.[0]?.url;
    console.log(`[Music] Found: "${title}"`);
  }

  // Get the direct audio stream URL using yt-dlp
  console.log(`[Music] Getting audio URL via yt-dlp...`);
  const audioUrl = await getAudioUrl(videoUrl);
  console.log(`[Music] Audio URL ready: ${audioUrl.substring(0, 80)}...`);

  return { title, videoUrl, audioUrl, duration: duration || '?', thumbnail };
}

// ── Play song: ffmpeg reads audio URL → outputs Opus → pipes to Discord ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}"`);

  try {
    // Spawn ffmpeg: reads the direct audio URL, outputs OGG/Opus for Discord
    const ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', song.audioUrl,
      '-vn',              // no video
      '-c:a', 'libopus',  // Discord Opus codec
      '-f', 'ogg',        // OGG container
      '-ar', '48000',     // 48kHz
      '-ac', '2',         // stereo
      '-b:a', '128k',     // 128kbps quality
      'pipe:1',           // output to stdout
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error') || msg.includes('403')) {
        console.error('[FFmpeg]', msg.substring(0, 200));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('[FFmpeg] Spawn error:', err.message);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[FFmpeg] Process exited with code ${code}`);
    });

    // Store for cleanup on skip/stop
    queue.ffmpeg = ffmpeg;

    // Create Discord audio resource from ffmpeg output
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
    });

    queue.player.play(resource);
    queue.playing = true;
    console.log(`[Music] ✅ Streaming "${song.title}" to voice`);

  } catch (err) {
    console.error(`[Music] Stream error:`, err.message);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      await playSong(queue);
    } else {
      try { queue.connection.destroy(); } catch {}
      queues.delete(queue.guildId);
    }
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
    // Note: deferReply() already called by interactionCreate handler
    const query = (interaction.options.getString('query') || '').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
      });
    }

    if (!query) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
      });
    }

    try {
      const info = await getAudioInfo(query);

      // Get or create queue
      let queue = queues.get(interaction.guild.id);

      if (!queue) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
          console.log(`[Music] Joined voice: ${voiceChannel.name}`);
        } catch {
          connection.destroy();
          return interaction.editReply({
            embeds: [new EmbedBuilder().setDescription('❌ Cannot join voice!').setColor(colors.ERROR)],
          });
        }

        const player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play },
        });

        connection.subscribe(player);

        queue = {
          connection, player, songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
          playing: false, ffmpeg: null,
        };
        queues.set(interaction.guild.id, queue);

        // Song finished → play next
        player.on(AudioPlayerStatus.Idle, () => {
          console.log(`[Music] Player Idle (playing was: ${queue.playing})`);
          if (!queue.playing) return;

          queue.playing = false;
          // Kill ffmpeg
          if (queue.ffmpeg) { try { queue.ffmpeg.kill(); } catch {} queue.ffmpeg = null; }

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
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        player.on(AudioPlayerStatus.Playing, () => {
          console.log('[Music] ✅ Audio is streaming');
          queue.playing = true;
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          queue.playing = false;
          if (queue.ffmpeg) { try { queue.ffmpeg.kill(); } catch {} queue.ffmpeg = null; }
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
          else {
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            try { connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });
      }

      // Add to queue
      queue.songs.push(info);

      if (queue.songs.length === 1) {
        await playSong(queue);
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
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try again.\n\nتاقی بکەرەوە.')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

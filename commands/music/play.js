/**
 * Core Game Bot — /play Command
 * Uses @distube/ytdl-core + ffmpeg
 * ytdl-core: the well-known audio extraction library (YouTube's web interface)
 * ffmpeg: converts audio to OGG/Opus for Discord in real time
 * No account, no login, no cookies. Anonymous public visitor.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType, NoSubscriberBehavior,
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const { spawn } = require('child_process');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// ── Search YouTube or resolve URL ──
async function getAudioInfo(query) {
  const isUrl = ytdl.validateURL(query);

  if (isUrl) {
    console.log(`[Music] URL: ${query}`);
    const info = await ytdl.getBasicInfo(query);
    const v = info.videoDetails;
    return {
      title: v.title,
      videoUrl: v.video_url,
      duration: formatSec(parseInt(v.lengthSeconds)),
      thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || null,
    };
  }

  // Search YouTube by text — instant, native Node.js
  console.log(`[Music] Searching: "${query}"`);
  const results = await YouTube.search(query, { limit: 1, type: 'video' });
  if (!results || results.length === 0) throw new Error('No results found');

  const v = results[0];
  console.log(`[Music] Found: "${v.title}"`);
  return {
    title: v.title || 'Unknown',
    videoUrl: v.url,
    duration: v.durationFormatted || '?',
    thumbnail: v.thumbnail?.url || null,
  };
}

// ── Play song: ytdl stream → ffmpeg (opus) → Discord ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}"`);

  try {
    // Step 1: Open live audio stream from YouTube via ytdl-core
    const audioStream = ytdl(song.videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      dlChunkSize: 0,
    });

    audioStream.on('error', (err) => {
      console.error('[Music] ytdl stream error:', err.message);
    });

    // Step 2: Pipe through ffmpeg → convert to OGG/Opus for Discord
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',        // read from stdin (ytdl audio)
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-vn',                  // no video
      '-c:a', 'libopus',     // Discord Opus codec
      '-f', 'ogg',           // OGG container
      '-ar', '48000',        // 48kHz sample rate
      '-ac', '2',            // stereo
      '-b:a', '128k',        // quality
      'pipe:1',              // output to stdout
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe ytdl audio → ffmpeg stdin
    audioStream.pipe(ffmpeg.stdin);

    ffmpeg.stdin.on('error', () => {}); // Ignore broken pipe on skip/stop
    ffmpeg.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Error')) console.error('[FFmpeg]', msg.substring(0, 150));
    });

    // Store for cleanup
    queue.ffmpeg = ffmpeg;
    queue.audioStream = audioStream;

    // Step 3: Create Discord audio resource from ffmpeg output
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
    });

    // Step 4: Push to Discord voice channel
    queue.player.play(resource);
    queue.playing = true;
    console.log(`[Music] ✅ Streaming "${song.title}" via ffmpeg`);

  } catch (err) {
    console.error(`[Music] Play error:`, err.message);
    cleanupStream(queue);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      await playSong(queue);
    } else {
      try { queue.connection.destroy(); } catch {}
      queues.delete(queue.guildId);
    }
  }
}

// ── Cleanup stream and ffmpeg ──
function cleanupStream(queue) {
  if (queue.ffmpeg) {
    try { queue.ffmpeg.kill('SIGKILL'); } catch {}
    queue.ffmpeg = null;
  }
  if (queue.audioStream) {
    try { queue.audioStream.destroy(); } catch {}
    queue.audioStream = null;
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
    // Defer if not already (handler may have deferred)
    if (!interaction.deferred && !interaction.replied) {
      try { await interaction.deferReply(); } catch {}
    }

    const query = (interaction.options.getString('query') || '').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    if (!query) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    try {
      const info = await getAudioInfo(query);

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
          }).catch(() => {});
        }

        const player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play },
        });
        connection.subscribe(player);

        queue = {
          connection, player, songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
          playing: false, ffmpeg: null, audioStream: null,
        };
        queues.set(interaction.guild.id, queue);

        // Song finished → play next
        player.on(AudioPlayerStatus.Idle, () => {
          if (!queue.playing) return;
          queue.playing = false;
          cleanupStream(queue);
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
          console.log('[Music] ✅ Audio streaming via ffmpeg');
          queue.playing = true;
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          queue.playing = false;
          cleanupStream(queue);
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
            cleanupStream(queue);
            try { connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });
      }

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
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${info.title}**\n📌 #${queue.songs.length} • ⏱️ \`${info.duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
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

function formatSec(s) {
  if (!s || isNaN(s)) return 'Live 🔴';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

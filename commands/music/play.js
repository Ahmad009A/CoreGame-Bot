/**
 * Core Game Bot — /play Command
 * Implements reference architecture exactly:
 * youtube-dl-exec (yt-dlp) → prism.FFmpeg (s16le) → StreamType.Raw → Discord
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType, NoSubscriberBehavior,
} = require('@discordjs/voice');
const YouTubeModule = require('../../src/YouTube');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// ── Get track metadata (search or URL) ──
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');

  if (isUrl) {
    console.log(`[Music] Getting info for URL: ${query}`);
    const info = await YouTubeModule.getInfo(query);
    return info;
  }

  // Search YouTube
  console.log(`[Music] Searching: "${query}"`);
  const results = await YouTubeModule.search(query, 1);
  if (!results || results.length === 0) throw new Error('No results found');
  console.log(`[Music] Found: "${results[0].title}"`);
  return results[0];
}

// ── Play current song using reference pipeline ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}"`);

  try {
    // Reference pipeline: yt-dlp → prism.FFmpeg (s16le 48kHz 2ch) → StreamType.Raw
    const { stream, type } = await YouTubeModule.getStream(song.url || song.videoUrl);

    // createAudioResource with StreamType.Raw (s16le) — exactly as reference
    const resource = createAudioResource(stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.0); // 100% volume

    // Store transcoder for cleanup on skip/stop
    queue.transcoder = stream;

    // Play — pushes audio data in real time to Discord voice channel
    queue.player.play(resource);
    queue.playing = true;

    console.log(`[Music] ✅ Streaming "${song.title}" (StreamType.Raw)`);

  } catch (err) {
    console.error(`[Music] Stream error for "${song.title}":`, err.message);
    cleanupTranscoder(queue);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      await playSong(queue);
    } else {
      console.log('■ Queue empty after error, leaving voice.');
      try { queue.connection.destroy(); } catch {}
      queues.delete(queue.guildId);
    }
  }
}

function cleanupTranscoder(queue) {
  if (queue.transcoder) {
    try { queue.transcoder.destroy(); } catch {}
    queue.transcoder = null;
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
    // Ensure deferred — handler pre-defers for slow commands
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
      // Get metadata (fast — no stream yet)
      const info = await getAudioInfo(query);

      let queue = queues.get(interaction.guild.id);

      if (!queue) {
        // Join voice channel
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        // Wait for voice connection to be ready
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
          playing: false,
          transcoder: null,
        };
        queues.set(interaction.guild.id, queue);

        // ── Event: track finished ──
        player.on(AudioPlayerStatus.Idle, () => {
          if (!queue.playing) return;
          queue.playing = false;
          cleanupTranscoder(queue);
          queue.songs.shift();

          if (queue.songs.length > 0) {
            // Play next track in queue
            playSong(queue);
            queue.channel.send({
              embeds: [new EmbedBuilder()
                .setTitle('🎵 Now Playing')
                .setDescription(`🎶 **${queue.songs[0].title}**\n⏱️ \`${queue.songs[0].durationFormatted || queue.songs[0].duration || '?'}\``)
                .setColor(colors.ACCENT)],
            }).catch(() => {});
          } else {
            console.log('■ Queue empty, leaving voice.');
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        player.on(AudioPlayerStatus.Playing, () => {
          console.log('[Music] ✅ Audio streaming');
          queue.playing = true;
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          queue.playing = false;
          cleanupTranscoder(queue);
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
          else {
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        // Handle disconnect (kicked/moved)
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            cleanupTranscoder(queue);
            try { connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });
      }

      // Normalize track object
      const track = {
        title: info.title,
        url: info.url || info.videoUrl,
        videoUrl: info.url || info.videoUrl,
        durationFormatted: info.durationFormatted || info.duration || '?',
        thumbnail: info.thumbnail,
      };

      queue.songs.push(track);

      if (queue.songs.length === 1) {
        // Start playing immediately
        await playSong(queue);

        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${track.title}**\n\n⏱️ \`${track.durationFormatted}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(track.url)
          .setFooter({ text: '/skip • /queue • /stop' })
          .setTimestamp();
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
        await interaction.editReply({ embeds: [embed] }).catch(() => {});

      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${track.title}**\n📌 #${queue.songs.length} in queue • ⏱️ \`${track.durationFormatted}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
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

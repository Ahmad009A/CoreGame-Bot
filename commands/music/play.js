/**
 * Core Game Bot — /play Command
 * Pipeline: Invidious API → prism.FFmpeg (s16le) → StreamType.Raw → Discord Voice
 * No cookies. No yt-dlp. Works from datacenter IPs.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType, NoSubscriberBehavior, getVoiceConnection,
} = require('@discordjs/voice');
const YouTubeModule = require('../../src/YouTube');
const colors = require('../../config/colors');

// Per-guild queues
const queues = new Map();

// ── Resolve track info from search or URL ──
async function getAudioInfo(query) {
  if (query.startsWith('http')) {
    console.log(`[Music] URL: ${query}`);
    return await YouTubeModule.getInfo(query);
  }
  console.log(`[Music] Searching: "${query}"`);
  const results = await YouTubeModule.search(query, 1);
  if (!results?.length) throw new Error('No results found');
  console.log(`[Music] Found: "${results[0].title}"`);
  return results[0];
}

// ── Cleanup audio pipeline ──
function cleanupTranscoder(queue) {
  if (queue.transcoder) {
    try { queue.transcoder.destroy(); } catch {}
    queue.transcoder = null;
  }
}

// ── Stream song: Invidious → prism.FFmpeg → Discord ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}"`);
  try {
    const { stream } = await YouTubeModule.getStream(song.url || song.videoUrl);

    queue.transcoder = stream;

    const resource = createAudioResource(stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.0);

    queue.player.play(resource);
    console.log(`[Music] ✅ Resource sent to player`);

  } catch (err) {
    console.error(`[Music] playSong error: ${err.message}`);
    cleanupTranscoder(queue);
    queue.songs.shift();
    if (queue.songs.length > 0) await playSong(queue);
    else {
      try { queue.connection.destroy(); } catch {}
      queues.delete(queue.guildId);
    }
  }
}

// ── Join voice — handles existing connections ──
async function joinVoice(interaction, voiceChannel) {
  // Destroy any stale connection first
  const existing = getVoiceConnection(interaction.guild.id);
  if (existing) {
    try { existing.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  // Wait up to 30s for Ready (Railway can be slow)
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`[Music] ✅ Joined: ${voiceChannel.name}`);
    return connection;
  } catch (err) {
    console.error(`[Music] Voice join failed: ${err.message}`);
    try { connection.destroy(); } catch {}
    throw new Error('Cannot join voice channel');
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
    // Pre-defer (handler already defers for slow commands)
    if (!interaction.deferred && !interaction.replied) {
      try { await interaction.deferReply(); } catch {}
    }

    const query = (interaction.options.getString('query') || '').trim();
    const voiceChannel = interaction.member?.voice?.channel;

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
          .setDescription('❌ Provide a song name or URL')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    try {
      // Step 1: Get metadata fast (no stream yet)
      const info = await getAudioInfo(query);

      // Normalize track
      const track = {
        title: info.title || 'Unknown',
        url: info.url || info.videoUrl,
        videoUrl: info.url || info.videoUrl,
        durationFormatted: info.durationFormatted || formatSec(info.duration) || '?',
        thumbnail: info.thumbnail || null,
      };

      let queue = queues.get(interaction.guild.id);

      // Step 2: Join voice if not already in a queue
      if (!queue) {
        let connection;
        try {
          connection = await joinVoice(interaction, voiceChannel);
        } catch {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('❌ Could not join your voice channel.\n\nCheck I have **Connect** and **Speak** permissions!')
              .setColor(colors.ERROR)],
          }).catch(() => {});
        }

        const player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play },
        });
        connection.subscribe(player);

        queue = {
          connection,
          player,
          songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
          playing: false,
          transcoder: null,
        };
        queues.set(interaction.guild.id, queue);

        // Track finished → play next
        player.on(AudioPlayerStatus.Idle, () => {
          console.log(`[Music] Idle (playing=${queue.playing})`);
          if (!queue.playing) return;
          queue.playing = false;
          cleanupTranscoder(queue);
          queue.songs.shift();

          if (queue.songs.length > 0) {
            playSong(queue);
            queue.channel.send({
              embeds: [new EmbedBuilder()
                .setTitle('🎵 Now Playing')
                .setDescription(`🎶 **${queue.songs[0].title}**`)
                .setColor(colors.ACCENT)],
            }).catch(() => {});
          } else {
            console.log('[Music] Queue empty, leaving.');
            try { queue.connection.destroy(); } catch {}
            queues.delete(queue.guildId);
          }
        });

        player.on(AudioPlayerStatus.Playing, () => {
          console.log('[Music] ✅ Streaming audio');
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
            queues.delete(queue.guildId);
          }
        });

        // Reconnect on disconnect
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          console.log('[Music] Disconnected, trying to reconnect...');
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            console.log('[Music] Reconnect failed, cleaning up.');
            cleanupTranscoder(queue);
            try { connection.destroy(); } catch {}
            queues.delete(queue.guildId);
          }
        });

        // Log all voice state changes
        connection.on('stateChange', (old, curr) => {
          console.log(`[Voice] ${old.status} → ${curr.status}`);
        });
      }

      // Step 3: Add to queue and play
      queue.songs.push(track);

      if (queue.songs.length === 1) {
        // Start playback
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
          .setDescription(`Could not play.\n\`${error.message?.substring(0, 100)}\`\n\nتاقی بکەرەوە.`)
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

function formatSec(s) {
  if (!s || isNaN(s)) return '?';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

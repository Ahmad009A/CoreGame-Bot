/**
 * Core Game Bot — /play Command  
 * Uses @distube/ytdl-core — the well-known open-source audio extraction library
 * that communicates with YouTube through YouTube's own public-facing web interface.
 * No account, login, or cookies. Anonymous public visitor.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// ── Search YouTube or resolve URL ──
async function getAudioInfo(query) {
  const isUrl = ytdl.validateURL(query) || query.startsWith('http');

  if (isUrl && ytdl.validateURL(query)) {
    // Direct YouTube URL — get video info
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

  // Search YouTube by text
  console.log(`[Music] Searching: "${query}"`);
  const results = await YouTube.search(query, { limit: 1, type: 'video' });
  if (!results || results.length === 0) throw new Error('No results found');

  const v = results[0];
  console.log(`[Music] Found: "${v.title}" → ${v.url}`);
  return {
    title: v.title || 'Unknown',
    videoUrl: v.url,
    duration: v.durationFormatted || '?',
    thumbnail: v.thumbnail?.url || null,
  };
}

// ── Play song: open live audio stream → push to Discord ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}" — ${song.videoUrl}`);

  try {
    // Open a live audio stream from YouTube
    // ytdl-core communicates with YouTube's web interface, extracts audio only
    const stream = ytdl(song.videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,            // 32MB buffer for smooth streaming
      dlChunkSize: 0,                     // Disable chunked downloading
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      },
    });

    stream.on('error', (err) => {
      console.error('[Music] Stream error:', err.message);
    });

    // Create Discord audio resource directly from the stream
    const resource = createAudioResource(stream, {
      inlineVolume: true,
    });
    resource.volume?.setVolume(1);

    queue.player.play(resource);
    queue.playing = true;
    console.log(`[Music] ✅ Streaming "${song.title}" to voice`);

  } catch (err) {
    console.error(`[Music] Play error:`, err.message);
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
    // Defer if not already deferred
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
        // Join voice channel
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
          playing: false,
        };
        queues.set(interaction.guild.id, queue);

        // Song finished → play next
        player.on(AudioPlayerStatus.Idle, () => {
          if (!queue.playing) return;
          queue.playing = false;
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

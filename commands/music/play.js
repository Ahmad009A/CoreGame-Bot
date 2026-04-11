/**
 * Core Game Bot — /play Command
 * Uses play-dl — native Node.js YouTube streaming library
 * No cookies, no CLI, no account needed
 * Works exactly like pro bots: anonymous public access
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Get audio info — search or direct URL
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');
  let videoInfo;

  if (isUrl) {
    // Direct URL — get video info
    console.log(`[Music] Getting URL: ${query}`);
    try {
      const info = await play.video_info(query);
      videoInfo = info.video_details;
    } catch (e) {
      console.error('[Music] URL error:', e.message);
      // Fallback: search by URL
      const results = await play.search(query, { limit: 1 });
      if (results.length > 0) videoInfo = results[0];
    }
  } else {
    // Search YouTube
    console.log(`[Music] Searching: "${query}"`);
    const results = await play.search(query, { limit: 1 });
    if (results.length > 0) {
      videoInfo = results[0];
      console.log(`[Music] Found: "${videoInfo.title}"`);
    }
  }

  if (!videoInfo) throw new Error('No results found');

  return {
    title: videoInfo.title || 'Unknown',
    videoUrl: videoInfo.url,
    duration: videoInfo.durationRaw || 'Live 🔴',
    thumbnail: videoInfo.thumbnails?.[0]?.url || null,
  };
}

// Create audio stream from YouTube video
async function createStream(url) {
  const stream = await play.stream(url);
  return stream;
}

// Play current song in queue
function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}"`);

  // Get stream and play
  createStream(song.videoUrl)
    .then(stream => {
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
      });

      // Store stream for cleanup
      queue.currentStream = stream;
      queue.player.play(resource);
    })
    .catch(err => {
      console.error('[Music] Stream error:', err.message);
      queue.songs.shift();
      if (queue.songs.length > 0) playSong(queue);
      else { queue.connection.destroy(); queues.delete(queue.guildId); }
    });
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
    // IMMEDIATELY defer — don't let the 3-second window expire
    await interaction.deferReply();

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

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try again.\n\nتاقی بکەرەوە.')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

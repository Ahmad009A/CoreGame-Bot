/**
 * Core Game Bot — /play Command
 * Uses @distube/ytdl-core (same as pro bots) + play-dl for search
 * Queue system with auto-play next
 * NO COOKIES NEEDED
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType,
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const play = require('play-dl');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Play the first song in the queue
async function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}"`);

  try {
    // Stream audio using ytdl-core
    const stream = ytdl(song.videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25, // 32MB buffer for stability
      dlChunkSize: 0,
    });

    stream.on('error', (err) => {
      console.error('[Music] Stream error:', err.message);
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
    });

    queue.player.play(resource);
  } catch (err) {
    console.error('[Music] playSong error:', err.message);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      playSong(queue);
    } else {
      queue.connection.destroy();
      queues.delete(queue.guildId);
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio in voice — لێدانی دەنگ لە یوتیوب')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('YouTube URL or song name — لینک یان ناوی گۆرانی')
        .setRequired(true)
    ),

  queues,

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
      // ── Resolve video URL ──────────────────
      let videoUrl, title, thumbnail, duration;

      if (ytdl.validateURL(query)) {
        // Direct YouTube URL
        videoUrl = query;
        console.log(`[Music] Direct URL: ${query}`);
      } else {
        // Search by name using play-dl (search doesn't need auth)
        console.log(`[Music] Searching: "${query}"`);
        const results = await play.search(query, { limit: 1 });
        if (!results.length) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('❌ No results found.\n\nهیچ ئەنجامێک نەدۆزرایەوە.')
              .setColor(colors.ERROR)],
          });
        }
        videoUrl = results[0].url;
        title = results[0].title;
        thumbnail = results[0].thumbnails?.[0]?.url;
        duration = results[0].durationRaw;
        console.log(`[Music] Found: "${title}" → ${videoUrl}`);
      }

      // ── Get video info ─────────────────────
      if (!title) {
        try {
          const info = await ytdl.getBasicInfo(videoUrl);
          title = info.videoDetails.title;
          thumbnail = info.videoDetails.thumbnails?.pop()?.url;
          duration = formatDuration(parseInt(info.videoDetails.lengthSeconds));
        } catch (infoErr) {
          console.log('[Music] Info fallback:', infoErr.message?.substring(0, 80));
          title = title || 'YouTube Audio';
          duration = duration || '??:??';
        }
      }

      // ── Get or create queue ────────────────
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
            embeds: [new EmbedBuilder()
              .setDescription('❌ Cannot join voice channel!')
              .setColor(colors.ERROR)],
          });
        }

        const player = createAudioPlayer();
        connection.subscribe(player);

        queue = {
          connection,
          player,
          songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
        };
        queues.set(interaction.guild.id, queue);

        // Auto-play next song
        player.on(AudioPlayerStatus.Idle, () => {
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
            console.log('■ Queue empty, leaving voice.');
            queue.connection.destroy();
            queues.delete(interaction.guild.id);
          }
        });

        player.on('error', (err) => {
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
          } catch {
            connection.destroy();
            queues.delete(interaction.guild.id);
          }
        });
      }

      // ── Add to queue ───────────────────────
      queue.songs.push({ title, videoUrl, duration, thumbnail, requestedBy: interaction.user.id });

      if (queue.songs.length === 1) {
        await playSong(queue);

        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(videoUrl)
          .setFooter({ text: '/stop to stop • /play to add more' })
          .setTimestamp();
        if (thumbnail) embed.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${title}**\n\n📌 Position: **#${queue.songs.length}** • ⏱️ \`${duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (thumbnail) embed.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] FULL ERROR:', error.message);
      console.error('[Music] Stack:', error.stack?.substring(0, 300));

      let msg = 'Could not play. Try a different song.\n\nتاقی بکەرەوە بە گۆرانییەکی تر.';
      if (error.message?.includes('429')) {
        msg = 'YouTube is busy. Try again in 1 minute.\n\nیوتیوب سەرقاڵە.';
      } else if (error.message?.includes('private') || error.message?.includes('unavailable')) {
        msg = 'This video is private or unavailable.\n\nئەم ڤیدیۆیە نایەت بینینی.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(msg)
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Live 🔴';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Core Game Bot — /play Command (FINAL)
 * Uses yt-dlp with YouTube TV client — bypasses bot detection
 * NO COOKIES NEEDED. Works with any YouTube video.
 * Queue + skip + auto-play next
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Get audio info from YouTube using TV client (bypasses bot detection)
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');

  let videoUrl = query;
  let title, thumbnail, duration;

  if (!isUrl) {
    // Search YouTube by name
    console.log(`[Music] Searching: "${query}"`);
    const searchResult = await ytdlp(`ytsearch1:${query}`, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
    });
    const entry = searchResult.entries?.[0] || searchResult;
    videoUrl = entry.webpage_url || entry.url;
    title = entry.title;
    console.log(`[Music] Found: "${title}" → ${videoUrl}`);
  }

  // Get audio stream URL using TV embedded client
  console.log(`[Music] Getting audio: ${videoUrl}`);
  const info = await ytdlp(videoUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    format: 'bestaudio/best',
    extractorArgs: 'youtube:player_client=tv_embedded',
  });

  return {
    title: title || info.title || 'YouTube Audio',
    audioUrl: info.url,
    videoUrl: info.webpage_url || videoUrl,
    duration: info.duration_string || formatSec(info.duration),
    thumbnail: info.thumbnail,
  };
}

// Play the current song in queue
async function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}"`);

  try {
    const resource = createAudioResource(song.audioUrl);
    queue.player.play(resource);
  } catch (err) {
    console.error('[Music] Play error:', err.message);
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
    .setDescription('Play music in voice — لێدانی مۆسیقا لە ڤۆیس')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name or YouTube URL — ناوی گۆرانی یان لینک')
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
      // ── Get audio from YouTube ─────────────
      const info = await getAudioInfo(query);

      if (!info.audioUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Could not get audio stream.')
            .setColor(colors.ERROR)],
        });
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
          connection, player,
          songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
        };
        queues.set(interaction.guild.id, queue);

        // Auto-play next song when current finishes
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
      queue.songs.push(info);

      if (queue.songs.length === 1) {
        await playSong(queue);
        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription([
            `🎶 **${info.title}**`,
            '',
            `⏱️ \`${info.duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`,
          ].join('\n'))
          .setColor(colors.ACCENT)
          .setURL(info.videoUrl)
          .setFooter({ text: '/skip • /queue • /stop' })
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${info.title}**\n\n📌 Position: **#${queue.songs.length}** • ⏱️ \`${info.duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] ERROR:', error.message);
      console.error('[Music] stderr:', (error.stderr || '').substring(0, 200));

      let msg = 'Could not play this song. Try again.\n\nتاقی بکەرەوە.';
      if (error.message?.includes('429') || error.stderr?.includes('429')) {
        msg = 'YouTube is busy. Wait 1 minute.\n\nیوتیوب سەرقاڵە. چاوەڕوان بە.';
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

function formatSec(s) {
  if (!s) return 'Live 🔴';
  s = parseInt(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

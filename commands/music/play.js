/**
 * Core Game Bot — /play Command
 * Uses play-dl — NO COOKIES NEEDED
 * Supports: YouTube URLs + song name search + SoundCloud
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio in voice — لێدانی دەنگ لە یوتیوب')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('YouTube URL or song name — لینک یان ناوی گۆرانی')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      // ── Find the video ─────────────────────
      let videoUrl;
      let title, thumbnail, duration;

      const validated = play.yt_validate(query);

      if (validated === 'video') {
        // Direct YouTube URL
        videoUrl = query;
      } else if (query.includes('youtu.be') || query.includes('youtube.com')) {
        // YouTube URL variant
        videoUrl = query;
      } else if (query.includes('soundcloud.com')) {
        // SoundCloud direct link
        videoUrl = query;
      } else {
        // Search by name
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
      }

      // Get video details if we don't have them yet
      if (!title) {
        try {
          if (videoUrl.includes('soundcloud')) {
            const soInfo = await play.soundcloud(videoUrl);
            title = soInfo.name || 'SoundCloud Track';
            duration = formatMs(soInfo.durationInMs);
            thumbnail = soInfo.thumbnail;
          } else {
            const info = await play.video_info(videoUrl);
            title = info.video_details.title;
            thumbnail = info.video_details.thumbnails?.pop()?.url;
            duration = info.video_details.durationRaw || 'Live 🔴';
          }
        } catch (infoErr) {
          console.log('[Music] Info fetch failed, continuing with stream:', infoErr.message);
          title = title || 'Audio';
          duration = duration || '??:??';
        }
      }

      // ── Get audio stream ───────────────────
      console.log(`[Music] Streaming: "${title}" from ${videoUrl}`);
      const stream = await play.stream(videoUrl);

      // ── Join voice channel ─────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        connection.destroy();
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Cannot join voice channel. Check bot permissions!')
            .setColor(colors.ERROR)],
        });
      }

      // ── Create audio resource ──────────────
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
      });

      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      });

      connection.subscribe(player);
      player.play(resource);

      // ── Events ─────────────────────────────
      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`▶ Now playing: "${title}"`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log('■ Playback finished.');
      });

      player.on('error', (err) => {
        console.error('Player error:', err.message);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
        }
      });

      // ── Now Playing embed ──────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription([
          `🎶 **${title}**`,
          '',
          `⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`,
        ].join('\n'))
        .setColor(colors.ACCENT)
        .setURL(videoUrl)
        .setFooter({ text: '/stop to stop • Core Game Bot' })
        .setTimestamp();

      if (thumbnail) embed.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('[Music] FULL ERROR:', error.message);
      console.error('[Music] Stack:', error.stack);

      let msg = 'Could not play. Try again.\n\nتاقی بکەرەوە.';
      if (error.message?.includes('429')) {
        msg = 'YouTube is busy. Try again in 1 minute.\n\nیوتیوب سەرقاڵە. دوای ١ خولەک هەوڵ بدەرەوە.';
      } else if (error.message?.includes('confirm')) {
        msg = 'YouTube blocked this request. Try searching by song name instead of URL.\n\nبە ناوی گۆرانی بگەڕێ لەجیاتی لینک.';
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

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

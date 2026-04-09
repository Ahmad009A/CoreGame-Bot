/**
 * Core Game Bot — /play Command
 * Uses play-dl — NO COOKIES NEEDED
 * Supports: YouTube URLs + song name search
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Find the video ─────────────────────
      let videoUrl = query;
      let info;

      if (play.yt_validate(query) === 'video') {
        // Direct YouTube URL
        info = await play.video_info(query);
      } else if (query.includes('youtu')) {
        // YouTube URL that didn't validate (playlist link, etc)
        info = await play.video_info(query);
      } else {
        // Search by name
        const results = await play.search(query, { limit: 1 });
        if (!results.length) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('❌ No results found. Try a different search.\n\nهیچ ئەنجامێک نەدۆزرایەوە.')
              .setColor(colors.ERROR)],
          });
        }
        videoUrl = results[0].url;
        info = await play.video_info(videoUrl);
      }

      const title = info.video_details.title || 'YouTube Audio';
      const thumbnail = info.video_details.thumbnails?.pop()?.url || null;
      const duration = info.video_details.durationRaw || 'Live 🔴';
      const url = info.video_details.url || videoUrl;

      // ── Get audio stream via play-dl ───────
      const stream = await play.stream(url);

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

      // ── Create audio resource from play-dl stream ──
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
        console.log(`▶ Playing: "${title}"`);
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
        .setURL(url)
        .setFooter({ text: '/stop to stop • Core Game Bot' })
        .setTimestamp();

      if (thumbnail) embed.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Play error:', error.message);

      let msg = 'Could not play. Try another song.\n\nتاقی بکەرەوە بە گۆرانییەکی تر.';
      if (error.message?.includes('429')) {
        msg = 'YouTube rate limit. Try again in a minute.\n\nیوتیوب بلۆکی کرد. دوای یەک خولەک هەوڵ بدەرەوە.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(msg)
          .setColor(colors.ERROR)],
      });
    }
  },
};

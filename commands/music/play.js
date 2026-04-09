/**
 * Core Game Bot — /play Command  
 * Uses play-dl with YouTube cookie auth
 * Supports: YouTube URL + search by song name
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');

// Set YouTube cookies on first load
let cookiesSet = false;
async function ensureCookies() {
  if (cookiesSet) return;
  cookiesSet = true;

  const cookie = process.env.YOUTUBE_COOKIES;
  if (cookie) {
    try {
      await play.setToken({ youtube: { cookie } });
      console.log('[Music] YouTube cookies loaded via play-dl');
    } catch (e) {
      console.error('[Music] Failed to set cookies:', e.message);
    }
  } else {
    console.log('[Music] No YOUTUBE_COOKIES env var — YouTube may block requests');
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
      // Load cookies before first use
      await ensureCookies();

      // ── Find the video ─────────────────────
      let videoUrl;
      let title, thumbnail, duration;

      const validated = play.yt_validate(query);

      if (validated === 'video' || query.includes('youtu')) {
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

      // Get info if not from search
      if (!title) {
        try {
          const info = await play.video_info(videoUrl);
          title = info.video_details.title;
          thumbnail = info.video_details.thumbnails?.pop()?.url;
          duration = info.video_details.durationRaw || 'Live 🔴';
        } catch {
          title = 'YouTube Audio';
          duration = '??:??';
        }
      }

      // ── Stream audio ───────────────────────
      console.log(`[Music] Streaming: "${title}"`);
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
            .setDescription('❌ Cannot join voice channel!')
            .setColor(colors.ERROR)],
        });
      }

      // ── Play ───────────────────────────────
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });

      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Playing, () => console.log(`▶ Playing: "${title}"`));
      player.on(AudioPlayerStatus.Idle, () => console.log('■ Playback done.'));
      player.on('error', e => console.error('Player error:', e.message));

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch { connection.destroy(); }
      });

      // ── Reply ──────────────────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
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
      if (error.message?.includes('Sign in') || error.message?.includes('confirm')) {
        msg = '⚠️ YouTube cookies missing or expired!\n\nAdmin: set `YOUTUBE_COOKIES` in Railway.\nSee README for instructions.';
      } else if (error.message?.includes('429')) {
        msg = 'YouTube rate limited. Wait 1 minute.\n\nیوتیوب سەرقاڵە. چاوەڕوان بە.';
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

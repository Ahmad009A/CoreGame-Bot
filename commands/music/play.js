/**
 * Core Game Bot — /play Command
 * Play YouTube audio in a voice channel
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');
const emojis = require('../../config/emojis');

// Store active players per guild
const players = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube video in voice — لێدانی ڤیدیۆی یوتیوب')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('YouTube URL — لینکی یوتیوب')
        .setRequired(true)
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');
    const member = interaction.member;

    // ── Must be in a voice channel ───────────
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ You must be in a voice channel first!\n\nپێویستە لە ڤۆیس چاتێک بیت!')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    // ── Validate YouTube URL ─────────────────
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Please provide a valid YouTube URL!\n\nتکایە لینکی یوتیوبی دروست بنێرە!')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Get video info ─────────────────────
      const videoInfo = await play.video_info(url);
      const title = videoInfo.video_details.title;
      const thumbnail = videoInfo.video_details.thumbnails?.[0]?.url;
      const duration = videoInfo.video_details.durationRaw;

      // ── Get audio stream ───────────────────
      const stream = await play.stream(url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });

      // ── Join voice channel ─────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      // ── Create or get player ───────────────
      let playerData = players.get(interaction.guild.id);
      if (!playerData) {
        const audioPlayer = createAudioPlayer();
        playerData = { player: audioPlayer, connection };
        players.set(interaction.guild.id, playerData);

        // Auto-cleanup on disconnect
        connection.on(VoiceConnectionStatus.Disconnected, () => {
          players.delete(interaction.guild.id);
        });

        // Leave when done
        audioPlayer.on(AudioPlayerStatus.Idle, () => {
          // Stay in channel, ready for next song
        });

        audioPlayer.on('error', (error) => {
          console.error('Audio player error:', error);
        });

        connection.subscribe(audioPlayer);
      } else {
        playerData.connection = connection;
      }

      // ── Play the audio ─────────────────────
      playerData.player.play(resource);

      // ── Now Playing embed ──────────────────
      const nowPlaying = new EmbedBuilder()
        .setTitle(`${emojis.MUSIC || '🎵'} Now Playing`)
        .setDescription([
          '',
          `**${title}**`,
          '',
          `⏱️ Duration: \`${duration || 'Live'}\``,
          `🔊 Channel: \`${voiceChannel.name}\``,
          `🎧 Requested by: <@${interaction.user.id}>`,
          '',
          `ئێستا لێدانی: **${title}**`,
        ].join('\n'))
        .setColor(colors.ACCENT)
        .setFooter({ text: 'Core Game Bot • Music Player' })
        .setTimestamp();

      if (thumbnail) nowPlaying.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [nowPlaying] });

    } catch (error) {
      console.error('Play error:', error);

      const errorMsg = error.message?.includes('Sign in')
        ? 'This video requires age verification and cannot be played.'
        : error.message?.includes('private')
          ? 'This video is private.'
          : 'Failed to play this video. Please try another URL.';

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription(`❌ ${errorMsg}\n\nهەڵەیەک ھەیە. تکایە لینکی تر تاقی بکەرەوە.`)
          .setColor(colors.ERROR)
        ],
      });
    }
  },
};

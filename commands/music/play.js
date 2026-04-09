/**
 * Core Game Bot — /play Command
 * Join voice channel and play audio from a YouTube URL
 *
 * Flow: /play <url> → Bot joins VC → Gets audio stream → Plays sound
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const colors = require('../../config/colors');

// Store active players per guild
const guildPlayers = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio in voice — لێدانی دەنگ لە یوتیوب')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('YouTube video URL — لینکی ڤیدیۆی یوتیوب')
        .setRequired(true)
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');
    const member = interaction.member;

    // ── Must be in a voice channel ───────────
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Not in Voice Channel')
          .setDescription('You must join a voice channel first!\n\nپێویستە سەرەتا بچیتە ناو ڤۆیس چاتێک!')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    // ── Check if URL is YouTube ──────────────
    const isYouTube = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
    if (!isYouTube) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Invalid URL')
          .setDescription('Please provide a valid YouTube URL!\n\nتکایە لینکی یوتیوبی دروست بنێرە!\n\n**Example:** `https://www.youtube.com/watch?v=dQw4w9WgXcQ`')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Load play-dl dynamically ────────────
      const play = require('play-dl');

      // ── Get video info ─────────────────────
      let title = 'Unknown Title';
      let thumbnail = null;
      let duration = 'Unknown';

      try {
        const info = await play.video_basic_info(url);
        title = info.video_details.title || 'Unknown Title';
        thumbnail = info.video_details.thumbnails?.[0]?.url || null;
        duration = info.video_details.durationRaw || 'Live';
      } catch (infoErr) {
        console.log('Could not fetch video info, continuing with stream...');
      }

      // ── Get audio stream ───────────────────
      const stream = await play.stream(url);

      // ── Join voice channel ─────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      // Wait for connection to be ready
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        connection.destroy();
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Failed to connect to voice channel.\n\nنەتوانرا پەیوەندی بکرێت بە ڤۆیس.')
            .setColor(colors.ERROR)
          ],
        });
      }

      // ── Create audio resource ──────────────
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
      });

      // ── Create or reuse player ─────────────
      let existingPlayer = guildPlayers.get(interaction.guild.id);

      if (existingPlayer) {
        // Stop existing playback
        existingPlayer.player.stop();
      }

      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      guildPlayers.set(interaction.guild.id, {
        player,
        connection,
        channelId: voiceChannel.id,
      });

      // Subscribe connection to player
      connection.subscribe(player);

      // ── Play the audio ─────────────────────
      player.play(resource);

      // ── Handle events ──────────────────────
      player.on(AudioPlayerStatus.Idle, () => {
        // Song finished
        console.log(`Finished playing in guild ${interaction.guild.id}`);
      });

      player.on('error', (error) => {
        console.error('Audio player error:', error.message);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          // Reconnecting...
        } catch {
          // Really disconnected
          connection.destroy();
          guildPlayers.delete(interaction.guild.id);
        }
      });

      // ── Now Playing embed ──────────────────
      const nowPlaying = new EmbedBuilder()
        .setTitle('🎵 Now Playing — ئێستا لێدەدرێت')
        .setDescription([
          '',
          `🎶 **${title}**`,
          '',
          `⏱️ Duration: \`${duration}\``,
          `🔊 Channel: \`${voiceChannel.name}\``,
          `🎧 Requested by: <@${interaction.user.id}>`,
        ].join('\n'))
        .setColor(colors.ACCENT)
        .setFooter({ text: 'Use /stop to stop playback • Core Game Bot' })
        .setTimestamp();

      if (thumbnail) nowPlaying.setThumbnail(thumbnail);

      // Add link to the video
      nowPlaying.setURL(url);

      await interaction.editReply({ embeds: [nowPlaying] });

    } catch (error) {
      console.error('Play command error:', error);

      let errorMsg = 'Failed to play this video. Please try another URL.';
      if (error.message?.includes('Sign in')) {
        errorMsg = 'This video requires age verification and cannot be played.';
      } else if (error.message?.includes('private')) {
        errorMsg = 'This video is private.';
      } else if (error.message?.includes('confirm your age')) {
        errorMsg = 'Age-restricted video cannot be played.';
      } else if (error.message?.includes('429')) {
        errorMsg = 'Too many requests. Please wait a moment and try again.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`${errorMsg}\n\n\`${error.message}\`\n\nهەڵەیەک ھەیە. تکایە لینکی تر تاقی بکەرەوە.`)
          .setColor(colors.ERROR)
        ],
      });
    }
  },
};

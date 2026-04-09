/**
 * Core Game Bot — /play Command
 * Join voice channel and play YouTube audio using @distube/ytdl-core
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const colors = require('../../config/colors');

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
    let url = interaction.options.getString('url').trim();
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

    // ── Validate YouTube URL ─────────────────
    if (!ytdl.validateURL(url)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Invalid YouTube URL')
          .setDescription([
            'Please provide a valid YouTube link!',
            '',
            '**Valid examples:**',
            '`https://www.youtube.com/watch?v=dQw4w9WgXcQ`',
            '`https://youtu.be/dQw4w9WgXcQ`',
            '',
            'تکایە لینکی یوتیوبی دروست بنێرە!',
          ].join('\n'))
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Get video info ─────────────────────
      const info = await ytdl.getInfo(url);
      const title = info.videoDetails.title || 'Unknown Title';
      const thumbnail = info.videoDetails.thumbnails?.pop()?.url || null;
      const duration = formatDuration(parseInt(info.videoDetails.lengthSeconds));
      const author = info.videoDetails.author?.name || 'Unknown';

      // ── Join voice channel ─────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      // Wait for connection
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        connection.destroy();
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Failed to connect to voice channel. Check my permissions!\n\nنەتوانرا پەیوەندی بکرێت بە ڤۆیس.')
            .setColor(colors.ERROR)
          ],
        });
      }

      // ── Get audio stream from YouTube ──────
      const stream = ytdl(url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
      });

      // ── Create audio resource ──────────────
      const resource = createAudioResource(stream, {
        inlineVolume: true,
      });

      // ── Create player ──────────────────────
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      // Subscribe and play
      connection.subscribe(player);
      player.play(resource);

      // ── Handle events ──────────────────────
      player.on(AudioPlayerStatus.Idle, () => {
        // Song finished — stay in VC ready for next
      });

      player.on('error', (error) => {
        console.error('Audio player error:', error.message);
      });

      // Handle disconnect/reconnect
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
      const nowPlaying = new EmbedBuilder()
        .setTitle('🎵 Now Playing — ئێستا لێدەدرێت')
        .setDescription([
          '',
          `🎶 **[${title}](${url})**`,
          '',
          `👤 Channel: \`${author}\``,
          `⏱️ Duration: \`${duration}\``,
          `🔊 Voice: \`${voiceChannel.name}\``,
          `🎧 Requested by: <@${interaction.user.id}>`,
        ].join('\n'))
        .setColor(colors.ACCENT)
        .setFooter({ text: 'Use /stop to stop • Core Game Bot' })
        .setTimestamp();

      if (thumbnail) nowPlaying.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [nowPlaying] });

    } catch (error) {
      console.error('Play command error:', error);

      let errorMsg = 'Failed to play this video.';
      const msg = error.message || '';

      if (msg.includes('age') || msg.includes('Sign in')) {
        errorMsg = 'This video is age-restricted and cannot be played.';
      } else if (msg.includes('private')) {
        errorMsg = 'This video is private.';
      } else if (msg.includes('unavailable') || msg.includes('not available')) {
        errorMsg = 'This video is unavailable in the bot\'s region.';
      } else if (msg.includes('429') || msg.includes('Too Many')) {
        errorMsg = 'YouTube rate limited. Wait a moment and try again.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`${errorMsg}\n\nهەڵە: \`${msg.substring(0, 200)}\``)
          .setColor(colors.ERROR)
        ],
      });
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

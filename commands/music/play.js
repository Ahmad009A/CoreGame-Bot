/**
 * Core Game Bot — /play Command
 * Play YouTube audio using yt-dlp (most reliable method)
 * Flow: /play url → Join VC → yt-dlp extracts audio → Plays sound
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
  StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');
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
    const url = interaction.options.getString('url').trim();
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

    // ── Basic URL check ──────────────────────
    if (!url.includes('youtu')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Invalid URL')
          .setDescription('Please provide a valid YouTube link!\n\n**Example:** `https://www.youtube.com/watch?v=...`')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Step 1: Get video info via yt-dlp ──
      let title = 'Unknown';
      let thumbnail = null;
      let duration = '?';

      try {
        const info = await youtubedl(url, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          noWarnings: true,
          preferFreeFormats: true,
          skipDownload: true,
        });
        title = info.title || 'Unknown';
        thumbnail = info.thumbnail || null;
        duration = info.duration_string || formatSecs(info.duration);
      } catch (e) {
        console.log('Info fetch warning:', e.message?.substring(0, 100));
      }

      // ── Step 2: Join voice channel ─────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        connection.destroy();
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Failed to join voice channel. Check my permissions!')
            .setColor(colors.ERROR)
          ],
        });
      }

      // ── Step 3: Stream audio via yt-dlp subprocess ──
      // This pipes audio directly — no 429 issues
      const ytdlpPath = youtubedl.constants.YOUTUBE_DL_PATH;
      const ytProcess = spawn(ytdlpPath, [
        url,
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '-o', '-',           // output to stdout
        '--no-check-certificates',
        '--no-warnings',
        '--quiet',
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // ── Step 4: Create audio resource from stdout ──
      const resource = createAudioResource(ytProcess.stdout, {
        inputType: StreamType.Arbitrary,
      });

      // ── Step 5: Play ───────────────────────
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      });

      connection.subscribe(player);
      player.play(resource);

      // Cleanup on finish
      player.on(AudioPlayerStatus.Idle, () => {
        // Ready for next song
      });

      player.on('error', (err) => {
        console.error('Player error:', err.message);
        ytProcess.kill();
      });

      ytProcess.on('error', (err) => {
        console.error('yt-dlp process error:', err.message);
      });

      // Handle disconnection
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          ytProcess.kill();
        }
      });

      // ── Now Playing embed ──────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing — ئێستا لێدەدرێت')
        .setDescription([
          '',
          `🎶 **${title}**`,
          '',
          `⏱️ Duration: \`${duration}\``,
          `🔊 Voice: \`${voiceChannel.name}\``,
          `🎧 By: <@${interaction.user.id}>`,
        ].join('\n'))
        .setColor(colors.ACCENT)
        .setURL(url)
        .setFooter({ text: 'Use /stop to stop • Core Game Bot' })
        .setTimestamp();

      if (thumbnail) embed.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Play error:', error);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`Could not play this video.\n\n\`${(error.message || '').substring(0, 200)}\``)
          .setColor(colors.ERROR)
        ],
      });
    }
  },
};

function formatSecs(s) {
  if (!s) return 'Live 🔴';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

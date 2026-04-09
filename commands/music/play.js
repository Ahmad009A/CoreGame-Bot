/**
 * Core Game Bot — /play Command
 * Play YouTube audio using yt-dlp URL extraction + ffmpeg streaming
 * 
 * Flow: /play url → yt-dlp gets direct audio URL → ffmpeg streams it → Discord VC
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
const ffmpegPath = require('ffmpeg-static');
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
      // ── Step 1: Get video info + direct audio URL via yt-dlp ──
      const cookiesPath = require('path').join(__dirname, '..', '..', 'cookies.txt');
      const fs = require('fs');
      const ytdlOpts = {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        format: 'bestaudio',
      };

      // Use cookies file if it exists (required by YouTube)
      if (fs.existsSync(cookiesPath)) {
        ytdlOpts.cookies = cookiesPath;
      }

      const info = await youtubedl(url, ytdlOpts);

      const title = info.title || 'YouTube Audio';
      const thumbnail = info.thumbnail || null;
      const duration = info.duration_string || formatSecs(info.duration);
      const directUrl = info.url; // <-- Direct audio stream URL from Google CDN

      if (!directUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Could Not Extract Audio')
            .setDescription('Failed to get audio stream. Try a different video.')
            .setColor(colors.ERROR)
          ],
        });
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
            .setDescription('❌ Failed to join voice channel. Check bot permissions!')
            .setColor(colors.ERROR)
          ],
        });
      }

      // ── Step 3: ffmpeg reads URL directly → outputs PCM audio ──
      const ffProcess = spawn(ffmpegPath, [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', directUrl,         // ffmpeg reads the direct Google CDN URL
        '-f', 's16le',           // output raw PCM
        '-ar', '48000',          // 48kHz (Discord requirement)
        '-ac', '2',              // stereo
        '-loglevel', 'warning',
        'pipe:1',                // output to stdout
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Capture ffmpeg errors for debugging
      ffProcess.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.log('ffmpeg:', msg);
      });

      ffProcess.on('error', (e) => {
        console.error('ffmpeg process error:', e.message);
      });

      // ── Step 4: Create audio resource from ffmpeg PCM output ──
      const resource = createAudioResource(ffProcess.stdout, {
        inputType: StreamType.Raw,
      });

      // ── Step 5: Play ───────────────────────
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      });

      connection.subscribe(player);
      player.play(resource);

      // ── Events ─────────────────────────────
      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`▶ Playing: "${title}" in ${voiceChannel.name}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log('■ Playback finished.');
        try { ffProcess.kill(); } catch {}
      });

      player.on('error', (err) => {
        console.error('Player error:', err.message);
        try { ffProcess.kill(); } catch {}
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          try { ffProcess.kill(); } catch {}
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

      let errorMsg = 'Could not play this video.';
      const msg = error.stderr || error.message || '';
      if (msg.includes('Sign in') || msg.includes('bot')) {
        errorMsg = 'YouTube is blocking this video. Try a different one.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`${errorMsg}\n\n\`${msg.substring(0, 200)}\``)
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

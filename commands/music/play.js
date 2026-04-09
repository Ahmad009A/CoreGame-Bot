/**
 * Core Game Bot — /play Command
 * Play YouTube audio using yt-dlp + ffmpeg on Railway (Linux)
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior, StreamType,
} = require('@discordjs/voice');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const colors = require('../../config/colors');

// Find yt-dlp binary (works on both Windows and Linux/Railway)
function getYtdlpPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
    path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ];
  for (const p of candidates) {
    try {
      if (p === 'yt-dlp' || fs.existsSync(p)) return p;
    } catch {}
  }
  return 'yt-dlp';
}

const YTDLP = getYtdlpPath();
const COOKIES_FILE = path.join(__dirname, '..', '..', 'cookies.txt');

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

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس!')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    if (!url.includes('youtu')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Invalid YouTube URL!\n\n**Example:** `https://www.youtube.com/watch?v=...`')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Build yt-dlp args ──────────────────
      const args = [
        url,
        '--dump-json',
        '--no-check-certificates',
        '--no-warnings',
        '-f', 'bestaudio/best',
        '--extractor-args', 'youtube:player_client=tv_embedded',
      ];

      if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);

      // ── Run yt-dlp to get info ─────────────
      console.log(`[Music] Running: ${YTDLP} ${args.slice(0, 4).join(' ')}...`);
      let rawJson;
      try {
        rawJson = execFileSync(YTDLP, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      } catch (e) {
        // Try fallback without player override
        console.log('[Music] tv_embedded failed, trying default...');
        const fallbackArgs = args.filter(a => a !== '--extractor-args' && a !== 'youtube:player_client=tv_embedded');
        rawJson = execFileSync(YTDLP, fallbackArgs, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      }

      const info = JSON.parse(rawJson.toString());
      const title = info.title || 'YouTube Audio';
      const thumbnail = info.thumbnail || null;
      const duration = info.duration_string || fmtSec(info.duration);
      const audioUrl = info.url
        || info.requested_downloads?.[0]?.url
        || info.formats?.filter(f => f.acodec && f.acodec !== 'none').pop()?.url;

      if (!audioUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ No audio URL found. Try another video.')
            .setColor(colors.ERROR)],
        });
      }

      console.log(`[Music] Got audio URL for: "${title}"`);

      // ── Join voice channel ─────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,  // Don't deafen so we can hear ourselves
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

      // ── ffmpeg: stream URL → PCM 48kHz ────
      const ff = spawn(ffmpegPath, [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', audioUrl,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-loglevel', 'warning',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let ffErr = '';
      ff.stderr.on('data', d => {
        ffErr += d.toString();
        if (ffErr.length < 500) console.log('ffmpeg:', d.toString().trim());
      });
      ff.on('error', e => console.error('ffmpeg spawn error:', e.message));

      const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });

      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Playing, () => console.log(`▶ Playing: "${title}"`));
      player.on(AudioPlayerStatus.Idle, () => {
        console.log('■ Playback done.');
        try { ff.kill(); } catch {}
      });
      player.on('error', e => {
        console.error('Player error:', e.message);
        try { ff.kill(); } catch {}
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          try { ff.kill(); } catch {}
        }
      });

      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
        .setColor(colors.ACCENT).setURL(url)
        .setFooter({ text: '/stop to stop • Core Game Bot' }).setTimestamp();
      if (thumbnail) embed.setThumbnail(thumbnail);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      const msg = error.stderr?.toString() || error.message || '';
      console.error('Play error:', msg.substring(0, 300));
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`Could not play this video.\n\nتکایە ڤیدیۆیەکی تر تاقی بکەرەوە.\n\n\`\`\`${msg.substring(0, 150)}\`\`\``)
          .setColor(colors.ERROR)],
      });
    }
  },
};

function fmtSec(s) {
  if (!s) return 'Live 🔴';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

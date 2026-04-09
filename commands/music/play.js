/**
 * Core Game Bot — /play Command
 * Strategy 1: yt-dlp with cookies (YOUTUBE_COOKIES env var)
 * Strategy 2: Invidious API (no cookies needed)
 * Strategy 3: Invidious formatStreams fallback
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior, StreamType,
} = require('@discordjs/voice');
const { spawn, execFileSync } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const colors = require('../../config/colors');

const COOKIES_FILE = path.join(__dirname, '..', '..', 'cookies.txt');

// Find yt-dlp binary
function getYtdlp() {
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
    path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Extract YouTube video ID from URL
function getVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Fetch JSON from URL
function fetchJson(url, ms = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
    });
    req.setTimeout(ms, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

// Invidious instances list
const INVIDIOUS = [
  'https://invidious.jing.rocks',
  'https://invidious.privacydev.net',
  'https://vid.puffyan.us',
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
  'https://y.com.sb',
];

// Try to get audio URL via Invidious API
async function getFromInvidious(videoId) {
  for (const inst of INVIDIOUS) {
    try {
      const data = await fetchJson(`${inst}/api/v1/videos/${videoId}`, 7000);
      if (data.error) continue;

      const title = data.title || 'YouTube Audio';
      const duration = data.lengthSeconds || 0;
      const thumb = data.videoThumbnails?.find(t => t.quality === 'medium')?.url || data.videoThumbnails?.[0]?.url;

      // Audio-only streams
      const audioStreams = (data.adaptiveFormats || [])
        .filter(f => f.type?.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      let audioUrl = audioStreams[0]?.url;

      // Fallback: combined stream
      if (!audioUrl) {
        const combined = (data.formatStreams || []).reverse();
        audioUrl = combined[0]?.url;
      }

      if (!audioUrl) continue;

      // Make URL absolute if relative
      if (audioUrl.startsWith('/')) audioUrl = inst + audioUrl;

      console.log(`[Music] Invidious OK: ${inst} → "${title}"`);
      return { audioUrl, title, duration: fmtSec(duration), thumb };
    } catch (e) {
      console.log(`[Music] Invidious ${inst}: ${e.message}`);
    }
  }
  return null;
}

// Try to get audio URL via yt-dlp + cookies
function getFromYtdlp(url) {
  const bin = getYtdlp();
  if (!bin) return null;
  if (!fs.existsSync(COOKIES_FILE)) return null;

  try {
    console.log('[Music] Trying yt-dlp with cookies...');
    const args = [url, '--dump-json', '--no-warnings', '-f', 'bestaudio/best', '--cookies', COOKIES_FILE];
    const out = execFileSync(bin, args, { timeout: 25000, maxBuffer: 5 * 1024 * 1024 });
    const info = JSON.parse(out.toString());
    const audioUrl = info.url || info.requested_downloads?.[0]?.url;
    if (!audioUrl) return null;
    console.log(`[Music] yt-dlp OK → "${info.title}"`);
    return {
      audioUrl,
      title: info.title || 'YouTube Audio',
      duration: info.duration_string || fmtSec(info.duration),
      thumb: info.thumbnail,
    };
  } catch (e) {
    console.log('[Music] yt-dlp failed:', (e.stderr?.toString() || e.message).substring(0, 120));
    return null;
  }
}

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
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    const videoId = getVideoId(url);
    if (!videoId) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Invalid YouTube URL!\n\n**Example:** `https://www.youtube.com/watch?v=...`')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Try all strategies ─────────────────
      let result = null;

      // Strategy 1: yt-dlp with cookies (best quality, needs YOUTUBE_COOKIES)
      result = getFromYtdlp(url);

      // Strategy 2: Invidious API (no cookies, works on Railway)
      if (!result) {
        result = await getFromInvidious(videoId);
      }

      if (!result) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Cannot Play')
            .setDescription([
              'Could not get audio stream from YouTube.',
              '',
              '**To enable music on Railway:**',
              '1. Install **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/cclelndahbckbenkjhflpdbgdldlbecc)** Chrome extension',
              '2. Go to youtube.com → click extension → Export',
              '3. Copy the file contents',
              '4. Railway → Variables → `YOUTUBE_COOKIES` → paste',
            ].join('\n'))
            .setColor(colors.ERROR)],
        });
      }

      const { audioUrl, title, duration, thumb } = result;

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

      // ── ffmpeg → PCM 48kHz stereo ──────────
      const ff = spawn(ffmpegPath, [
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
        '-i', audioUrl,
        '-f', 's16le', '-ar', '48000', '-ac', '2',
        '-loglevel', 'error', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      ff.stderr.on('data', d => console.log('ffmpeg:', d.toString().trim()));
      ff.on('error', e => console.error('ffmpeg error:', e.message));

      const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Playing, () => console.log(`▶ Playing: "${title}"`));
      player.on(AudioPlayerStatus.Idle, () => { try { ff.kill(); } catch {} });
      player.on('error', e => { console.error('Player:', e.message); try { ff.kill(); } catch {} });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch { connection.destroy(); try { ff.kill(); } catch {} }
      });

      // ── Now Playing embed ──────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
        .setColor(colors.ACCENT)
        .setURL(`https://www.youtube.com/watch?v=${videoId}`)
        .setFooter({ text: '/stop to stop • Core Game Bot' })
        .setTimestamp();
      if (thumb) embed.setThumbnail(thumb);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Play error:', error.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try another video.')
          .setColor(colors.ERROR)],
      });
    }
  },
};

function fmtSec(s) {
  if (!s) return 'Live 🔴';
  s = parseInt(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

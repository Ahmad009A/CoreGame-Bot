/**
 * YouTube.js — Audio stream extraction via Invidious API
 * Invidious is an open-source YouTube frontend that proxies YouTube content
 * Works from ANY IP including Railway datacenter — no cookies, no account, no bot detection
 * Pipeline: Invidious API (audio URL) → prism.FFmpeg (s16le) → StreamType.Raw → Discord
 */

const axios = require('axios');
const YouTube = require('youtube-sr').default;
const prism = require('prism-media');

// Point prism-media to bundled ffmpeg-static binary
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;
console.log(`[YouTube] ffmpeg: ${ffmpegPath}`);

// Public Invidious instances — tried in order, falls back on failure
// These are community-run proxies that work from any IP
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://yt.cdaut.de',
  'https://invidious.lunar.icu',
];

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

// Get video info + audio URL from Invidious API
async function getInvidiousData(videoId) {
  let lastError;
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`[Invidious] Trying: ${instance}`);
      const res = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      const data = res.data;

      // Find best audio format (highest bitrate audio-only)
      const audioFormats = (data.adaptiveFormats || [])
        .filter(f => f.type?.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      // Fallback to combined formats if no audio-only
      const allFormats = (data.formatStreams || []).filter(f => f.url);

      const bestAudio = audioFormats[0] || allFormats[0];
      if (!bestAudio) throw new Error('No audio format found');

      console.log(`[Invidious] ✅ Got audio URL from ${instance} (bitrate: ${bestAudio.bitrate || 'N/A'})`);

      return {
        title: data.title,
        audioUrl: bestAudio.url,
        duration: data.lengthSeconds || 0,
        thumbnail: data.videoThumbnails?.[0]?.url,
        instance,
      };
    } catch (err) {
      console.error(`[Invidious] ${instance} failed:`, err.message?.substring(0, 80));
      lastError = err;
    }
  }
  throw new Error(`All Invidious instances failed: ${lastError?.message}`);
}

// ── Search YouTube (pure Node.js, no API key needed) ──
async function search(query, limit = 1) {
  const results = await YouTube.search(query, { limit, type: 'video' });
  return results.map(v => ({
    title: v.title || 'Unknown',
    url: v.url,
    videoId: v.id,
    duration: v.duration || 0,
    durationFormatted: v.durationFormatted || '?',
    thumbnail: v.thumbnail?.url || null,
    platform: 'youtube',
  }));
}

// ── Get video metadata from URL ──
async function getInfo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Cannot extract video ID from: ${url}`);

  console.log(`[YouTube] Getting info for: ${videoId}`);
  const data = await getInvidiousData(videoId);

  return {
    title: data.title || 'YouTube Audio',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    duration: data.duration,
    durationFormatted: formatSec(data.duration),
    thumbnail: data.thumbnail,
    platform: 'youtube',
  };
}

// ── Get audio stream via Invidious → prism.FFmpeg → StreamType.Raw ──
async function getStream(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Cannot extract video ID from: ${url}`);

  console.log(`[YouTube] Getting stream for: ${videoId}`);
  const data = await getInvidiousData(videoId);

  console.log(`[YouTube] Creating prism.FFmpeg transcoder...`);

  // Reference pipeline: prism.FFmpeg → s16le 48kHz 2ch → StreamType.Raw
  const transcoder = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', data.audioUrl,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-vn',
      '-f', 's16le',    // Raw PCM — StreamType.Raw
      '-ar', '48000',   // 48kHz
      '-ac', '2',       // stereo
    ],
    shell: false,
  });

  transcoder.on('error', err => console.error('[FFmpeg]', err.message));

  return { stream: transcoder, type: 'raw' };
}

function formatSec(s) {
  if (!s || isNaN(s)) return 'Live 🔴';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { search, getInfo, getStream, extractVideoId };

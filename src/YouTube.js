/**
 * YouTube.js — Audio stream extraction using youtube-dl-exec (yt-dlp wrapper)
 * Follows the reference architecture exactly:
 * yt-dlp → prism.FFmpeg (s16le 48kHz 2ch) → StreamType.Raw → Discord
 */

const youtubedl = require('youtube-dl-exec');
const YouTube = require('youtube-sr').default;
const prism = require('prism-media');

// Point prism-media to the bundled ffmpeg-static binary
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;
console.log(`[YouTube] Using ffmpeg: ${ffmpegPath}`);

// ── Build yt-dlp base options (reference: getYtDlpOptions) ──
function getYtDlpOptions() {
  return {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    quiet: true,
    retries: 3,
    // iOS client fallback — bypasses datacenter IP bot detection
    extractorArgs: 'youtube:player_client=ios,web_creator',
    userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
    geoBypass: true,
  };
}

// ── Search YouTube — returns track metadata ──
async function search(query, limit = 1) {
  const results = await YouTube.search(query, { limit, type: 'video' });
  return results.map(v => ({
    title: v.title || 'Unknown',
    url: v.url,
    duration: v.duration || 0,
    durationFormatted: v.durationFormatted || '?',
    thumbnail: v.thumbnail?.url || null,
    platform: 'youtube',
    type: 'track',
  }));
}

// ── Get track info from URL ──
async function getInfo(url) {
  const opts = {
    ...getYtDlpOptions(),
    dumpSingleJson: true,
    format: 'bestaudio/best',
  };

  const info = await youtubedl(url, opts);
  return {
    title: info.title,
    url: info.webpage_url || url,
    duration: info.duration || 0,
    durationFormatted: formatSec(info.duration),
    thumbnail: info.thumbnail,
    platform: 'youtube',
    type: 'track',
  };
}

// ── Get audio stream — reference pipeline ──
// Returns a prism.FFmpeg stream (StreamType.Raw: s16le 48kHz 2ch)
async function getStream(url) {
  // Step 1: Get the direct audio URL from yt-dlp
  const opts = {
    ...getYtDlpOptions(),
    dumpSingleJson: true,
    format: 'bestaudio/best',
  };

  const info = await youtubedl(url, opts);
  const audioUrl = info.url;

  if (!audioUrl) throw new Error('No audio URL from yt-dlp');

  console.log(`[YouTube] Audio URL ready (${info.format_id || 'best'})`);

  // Step 2: Create prism.FFmpeg transcoder
  // Reference: prism.FFmpeg -f s16le -ar 48000 -ac 2 → StreamType.Raw
  const transcoder = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', audioUrl,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-vn',              // no video
      '-f', 's16le',      // raw PCM signed 16-bit little-endian
      '-ar', '48000',     // 48kHz sample rate
      '-ac', '2',         // stereo
    ],
    shell: false,
  });

  transcoder.on('error', (err) => {
    console.error('[FFmpeg] Error:', err.message);
  });

  return {
    stream: transcoder,
    type: 'raw', // StreamType.Raw
    info,
  };
}

function formatSec(s) {
  if (!s || isNaN(s)) return 'Live 🔴';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { search, getInfo, getStream };

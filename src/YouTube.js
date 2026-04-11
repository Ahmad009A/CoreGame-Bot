/**
 * YouTube.js — Audio stream extraction
 * Uses youtube-dl-exec (yt-dlp wrapper) with mobile web client
 * mweb client bypasses datacenter IP bot detection without cookies
 * Pipeline: yt-dlp (audio URL) → prism.FFmpeg (s16le) → StreamType.Raw → Discord
 */

const youtubedl = require('youtube-dl-exec');
const YouTube = require('youtube-sr').default;
const prism = require('prism-media');

// Point prism-media to bundled ffmpeg-static binary
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;
console.log(`[YouTube] ffmpeg: ${ffmpegPath}`);

// ── yt-dlp options that bypass bot detection without cookies ──
// Priority order (reference): poToken > cookies > iOS > mweb fallback
function getYtDlpOptions() {
  const opts = {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    retries: 5,
    bufferSize: '16K',
    geoBypass: true,
  };

  // Try mweb (mobile web) first — bypasses bot detection on datacenter IPs
  // mweb uses a different YouTube API endpoint with less strict rate limiting
  return opts;
}

// Build extractor args — try multiple clients in order
const EXTRACTOR_CLIENTS = [
  'mweb',           // Mobile web — bypasses most datacenter blocks
  'tv_embedded',    // TV embedded — no sign-in required
  'ios',            // iOS app client
];

// ── Search YouTube ──
async function search(query, limit = 1) {
  const results = await YouTube.search(query, { limit, type: 'video' });
  return results.map(v => ({
    title: v.title || 'Unknown',
    url: v.url,
    duration: v.duration || 0,
    durationFormatted: v.durationFormatted || '?',
    thumbnail: v.thumbnail?.url || null,
    platform: 'youtube',
  }));
}

// ── Get video info from URL ──
async function getInfo(url) {
  let lastError;

  for (const client of EXTRACTOR_CLIENTS) {
    try {
      console.log(`[YouTube] Getting info with client: ${client}`);
      const info = await youtubedl(url, {
        ...getYtDlpOptions(),
        dumpSingleJson: true,
        format: 'bestaudio/best',
        extractorArgs: `youtube:player_client=${client}`,
      });
      return {
        title: info.title,
        url: info.webpage_url || url,
        duration: info.duration || 0,
        durationFormatted: formatSec(info.duration),
        thumbnail: info.thumbnail,
        platform: 'youtube',
      };
    } catch (err) {
      console.error(`[YouTube] getInfo failed (${client}):`, err.message?.substring(0, 100));
      lastError = err;
    }
  }
  throw lastError;
}

// ── Get audio stream ──
// Returns prism.FFmpeg stream (StreamType.Raw: s16le 48kHz 2ch) — reference pipeline
async function getStream(url) {
  let lastError;

  for (const client of EXTRACTOR_CLIENTS) {
    try {
      console.log(`[YouTube] Getting stream with client: ${client}`);

      // Get direct audio URL via yt-dlp
      const info = await youtubedl(url, {
        ...getYtDlpOptions(),
        dumpSingleJson: true,
        format: 'bestaudio[ext=m4a]/bestaudio/best',
        extractorArgs: `youtube:player_client=${client}`,
      });

      const audioUrl = info.url;
      if (!audioUrl) throw new Error('No audio URL returned');

      console.log(`[YouTube] ✅ Got stream URL (client=${client}, format=${info.format_id})`);

      // Create prism.FFmpeg transcoder — reference: s16le 48kHz 2ch → StreamType.Raw
      const transcoder = new prism.FFmpeg({
        args: [
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', audioUrl,
          '-analyzeduration', '0',
          '-loglevel', '0',
          '-vn',
          '-f', 's16le',      // Raw PCM — reference StreamType.Raw
          '-ar', '48000',     // 48kHz
          '-ac', '2',         // stereo
        ],
        shell: false,
      });

      transcoder.on('error', err => {
        console.error('[FFmpeg] Error:', err.message);
      });

      return { stream: transcoder, type: 'raw' };

    } catch (err) {
      console.error(`[YouTube] getStream failed (${client}):`, err.message?.substring(0, 150));
      lastError = err;
    }
  }

  throw lastError;
}

function formatSec(s) {
  if (!s || isNaN(s)) return 'Live 🔴';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { search, getInfo, getStream };

/**
 * YouTube.js — Audio stream extraction
 * Uses youtube-dl-exec (yt-dlp wrapper) with mobile web client
 * mweb/tv_embedded clients bypass datacenter IP bot detection without cookies
 * Pipeline: yt-dlp (audio URL) → prism.FFmpeg (s16le) → StreamType.Raw → Discord
 */

const { create: createYoutubedl } = require('youtube-dl-exec');
const YouTube = require('youtube-sr').default;
const prism = require('prism-media');
const fs = require('fs');

// Point prism-media to bundled ffmpeg-static binary
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

// Locate yt-dlp binary — curl installs to /usr/local/bin on Railway
const YTDLP_PATH = fs.existsSync('/usr/local/bin/yt-dlp')
  ? '/usr/local/bin/yt-dlp'
  : 'yt-dlp';

console.log(`[YouTube] yt-dlp binary: ${YTDLP_PATH}`);
console.log(`[YouTube] ffmpeg binary: ${ffmpegPath}`);

// Create youtube-dl-exec instance with the correct binary path
const youtubedl = createYoutubedl(YTDLP_PATH);

// Try multiple clients — each bypasses YouTube bot detection differently
const EXTRACTOR_CLIENTS = [
  'mweb',           // Mobile web — fewest restrictions on datacenter IPs
  'tv_embedded',    // YouTube TV — no sign-in required
  'ios',            // iPhone app — different rate limits
];

// Base yt-dlp options
function baseOpts() {
  return {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    retries: 3,
    geoBypass: true,
  };
}

// ── Search YouTube (pure Node.js, no yt-dlp needed) ──
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

// ── Get video metadata from URL ──
async function getInfo(url) {
  let lastError;
  for (const client of EXTRACTOR_CLIENTS) {
    try {
      console.log(`[YouTube] getInfo client=${client}`);
      const info = await youtubedl(url, {
        ...baseOpts(),
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
      console.error(`[YouTube] getInfo (${client}) failed:`, err.message?.substring(0, 120));
      lastError = err;
    }
  }
  throw lastError;
}

// ── Get audio stream → prism.FFmpeg (StreamType.Raw) ──
async function getStream(url) {
  let lastError;
  for (const client of EXTRACTOR_CLIENTS) {
    try {
      console.log(`[YouTube] getStream client=${client}`);

      // Get direct audio stream URL via yt-dlp
      const info = await youtubedl(url, {
        ...baseOpts(),
        dumpSingleJson: true,
        format: 'bestaudio[ext=m4a]/bestaudio/best',
        extractorArgs: `youtube:player_client=${client}`,
      });

      const audioUrl = info.url;
      if (!audioUrl) throw new Error('No audio URL');

      console.log(`[YouTube] ✅ Stream ready (client=${client}, format=${info.format_id})`);

      // Reference pipeline: prism.FFmpeg → s16le 48kHz 2ch → StreamType.Raw
      const transcoder = new prism.FFmpeg({
        args: [
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', audioUrl,
          '-analyzeduration', '0',
          '-loglevel', '0',
          '-vn',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
        ],
        shell: false,
      });

      transcoder.on('error', err => console.error('[FFmpeg]', err.message));

      return { stream: transcoder, type: 'raw' };

    } catch (err) {
      console.error(`[YouTube] getStream (${client}) failed:`, err.message?.substring(0, 150));
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

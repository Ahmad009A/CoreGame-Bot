/**
 * YouTube.js — Audio stream extraction via yt-dlp
 * Pipeline: yt-dlp (get audio URL) → createAudioResource → Discord
 * 
 * Uses system yt-dlp (installed via pip in nixpacks) with fallback to
 * yt-dlp-exec npm package. No cookies, no accounts needed.
 */

const { execSync, spawn } = require('child_process');
const YouTube = require('youtube-sr').default;

// Find yt-dlp binary path
let YT_DLP_PATH = 'yt-dlp';
try {
  // Check if system yt-dlp is available (nixpacks installs it)
  execSync('yt-dlp --version', { stdio: 'pipe' });
  console.log('[YouTube] Using system yt-dlp');
} catch {
  try {
    // Fallback to npm yt-dlp-exec
    const ytDlpExec = require('yt-dlp-exec');
    YT_DLP_PATH = ytDlpExec.path || 'yt-dlp';
    console.log('[YouTube] Using npm yt-dlp-exec');
  } catch {
    console.warn('[YouTube] ⚠️ No yt-dlp found — music will not work');
  }
}

// ── Search YouTube (pure Node.js, no API key) ──
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

// ── Get video info from URL ──
async function getInfo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Cannot extract video ID from: ${url}`);

  console.log(`[YouTube] getInfo: ${videoId}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, [
      '--dump-single-json',
      '--no-warnings',
      '--no-call-home',
      '--skip-download',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp info failed: ${stderr.substring(0, 200)}`));
      try {
        const data = JSON.parse(stdout);
        resolve({
          title: data.title || 'YouTube Audio',
          url: `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          duration: data.duration || 0,
          durationFormatted: formatSec(data.duration),
          thumbnail: data.thumbnail || null,
          platform: 'youtube',
        });
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('yt-dlp info timed out'));
    }, 15000);
  });
}

// ── Get audio stream URL via yt-dlp ──
async function getStreamUrl(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Cannot extract video ID from: ${url}`);

  console.log(`[YouTube] getStreamUrl: ${videoId}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, [
      '--dump-single-json',
      '--no-warnings',
      '--no-call-home',
      '--format', 'bestaudio',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp stream failed: ${stderr.substring(0, 200)}`));
      try {
        const data = JSON.parse(stdout);
        if (!data.url) return reject(new Error('No audio URL found'));
        console.log(`[YouTube] ✅ Got audio URL (${data.acodec || 'unknown'}, ${data.abr || '?'}kbps)`);
        resolve({
          audioUrl: data.url,
          title: data.title,
          duration: data.duration,
        });
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    // Timeout after 20 seconds
    setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('yt-dlp stream timed out'));
    }, 20000);
  });
}

// ── Extract video ID from YouTube URL ──
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

function formatSec(s) {
  if (!s || isNaN(s)) return 'Live 🔴';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
}

module.exports = { search, getInfo, getStreamUrl, extractVideoId };

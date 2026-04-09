/**
 * postinstall.js — Runs after npm install
 * Downloads yt-dlp binary for Linux (Railway)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const isLinux = process.platform === 'linux';
const binDir = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

// Only download on Linux (Railway) if binary missing or wrong platform
if (isLinux && !fs.existsSync(ytdlpPath)) {
  console.log('[postinstall] Downloading yt-dlp for Linux...');

  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  const file = fs.createWriteStream(ytdlpPath);

  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      https.get(res.headers.location, (res2) => {
        res2.pipe(file);
        file.on('finish', () => {
          file.close();
          try {
            execSync(`chmod +x "${ytdlpPath}"`);
            console.log('[postinstall] yt-dlp downloaded and made executable.');
          } catch (e) {
            console.error('[postinstall] chmod failed:', e.message);
          }
        });
      });
    } else {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        try {
          execSync(`chmod +x "${ytdlpPath}"`);
          console.log('[postinstall] yt-dlp downloaded and made executable.');
        } catch (e) {
          console.error('[postinstall] chmod failed:', e.message);
        }
      });
    }
  }).on('error', (e) => {
    console.error('[postinstall] Failed to download yt-dlp:', e.message);
  });
} else {
  console.log('[postinstall] yt-dlp already present or not Linux, skipping download.');
}

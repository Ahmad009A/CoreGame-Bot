/**
 * postinstall.js — Ensure yt-dlp binary is available
 * On Linux (Railway): creates symlink from system yt-dlp to node_modules path
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isLinux = process.platform === 'linux';

if (!isLinux) {
  console.log('[postinstall] Not Linux, skipping yt-dlp setup.');
  process.exit(0);
}

// yt-dlp-exec expects binary at node_modules/yt-dlp-exec/bin/yt-dlp
const binDir = path.join(__dirname, '..', 'node_modules', 'yt-dlp-exec', 'bin');
const binPath = path.join(binDir, 'yt-dlp');

if (fs.existsSync(binPath)) {
  console.log('[postinstall] yt-dlp binary already exists.');
  process.exit(0);
}

// Try to find system yt-dlp
try {
  const systemPath = execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
  if (systemPath) {
    // Create bin directory and symlink
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(systemPath, binPath);
    console.log(`[postinstall] Symlinked yt-dlp: ${systemPath} → ${binPath}`);
    process.exit(0);
  }
} catch (e) {
  console.log('[postinstall] System yt-dlp not found, downloading...');
}

// Download yt-dlp binary
const https = require('https');

if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

function download(url) {
  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      return download(res.headers.location);
    }
    const file = fs.createWriteStream(binPath);
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      execSync(`chmod +x "${binPath}"`);
      console.log('[postinstall] yt-dlp downloaded successfully.');
    });
  }).on('error', (e) => {
    console.error('[postinstall] Download failed:', e.message);
  });
}

download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');

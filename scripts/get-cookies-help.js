/**
 * GET YOUTUBE COOKIES HELPER
 * 
 * Run this in your browser Console on youtube.com
 * Then paste the output as YOUTUBE_COOKIES in Railway
 * 
 * Instructions:
 * 1. Open https://www.youtube.com in Chrome/Edge
 * 2. Press F12 → Console tab
 * 3. Paste everything below and press Enter
 * 4. Copy the output text
 * 5. In Railway → Variables → YOUTUBE_COOKIES → paste it
 */

// Paste this in browser console on youtube.com:
/*
(function() {
  const cookies = document.cookie.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=');
    const value = rest.join('=');
    return `.youtube.com\tTRUE\t/\tFALSE\t${Math.floor(Date.now()/1000) + 31536000}\t${name.trim()}\t${value.trim()}`;
  });
  
  const header = `# Netscape HTTP Cookie File\n# This file is generated manually.\n\n`;
  const result = header + cookies.join('\n');
  console.log('=== COPY EVERYTHING BELOW ===');
  console.log(result);
  console.log('=== END ===');
  
  // Also try to copy to clipboard
  navigator.clipboard.writeText(result).then(() => {
    console.log('✅ Copied to clipboard!');
  }).catch(() => {
    console.log('⚠️ Copy manually from above');
  });
})();
*/

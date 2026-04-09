/**
 * Core Game Bot — Welcome Canvas Image Generator
 * Creates a stunning gaming-themed welcome banner with user avatar
 * Supports custom uploaded background images
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const logger = require('./logger');

// ── Colors ─────────────────────────────────────
const COLORS = {
  bg1: '#0F0F1A',       // Deep dark
  bg2: '#1A1A2E',       // Dark purple
  accent: '#7C3AED',    // Purple
  accentLight: '#A855F7', // Light purple
  blue: '#3B82F6',      // Blue
  white: '#FFFFFF',
  whiteAlpha: 'rgba(255, 255, 255, 0.7)',
  gold: '#FFD700',
  glow: 'rgba(124, 58, 237, 0.4)', // Purple glow
};

/**
 * Generate a welcome banner image
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} customBgUrl - URL to a custom background image
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateWelcomeImage(member, customBgUrl = null) {
  const WIDTH = 1024;
  const HEIGHT = 450;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // ═══════════════════════════════════════════
  //   BACKGROUND
  // ═══════════════════════════════════════════

  if (customBgUrl) {
    try {
      const bgImage = await loadImage(customBgUrl);
      // Draw and cover the entire canvas
      const scale = Math.max(WIDTH / bgImage.width, HEIGHT / bgImage.height);
      const w = bgImage.width * scale;
      const h = bgImage.height * scale;
      ctx.drawImage(bgImage, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);

      // Add dark overlay for text readability
      ctx.fillStyle = 'rgba(15, 15, 26, 0.55)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    } catch (err) {
      logger.warn(`Failed to load custom welcome BG: ${err.message}`);
      drawDefaultBackground(ctx, WIDTH, HEIGHT);
    }
  } else {
    drawDefaultBackground(ctx, WIDTH, HEIGHT);
  }

  // ═══════════════════════════════════════════
  //   DECORATIVE ELEMENTS
  // ═══════════════════════════════════════════

  // Top & bottom accent lines
  const lineGrad = ctx.createLinearGradient(0, 0, WIDTH, 0);
  lineGrad.addColorStop(0, 'transparent');
  lineGrad.addColorStop(0.3, COLORS.accent);
  lineGrad.addColorStop(0.7, COLORS.blue);
  lineGrad.addColorStop(1, 'transparent');

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, 0, WIDTH, 4);
  ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);

  // Side glow effects
  const leftGlow = ctx.createRadialGradient(0, HEIGHT / 2, 10, 0, HEIGHT / 2, 250);
  leftGlow.addColorStop(0, 'rgba(124, 58, 237, 0.15)');
  leftGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, 0, 300, HEIGHT);

  const rightGlow = ctx.createRadialGradient(WIDTH, HEIGHT / 2, 10, WIDTH, HEIGHT / 2, 250);
  rightGlow.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
  rightGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = rightGlow;
  ctx.fillRect(WIDTH - 300, 0, 300, HEIGHT);

  // Floating particles (small dots)
  drawParticles(ctx, WIDTH, HEIGHT);

  // ═══════════════════════════════════════════
  //   AVATAR
  // ═══════════════════════════════════════════

  const avatarSize = 150;
  const avatarX = WIDTH / 2;
  const avatarY = 155;

  // Avatar glow ring
  ctx.save();
  const glowGrad = ctx.createRadialGradient(avatarX, avatarY, avatarSize / 2, avatarX, avatarY, avatarSize / 2 + 20);
  glowGrad.addColorStop(0, COLORS.accent);
  glowGrad.addColorStop(0.5, 'rgba(124, 58, 237, 0.3)');
  glowGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2 + 20, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();
  ctx.restore();

  // Avatar border ring
  ctx.save();
  const borderGrad = ctx.createLinearGradient(
    avatarX - avatarSize / 2, avatarY - avatarSize / 2,
    avatarX + avatarSize / 2, avatarY + avatarSize / 2
  );
  borderGrad.addColorStop(0, COLORS.accent);
  borderGrad.addColorStop(1, COLORS.blue);
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2 + 5, 0, Math.PI * 2);
  ctx.fillStyle = borderGrad;
  ctx.fill();
  ctx.restore();

  // Clip and draw avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  try {
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarUrl);
    ctx.drawImage(avatar, avatarX - avatarSize / 2, avatarY - avatarSize / 2, avatarSize, avatarSize);
  } catch {
    // Fallback: solid circle
    ctx.fillStyle = COLORS.accent;
    ctx.fill();
  }
  ctx.restore();

  // ═══════════════════════════════════════════
  //   TEXT
  // ═══════════════════════════════════════════

  // "WELCOME" header — above avatar
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.whiteAlpha;
  ctx.font = 'bold 18px "Segoe UI", "Noto Sans", Arial, sans-serif';
  ctx.fillText('W E L C O M E', avatarX, 50);

  // Kurdish subtitle
  ctx.fillStyle = COLORS.accentLight;
  ctx.font = '16px "Segoe UI", "Noto Sans Arabic", "Tahoma", Arial, sans-serif';
  ctx.fillText('بەخێربێیت بۆ سێرڤەرەکەمان', avatarX, 75);

  // Username
  const displayName = member.displayName || member.user.username;
  ctx.fillStyle = COLORS.white;
  ctx.font = `bold 36px "Segoe UI", "Noto Sans", Arial, sans-serif`;
  ctx.fillText(truncateText(ctx, displayName, WIDTH - 200), avatarX, 275);

  // Tag / discriminator line
  ctx.fillStyle = COLORS.whiteAlpha;
  ctx.font = '18px "Segoe UI", "Noto Sans", Arial, sans-serif';
  ctx.fillText(`@${member.user.username}`, avatarX, 305);

  // Separator line
  const sepGrad = ctx.createLinearGradient(WIDTH / 2 - 150, 0, WIDTH / 2 + 150, 0);
  sepGrad.addColorStop(0, 'transparent');
  sepGrad.addColorStop(0.5, COLORS.accent);
  sepGrad.addColorStop(1, 'transparent');
  ctx.strokeStyle = sepGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 150, 325);
  ctx.lineTo(WIDTH / 2 + 150, 325);
  ctx.stroke();

  // Member count
  ctx.fillStyle = COLORS.white;
  ctx.font = 'bold 22px "Segoe UI", "Noto Sans", Arial, sans-serif';
  ctx.fillText(`Member #${member.guild.memberCount}`, avatarX, 365);

  // Server name
  ctx.fillStyle = COLORS.whiteAlpha;
  ctx.font = '16px "Segoe UI", "Noto Sans", Arial, sans-serif';
  ctx.fillText(member.guild.name, avatarX, 395);

  // Bottom branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillText('Core Game Bot • کۆری گەیم', avatarX, HEIGHT - 15);

  // ═══════════════════════════════════════════
  //   RETURN BUFFER
  // ═══════════════════════════════════════════

  return canvas.toBuffer('image/png');
}

// ═══════════════════════════════════════════════
//   HELPER FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Draw the default gradient background when no custom image is provided
 */
function drawDefaultBackground(ctx, w, h) {
  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, COLORS.bg1);
  grad.addColorStop(0.5, COLORS.bg2);
  grad.addColorStop(1, '#0D1B2A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Radial center glow
  const centerGlow = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, 350);
  centerGlow.addColorStop(0, 'rgba(124, 58, 237, 0.12)');
  centerGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, w, h);

  // Hexagon grid pattern (gaming style)
  drawHexGrid(ctx, w, h);
}

/**
 * Draw a subtle hexagonal grid pattern
 */
function drawHexGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.06)';
  ctx.lineWidth = 1;

  const size = 40;
  const horiz = size * Math.sqrt(3);
  const vert = size * 1.5;

  for (let row = -1; row < h / vert + 1; row++) {
    for (let col = -1; col < w / horiz + 1; col++) {
      const x = col * horiz + (row % 2 === 0 ? 0 : horiz / 2);
      const y = row * vert;
      drawHexagon(ctx, x, y, size);
    }
  }
}

function drawHexagon(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Draw floating particle dots
 */
function drawParticles(ctx, w, h) {
  // Use a fixed seed for consistency
  const particles = [
    { x: 80, y: 90, r: 2 }, { x: 200, y: 40, r: 1.5 },
    { x: 350, y: 120, r: 1 }, { x: 500, y: 30, r: 2 },
    { x: 650, y: 100, r: 1.5 }, { x: 800, y: 60, r: 1 },
    { x: 900, y: 130, r: 2 }, { x: 150, y: 380, r: 1 },
    { x: 400, y: 400, r: 1.5 }, { x: 700, y: 370, r: 1 },
    { x: 950, y: 350, r: 2 }, { x: 50, y: 250, r: 1 },
    { x: 980, y: 220, r: 1.5 }, { x: 300, y: 300, r: 1 },
    { x: 750, y: 280, r: 2 },
  ];

  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(168, 85, 247, ${0.2 + Math.random() * 0.4})`;
    ctx.fill();
  }
}

/**
 * Truncate text to fit within max width
 */
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

module.exports = { generateWelcomeImage };

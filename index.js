/**
 * ═══════════════════════════════════════════════
 *         CORE GAME BOT — Entry Point
 *         Production-Ready Discord Bot
 * ═══════════════════════════════════════════════
 */

require('dotenv').config();

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const logger = require('./utils/logger');
const connectDatabase = require('./config/database');
const loadCommands = require('./handlers/commandHandler');
const loadEvents = require('./handlers/eventHandler');
const { startDashboard } = require('./web/server');

// ── Validate critical env vars ─────────────────
if (!process.env.BOT_TOKEN) {
  console.error('FATAL: BOT_TOKEN environment variable is missing!');
  console.error('Set BOT_TOKEN in Railway Variables.');
  process.exit(1);
}

if (!process.env.CLIENT_ID) {
  console.error('FATAL: CLIENT_ID environment variable is missing!');
  console.error('Set CLIENT_ID in Railway Variables.');
  process.exit(1);
}

// ── Create Discord Client ──────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel,
    Partials.Message,
  ],
});

// ── Collections ────────────────────────────────
client.commands = new Collection();       // Slash commands
client.cooldowns = new Collection();      // Cooldown tracker
client.vipChannels = new Collection();    // VIP voice channel tracker

// ── Initialize Bot ─────────────────────────────
(async () => {
  try {
    // Connect to MongoDB (optional — bot works without it)
    await connectDatabase();

    // Load command & event handlers
    await loadCommands(client);
    await loadEvents(client);

    // Login
    await client.login(process.env.BOT_TOKEN);

    // Start web dashboard
    startDashboard(client);

    logger.info('Bot startup complete ✅');
  } catch (error) {
    logger.error(`Fatal startup error: ${error.message}`);
    logger.error(error.stack);
    // Don't exit immediately — let Railway see the error
    setTimeout(() => process.exit(1), 5000);
  }
})();

// ── Graceful Error Handling ────────────────────
// DON'T crash on unhandled rejections — log and continue
process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled Rejection: ${error?.message || error}`);
  if (error?.stack) logger.error(error.stack);
});

// DON'T crash on uncaught exceptions — log and continue
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error?.message || error}`);
  if (error?.stack) logger.error(error.stack);
  // Only exit on truly fatal errors
  if (error?.code === 'EADDRINUSE' || error?.message?.includes('TOKEN_INVALID')) {
    setTimeout(() => process.exit(1), 3000);
  }
});

process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  client.destroy();
  process.exit(0);
});

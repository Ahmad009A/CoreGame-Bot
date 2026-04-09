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
    // Connect to MongoDB
    await connectDatabase();

    // Load command & event handlers
    await loadCommands(client);
    await loadEvents(client);

    // Login
    await client.login(process.env.BOT_TOKEN);

    // Start web dashboard
    startDashboard(client);
  } catch (error) {
    logger.error(`Fatal startup error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
})();

// ── Graceful Shutdown ──────────────────────────
process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled Rejection: ${error.message}`);
  logger.error(error.stack);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
});

process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

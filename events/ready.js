/**
 * Core Game Bot — Ready Event
 * Fires once when the bot successfully logs in
 */

const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    logger.info(`═══════════════════════════════════════`);
    logger.info(`  🎮 Core Game Bot is ONLINE!`);
    logger.info(`  📛 Logged in as: ${client.user.tag}`);
    logger.info(`  🌐 Serving ${client.guilds.cache.size} server(s)`);
    logger.info(`  👥 Watching ${client.users.cache.size} user(s)`);
    logger.info(`═══════════════════════════════════════`);

    // ── Set Rich Presence ──────────────────────
    client.user.setPresence({
      activities: [{
        name: '🎮 Core Game | /help',
        type: ActivityType.Playing,
      }],
      status: 'online',
    });

    // Rotate presence every 30 seconds
    const statuses = [
      { name: '🎮 Core Game | /help', type: ActivityType.Playing },
      { name: `👥 ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} members`, type: ActivityType.Watching },
      { name: '🎫 /ticket | کۆری گەیم', type: ActivityType.Listening },
      { name: '🎁 /spin for rewards!', type: ActivityType.Playing },
    ];

    let i = 0;
    setInterval(() => {
      i = (i + 1) % statuses.length;
      client.user.setActivity(statuses[i].name, { type: statuses[i].type });
    }, 30_000);
  },
};

/**
 * Core Game Bot — Event Handler
 * Loads all event files from /events directory
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Load all event files and attach them to the client
 * @param {import('discord.js').Client} client
 */
async function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');

  if (!fs.existsSync(eventsPath)) {
    logger.warn('Events directory not found. No events loaded.');
    return;
  }

  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
  let count = 0;

  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));

      // Support custom register() pattern (e.g., rankTracker)
      if (event.register && typeof event.register === 'function') {
        await event.register(client);
        count++;
        continue;
      }

      if (!event.name || !event.execute) {
        logger.warn(`⚠️  Event ${file} is missing name or execute export`);
        continue;
      }

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }

      count++;
    } catch (error) {
      logger.error(`Failed to load event ${file}: ${error.message}`);
    }
  }

  logger.info(`⚡ Loaded ${count} events`);
}

module.exports = loadEvents;

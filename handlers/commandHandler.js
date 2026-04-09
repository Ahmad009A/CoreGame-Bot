/**
 * Core Game Bot — Command Handler
 * Recursively loads all slash commands from /commands subdirectories
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Load all command files into client.commands Collection
 * @param {import('discord.js').Client} client
 */
async function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');

  if (!fs.existsSync(commandsPath)) {
    logger.warn('Commands directory not found. No commands loaded.');
    return;
  }

  let count = 0;

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.js')) continue;

      try {
        const command = require(fullPath);

        if (!command.data || !command.execute) {
          logger.warn(`⚠️  Command ${entry.name} is missing data or execute export`);
          continue;
        }

        client.commands.set(command.data.name, command);
        count++;
      } catch (error) {
        logger.error(`Failed to load command ${entry.name}: ${error.message}`);
      }
    }
  }

  scanDir(commandsPath);
  logger.info(`📦 Loaded ${count} slash commands`);
}

module.exports = loadCommands;

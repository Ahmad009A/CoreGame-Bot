/**
 * ═══════════════════════════════════════════════
 *    CORE GAME BOT — Slash Command Deployer
 *    Run: node deploy-commands.js
 * ═══════════════════════════════════════════════
 */

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

/**
 * Recursively read all command files from subdirectories
 */
function loadCommandFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommandFiles(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if (command.data && command.execute) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded command: /${command.data.name}`);
      } else {
        console.warn(`⚠️  Skipping ${fullPath} — missing data or execute`);
      }
    }
  }
}

loadCommandFiles(commandsPath);

// ── Deploy ─────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log(`\n🔄 Deploying ${commands.length} slash commands...\n`);

    if (process.env.GUILD_ID) {
      // Guild-specific (instant, good for development)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands },
      );
      console.log(`✅ Successfully deployed ${commands.length} commands to guild ${process.env.GUILD_ID}`);
    } else {
      // Global (takes up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );
      console.log(`✅ Successfully deployed ${commands.length} commands globally`);
    }
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
  }
})();

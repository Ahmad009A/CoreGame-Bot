const { MessageFlags } = require('discord.js');
const embeds = require('./embeds');

// Hardcoded bot-use channel ID
const BOT_USE_CHANNEL_ID = '1491193021734326293';

/**
 * Restrict ALL commands to the bot-use channel unless user is admin
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean} true = allowed, false = blocked
 */
async function checkChannel(interaction) {
  const channel = interaction.channel;

  // Allow DMs through
  if (!channel || channel.isDMBased()) return true;

  // Allow if in the correct channel (by ID)
  if (channel.id === BOT_USE_CHANNEL_ID) return true;

  // Allow if user has admin permission
  if (interaction.memberPermissions?.has('Administrator')) return true;

  // Block everything else — handle both deferred and non-deferred
  const msg = {
    embeds: [
      embeds.warning(
        `⚠️ All commands can only be used in <#${BOT_USE_CHANNEL_ID}>!\n\nهەموو فەرمانەکان تەنها لە <#${BOT_USE_CHANNEL_ID}> بەکارببە.`
      ),
    ],
  };

  try {
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else if (!interaction.replied) {
      await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    // Interaction might have expired
    console.error('[checkChannel] Reply failed:', e.message);
  }

  return false;
}

module.exports = { checkChannel };

const embeds = require('./embeds');

/**
 * Restrict commands to the bot-use channel unless user is admin
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean} true = allowed, false = blocked
 */
async function checkChannel(interaction) {
  const allowedChannelName = process.env.BOT_USE_CHANNEL_NAME || 'bot-use';
  const channel = interaction.channel;

  // Allow DMs through
  if (!channel || channel.isDMBased()) return true;

  // Allow if in the correct channel
  if (channel.name === allowedChannelName) return true;

  // Allow if user has admin permission
  if (interaction.memberPermissions?.has('Administrator')) return true;

  // Allow admin-only commands regardless of channel
  const adminCommands = ['panel', 'setup-ticket', 'setwelcome', 'post', 'spin'];
  if (adminCommands.includes(interaction.commandName)) return true;

  // Allow all utility / fun commands everywhere
  const publicCommands = ['ping', 'help', 'play', 'stop'];
  if (publicCommands.includes(interaction.commandName)) return true;

  // Block otherwise
  const botChannel = interaction.guild.channels.cache.find(c => c.name === allowedChannelName);
  await interaction.reply({
    embeds: [
      embeds.warning(
        `⚠️ This command can only be used in ${botChannel ? `<#${botChannel.id}>` : `#${allowedChannelName}`}!\n\nتەنها لە کەنەلی **${allowedChannelName}** فەرمانەکان بەکاربێنە.`
      ),
    ],
    ephemeral: true,
  });

  return false;
}

module.exports = { checkChannel };

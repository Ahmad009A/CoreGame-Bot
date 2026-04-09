/**
 * Core Game Bot — /clear Command
 * Admin-only: delete messages from a channel
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete messages — سڕینەوەی پەیامەکان (Admin)')
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Number of messages to delete (1-100, or 0 for all)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Only administrators can use this command!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const amount = interaction.options.getInteger('amount');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let deleted = 0;

      if (amount === 0) {
        // Delete all messages (in batches of 100)
        let fetched;
        do {
          fetched = await interaction.channel.messages.fetch({ limit: 100 });
          // Filter messages younger than 14 days (Discord limitation)
          const deletable = fetched.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
          if (deletable.size === 0) break;
          const result = await interaction.channel.bulkDelete(deletable, true);
          deleted += result.size;
          if (result.size < 100) break;
        } while (fetched.size > 0);
      } else {
        const result = await interaction.channel.bulkDelete(amount, true);
        deleted = result.size;
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('🗑️ Messages Cleared')
          .setDescription(`Deleted **${deleted}** message(s).\n\n**${deleted}** پەیام سڕایەوە.`)
          .setColor(colors.SUCCESS)],
      });

      // Auto-delete the reply after 5 seconds
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

    } catch (error) {
      console.error('[Clear] Error:', error.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription(`❌ Error: ${error.message}`)
          .setColor(colors.ERROR)],
      });
    }
  },
};

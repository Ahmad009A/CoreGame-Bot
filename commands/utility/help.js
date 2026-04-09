/**
 * Core Game Bot — /help Command
 * Shows all available commands organized by category
 */

const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const emojis = require('../../config/emojis');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all bot commands — بینینی هەموو فەرمانەکان'),

  async execute(interaction) {
    const mainEmbed = embeds.custom({
      title: `${emojis.GAMING} Core Game Bot — Help`,
      description: [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `${emojis.SPARKLES} **Welcome to Core Game Bot!**`,
        'بەخێربێیت بۆ بۆتی کۆری گەیم!',
        '',
        'Select a category below to see available commands.',
        'جۆرێک هەڵبژێرە بۆ بینینی فەرمانەکان.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `${emojis.ADMIN} **Admin** — بەڕێوەبردن`,
        '> `/panel` `/setwelcome` `/setup-ticket` `/post` `/spin`',
        '',
        '🎵 **Music** — مۆسیقا',
        '> `/play` `/stop`',
        '',
        `${emojis.SETTINGS} **Utility** — ئامرازەکان`,
        '> `/ping` `/help`',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'),
      color: colors.PRIMARY,
      thumbnail: interaction.client.user.displayAvatarURL({ dynamic: true, size: 128 }),
      footer: {
        text: 'Core Game Bot • کۆری گەیم',
        iconURL: interaction.client.user.displayAvatarURL(),
      },
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_category_select')
      .setPlaceholder('📚 Select a category — جۆرێک هەڵبژێرە')
      .addOptions([
        {
          label: '🛠️ Admin Commands',
          value: 'help_admin',
          description: 'Server management & configuration',
        },
        {
          label: '🎁 Fun Commands',
          value: 'help_fun',
          description: 'Gift spinner & entertainment',
        },
        {
          label: '⚙️ Utility Commands',
          value: 'help_utility',
          description: 'General bot utilities',
        },
        {
          label: '🎫 Ticket System',
          value: 'help_ticket',
          description: 'How to use the ticket system',
        },
        {
          label: '👑 VIP Room System',
          value: 'help_vip',
          description: 'How VIP voice rooms work',
        },
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      embeds: [mainEmbed],
      components: [row],
      ephemeral: true,
    });
  },
};

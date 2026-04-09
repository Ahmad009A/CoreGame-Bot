/**
 * Core Game Bot — /panel Command
 * Admin dashboard with system status and toggle controls
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const emojis = require('../../config/emojis');
const colors = require('../../config/colors');
const GuildSettings = require('../../models/GuildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the admin control panel — پانێلی بەڕێوەبردن')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const settings = await GuildSettings.getOrCreate(interaction.guild.id);

    // ── Status Display ─────────────────────────
    const statusLines = [
      `${settings.welcome.enabled ? '✅' : '❌'} **Welcome System** — سیستەمی بەخێرهاتن`,
      `${settings.ticket.enabled ? '✅' : '❌'} **Ticket System** — سیستەمی تیکێت`,
      `${settings.vip.enabled ? '✅' : '❌'} **VIP Room System** — ژووری VIP`,
      `${settings.spin.enabled ? '✅' : '❌'} **Gift Spinner** — دیارییەکان`,
    ];

    const panelEmbed = embeds.custom({
      title: `${emojis.ADMIN} Core Game — Admin Panel`,
      description: [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '**System Status — بارودۆخی سیستەم**',
        '',
        ...statusLines,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `${emojis.SETTINGS} Use the **buttons** below to toggle systems on/off.`,
        `${emojis.INFO} Use the **dropdown** to view detailed settings.`,
      ].join('\n'),
      color: colors.PRIMARY,
      thumbnail: interaction.guild.iconURL({ dynamic: true, size: 128 }),
      footer: {
        text: `Admin: ${interaction.user.tag} • Core Game Bot`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      },
    });

    // ── Toggle Buttons ─────────────────────────
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_toggle_welcome')
        .setLabel('Welcome')
        .setStyle(settings.welcome.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
        .setEmoji('👋'),
      new ButtonBuilder()
        .setCustomId('admin_toggle_ticket')
        .setLabel('Ticket')
        .setStyle(settings.ticket.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
        .setEmoji('🎫'),
      new ButtonBuilder()
        .setCustomId('admin_toggle_vip')
        .setLabel('VIP Rooms')
        .setStyle(settings.vip.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
        .setEmoji('👑'),
      new ButtonBuilder()
        .setCustomId('admin_toggle_spin')
        .setLabel('Spinner')
        .setStyle(settings.spin.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
        .setEmoji('🎁'),
    );

    // ── System Details Select Menu ─────────────
    const row2 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('admin_system_select')
        .setPlaceholder('📊 View system details — زانیاری سیستەم')
        .addOptions([
          { label: '👋 Welcome System', value: 'admin_welcome', description: 'View welcome configuration' },
          { label: '🎫 Ticket System', value: 'admin_ticket', description: 'View ticket configuration' },
          { label: '👑 VIP Room System', value: 'admin_vip', description: 'View VIP room configuration' },
          { label: '🎁 Gift Spinner', value: 'admin_spin', description: 'View spinner configuration' },
        ]),
    );

    await interaction.reply({
      embeds: [panelEmbed],
      components: [row1, row2],
      ephemeral: true,
    });
  },
};

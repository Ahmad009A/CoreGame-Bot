/**
 * Core Game Bot — /setup-ticket Command
 * Deploys a beautiful ticket creation panel with a button
 */

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const colors = require('../../config/colors');
const emojis = require('../../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Deploy a ticket creation panel — دانانی پانێلی تیکێت')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send the panel in (default: current)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    // ── Build the ticket panel embed ──────────
    const panelEmbed = new EmbedBuilder()
      .setTitle(`${emojis.TICKET} Core Game — Ticket System`)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `${emojis.SPARKLES} **Need Help? Open a Ticket!**`,
        '',
        'پێویستت بە یارمەتی هەیە؟ تیکێتێک بکەرەوە!',
        '',
        '**📋 General** — پرسیاری گشتی',
        '**🛠️ Technical** — کێشەی تەکنیکی',
        '**👑 VIP** — داواکاری VIP',
        '**📢 Report** — ڕاپۆرتکردن',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `> Click the button below to create a ticket.`,
        `> لە خوارەوە کلیک بکە بۆ دروستکردنی تیکێت.`,
      ].join('\n'))
      .setColor(colors.PRIMARY)
      .setThumbnail(interaction.client.user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setFooter({ text: 'Core Game • کۆری گەیم — Ticket System' })
      .setTimestamp();

    // ── Create Ticket Button ─────────────────
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('🎫 Create Ticket — تیکێت بکەرەوە')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    // ── Send the panel ───────────────────────
    await targetChannel.send({
      embeds: [panelEmbed],
      components: [row],
    });

    await interaction.reply({
      content: `✅ Ticket panel deployed in <#${targetChannel.id}>!`,
      ephemeral: true,
    });
  },
};

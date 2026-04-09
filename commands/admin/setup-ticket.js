/**
 * Core Game Bot — /setup-ticket Command
 * Deploys a ticket creation panel with a button
 * Allows setting the ticket category and log channel
 */

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const colors = require('../../config/colors');
const emojis = require('../../config/emojis');
const GuildSettings = require('../../models/GuildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Deploy a ticket panel — دانانی پانێلی تیکێت')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send the panel in (default: current)')
        .setRequired(false)
    )
    .addChannelOption(opt =>
      opt.setName('category')
        .setDescription('Category to create tickets in — کاتەگۆری')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )
    .addChannelOption(opt =>
      opt.setName('log-channel')
        .setDescription('Channel to send ticket logs — کەناڵی لۆگ')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const categoryChannel = interaction.options.getChannel('category');
    const logChannel = interaction.options.getChannel('log-channel');

    // ── Save settings ────────────────────────
    const settings = await GuildSettings.getOrCreate(interaction.guild.id);
    if (categoryChannel) settings.ticket.categoryId = categoryChannel.id;
    if (logChannel) settings.ticket.logChannelId = logChannel.id;
    if (settings.save) await settings.save();

    // ── Build the ticket panel embed ──────────
    const panelEmbed = new EmbedBuilder()
      .setTitle(`${emojis.TICKET || '🎫'} Core Game — Ticket System`)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        `✨ **Need Help? Open a Ticket!**`,
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

    // ── Confirmation ─────────────────────────
    let confirmMsg = `✅ Ticket panel deployed in <#${targetChannel.id}>!`;
    if (categoryChannel) confirmMsg += `\n📂 Category: **${categoryChannel.name}**`;
    if (logChannel) confirmMsg += `\n📝 Log channel: <#${logChannel.id}>`;

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(confirmMsg)
        .setColor(colors.SUCCESS)
      ],
      ephemeral: true,
    });
  },
};

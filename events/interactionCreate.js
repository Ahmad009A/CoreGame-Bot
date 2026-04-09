/**
 * Core Game Bot — Interaction Router (interactionCreate)
 * Routes slash commands, buttons, and select menus to their handlers
 */

const { InteractionType, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const emojis = require('../config/emojis');
const colors = require('../config/colors');
const { checkChannel } = require('../utils/checkChannel');
const { isStaff } = require('../utils/permissions');
const GuildSettings = require('../models/GuildSettings');
const Ticket = require('../models/Ticket');

module.exports = {
  name: 'interactionCreate',
  once: false,

  async execute(interaction, client) {
    try {
      // ── Slash Commands ─────────────────────
      if (interaction.isChatInputCommand()) {
        return await handleCommand(interaction, client);
      }

      // ── Buttons ────────────────────────────
      if (interaction.isButton()) {
        return await handleButton(interaction, client);
      }

      // ── Select Menus ───────────────────────
      if (interaction.isStringSelectMenu()) {
        return await handleSelectMenu(interaction, client);
      }
    } catch (error) {
      logger.error(`Interaction error: ${error.message}`);
      logger.error(error.stack);

      const errorEmbed = embeds.error(
        'An unexpected error occurred. Please try again later.\n\nببوورە، هەڵەیەک ڕوویدا.',
        `${emojis.ERROR} System Error`
      );

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch (e) {
        // Interaction may have expired
      }
    }
  },
};

// ═══════════════════════════════════════════════
//   SLASH COMMAND HANDLER
// ═══════════════════════════════════════════════

async function handleCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Channel restriction check
  const allowed = await checkChannel(interaction);
  if (!allowed) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    logger.error(`Command /${interaction.commandName} error: ${error.message}`);
    throw error;
  }
}

// ═══════════════════════════════════════════════
//   BUTTON HANDLER
// ═══════════════════════════════════════════════

async function handleButton(interaction, client) {
  const { customId } = interaction;

  // ── Ticket System Buttons ──────────────────
  if (customId === 'create_ticket') {
    return await showTicketCategoryMenu(interaction);
  }

  if (customId === 'close_ticket') {
    return await closeTicket(interaction, client);
  }

  if (customId === 'confirm_close_ticket') {
    return await confirmCloseTicket(interaction, client);
  }

  if (customId === 'cancel_close_ticket') {
    return await interaction.update({
      content: 'Ticket close cancelled.',
      embeds: [],
      components: [],
    });
  }

  // ── Admin Panel Buttons ────────────────────
  if (customId.startsWith('admin_toggle_')) {
    return await handleAdminToggle(interaction, customId);
  }

  if (customId === 'admin_refresh') {
    return await refreshAdminPanel(interaction);
  }
}

// ═══════════════════════════════════════════════
//   SELECT MENU HANDLER
// ═══════════════════════════════════════════════

async function handleSelectMenu(interaction, client) {
  const { customId } = interaction;

  if (customId === 'ticket_category_select') {
    return await createTicket(interaction, client);
  }

  if (customId === 'admin_system_select') {
    return await showAdminSystemConfig(interaction);
  }
}

// ═══════════════════════════════════════════════
//   TICKET FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Show ticket category selection menu
 */
async function showTicketCategoryMenu(interaction) {
  const settings = await GuildSettings.getOrCreate(interaction.guild.id);

  if (!settings.ticket.enabled) {
    return interaction.reply({
      embeds: [embeds.warning('The ticket system is currently disabled.\nسیستەمی تیکێت لە ئێستادا ناچالاکە.')],
      ephemeral: true,
    });
  }

  // Check if user already has an open ticket
  const existingTicket = await Ticket.findOne({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    status: 'open',
  });

  if (existingTicket) {
    return interaction.reply({
      embeds: [embeds.warning(
        `You already have an open ticket: <#${existingTicket.channelId}>\n\nتۆ تیکێتی کراوەت هەیە.`
      )],
      ephemeral: true,
    });
  }

  const categories = settings.ticket.categories || ['📋 General'];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder('Select a ticket category — جۆری تیکێت هەڵبژێرە')
    .addOptions(
      categories.map((cat, i) => ({
        label: cat,
        value: `ticket_cat_${i}`,
        description: `Open a ${cat} ticket`,
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embeds.ticket(
      `${emojis.TICKET} Please select the category for your ticket:\n\nتکایە جۆری تیکێتەکەت هەڵبژێرە:`
    )],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Create a new ticket channel
 */
async function createTicket(interaction, client) {
  await interaction.deferUpdate();

  const settings = await GuildSettings.getOrCreate(interaction.guild.id);
  const categoryIndex = parseInt(interaction.values[0].replace('ticket_cat_', ''));
  const categoryName = settings.ticket.categories[categoryIndex] || 'General';

  // Get next ticket number
  const ticketNumber = settings.ticket.nextNumber || 1;
  settings.ticket.nextNumber = ticketNumber + 1;
  await settings.save();

  const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

  // ── Create ticket channel ──────────────────
  const staffRoleId = process.env.STAFF_ROLE_ID;

  const permissionOverwrites = [
    {
      id: interaction.guild.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];

  // Add staff role if set
  if (staffRoleId) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    });
  }

  const ticketChannel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.ticket.categoryId || null,
    topic: `Ticket #${ticketNumber} | ${categoryName} | User: ${interaction.user.tag}`,
    permissionOverwrites,
  });

  // ── Save ticket to database ────────────────
  await Ticket.create({
    guildId: interaction.guild.id,
    channelId: ticketChannel.id,
    userId: interaction.user.id,
    ticketNumber,
    category: categoryName,
  });

  // ── Send welcome message in ticket ─────────
  const closeButton = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Close Ticket — داخستنی تیکێت')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const row = new ActionRowBuilder().addComponents(closeButton);

  const ticketEmbed = embeds.ticket(
    `${emojis.WAVE} Hello <@${interaction.user.id}>!\n\n` +
    `**Category:** ${categoryName}\n` +
    `**Ticket:** #${ticketNumber}\n\n` +
    `Please describe your issue and a staff member will assist you.\n` +
    `تکایە کێشەکەت باس بکە و یەکێک لە ستافەکان یارمەتیت دەدات.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );

  await ticketChannel.send({
    content: `<@${interaction.user.id}>${staffRoleId ? ` | <@&${staffRoleId}>` : ''}`,
    embeds: [ticketEmbed],
    components: [row],
  });

  // ── Update user's original message ─────────
  await interaction.editReply({
    embeds: [embeds.success(
      `Your ticket has been created: <#${ticketChannel.id}>\n\nتیکێتەکەت دروستکرا.`
    )],
    components: [],
  });

  logger.info(`Ticket #${ticketNumber} created by ${interaction.user.tag} in ${interaction.guild.name}`);
}

/**
 * Show close confirmation
 */
async function closeTicket(interaction, client) {
  const ticket = await Ticket.findOne({
    channelId: interaction.channel.id,
    status: 'open',
  });

  if (!ticket) {
    return interaction.reply({
      embeds: [embeds.warning('This channel is not an active ticket.')],
      ephemeral: true,
    });
  }

  // Only ticket owner or staff can close
  if (ticket.userId !== interaction.user.id && !isStaff(interaction.member)) {
    return interaction.reply({
      embeds: [embeds.error('You do not have permission to close this ticket.')],
      ephemeral: true,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('confirm_close_ticket')
      .setLabel('Confirm Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('cancel_close_ticket')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌'),
  );

  await interaction.reply({
    embeds: [embeds.warning(
      'Are you sure you want to close this ticket?\nThis action will save the transcript and delete the channel.\n\n' +
      'دڵنیایت دەتەوێت ئەم تیکێتە داخەیت؟'
    )],
    components: [row],
  });
}

/**
 * Confirm and close the ticket: save transcript, log, delete channel
 */
async function confirmCloseTicket(interaction, client) {
  await interaction.update({
    embeds: [embeds.info(`${emojis.LOADING} Closing ticket and saving transcript...`)],
    components: [],
  });

  const ticket = await Ticket.findOne({
    channelId: interaction.channel.id,
    status: 'open',
  });

  if (!ticket) return;

  // ── Collect transcript ─────────────────────
  const messages = await interaction.channel.messages.fetch({ limit: 100 });
  const transcript = messages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(msg => ({
      authorTag: msg.author.tag,
      authorId: msg.author.id,
      content: msg.content || '[embed/attachment]',
      timestamp: msg.createdAt,
      attachments: msg.attachments.map(a => a.url),
    }));

  // ── Update ticket in database ──────────────
  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closedBy = interaction.user.id;
  ticket.transcript = transcript;
  await ticket.save();

  // ── Send log to log channel ────────────────
  const settings = await GuildSettings.getOrCreate(interaction.guild.id);
  const logChannelId = settings.ticket.logChannelId || process.env.LOG_CHANNEL_ID;

  if (logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(logChannelId);
    if (logChannel) {
      // Build transcript text
      const transcriptText = transcript
        .map(m => `[${new Date(m.timestamp).toLocaleString()}] ${m.authorTag}: ${m.content}`)
        .join('\n');

      const { AttachmentBuilder } = require('discord.js');
      const buffer = Buffer.from(transcriptText, 'utf-8');
      const file = new AttachmentBuilder(buffer, {
        name: `transcript-ticket-${ticket.ticketNumber}.txt`,
      });

      const logEmbed = embeds.custom({
        title: `${emojis.TRANSCRIPT} Ticket #${ticket.ticketNumber} Closed`,
        description: `**Category:** ${ticket.category}\n**Opened by:** <@${ticket.userId}>\n**Closed by:** <@${interaction.user.id}>`,
        color: colors.ERROR,
        fields: [
          { name: 'Messages', value: `${transcript.length}`, inline: true },
          { name: 'Duration', value: getTimeDiff(ticket.createdAt, new Date()), inline: true },
        ],
      });

      await logChannel.send({ embeds: [logEmbed], files: [file] });
    }
  }

  // ── Delete the ticket channel ──────────────
  logger.info(`Ticket #${ticket.ticketNumber} closed by ${interaction.user.tag}`);

  setTimeout(async () => {
    try {
      await interaction.channel.delete('Ticket closed');
    } catch (err) {
      logger.error(`Failed to delete ticket channel: ${err.message}`);
    }
  }, 5000);
}

// ═══════════════════════════════════════════════
//   ADMIN PANEL FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Toggle a system on/off from admin panel buttons
 */
async function handleAdminToggle(interaction, customId) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You need Administrator permission.')],
      ephemeral: true,
    });
  }

  const system = customId.replace('admin_toggle_', '');
  const settings = await GuildSettings.getOrCreate(interaction.guild.id);

  const systemMap = {
    welcome: 'welcome',
    ticket: 'ticket',
    vip: 'vip',
    spin: 'spin',
  };

  const key = systemMap[system];
  if (!key || !settings[key]) {
    return interaction.reply({ embeds: [embeds.error('Unknown system.')], ephemeral: true });
  }

  settings[key].enabled = !settings[key].enabled;
  await settings.save();

  const status = settings[key].enabled ? `${emojis.SUCCESS} Enabled` : `${emojis.ERROR} Disabled`;

  await interaction.reply({
    embeds: [embeds.success(`**${system.charAt(0).toUpperCase() + system.slice(1)}** system is now: ${status}`)],
    ephemeral: true,
  });
}

/**
 * Refresh admin panel embed
 */
async function refreshAdminPanel(interaction) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You need Administrator permission.')],
      ephemeral: true,
    });
  }

  // Just acknowledge — the panel command handles the full render
  await interaction.reply({
    embeds: [embeds.success('Admin panel refreshed. Use `/panel` to see updated status.')],
    ephemeral: true,
  });
}

/**
 * Show detailed config for a specific admin system
 */
async function showAdminSystemConfig(interaction) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You need Administrator permission.')],
      ephemeral: true,
    });
  }

  const selected = interaction.values[0];
  const settings = await GuildSettings.getOrCreate(interaction.guild.id);

  let description = '';

  switch (selected) {
    case 'admin_welcome':
      description = [
        `**Status:** ${settings.welcome.enabled ? '✅ Enabled' : '❌ Disabled'}`,
        `**Channel:** ${settings.welcome.channelId ? `<#${settings.welcome.channelId}>` : 'Not set'}`,
        `**Custom BG:** ${settings.welcome.backgroundUrl ? '✅ Set' : '❌ Not set'}`,
        `**Message:** \`${settings.welcome.message.substring(0, 100)}\``,
        '',
        '**Commands:**',
        '`/setwelcome channel:#channel message:text`',
        '`/setwelcome-bg url:<image_url>`',
      ].join('\n');
      break;

    case 'admin_ticket':
      description = [
        `**Status:** ${settings.ticket.enabled ? '✅ Enabled' : '❌ Disabled'}`,
        `**Category:** ${settings.ticket.categoryId ? `<#${settings.ticket.categoryId}>` : 'Not set'}`,
        `**Log Channel:** ${settings.ticket.logChannelId ? `<#${settings.ticket.logChannelId}>` : 'Not set'}`,
        `**Total Tickets:** ${(settings.ticket.nextNumber || 1) - 1}`,
        `**Categories:** ${settings.ticket.categories.join(', ')}`,
        '',
        '**Commands:**',
        '`/setup-ticket` — Deploy ticket panel',
      ].join('\n');
      break;

    case 'admin_vip':
      description = [
        `**Status:** ${settings.vip.enabled ? '✅ Enabled' : '❌ Disabled'}`,
        `**Trigger Channel:** ${settings.vip.triggerChannelId ? `<#${settings.vip.triggerChannelId}>` : `Channel named "${process.env.VIP_TRIGGER_CHANNEL_NAME || 'VIP Room'}"`}`,
        '',
        'Users joining the trigger channel get a private voice room.',
      ].join('\n');
      break;

    case 'admin_spin':
      description = [
        `**Status:** ${settings.spin.enabled ? '✅ Enabled' : '❌ Disabled'}`,
        `**Cooldown:** ${settings.spin.cooldownHours}h`,
        `**Reward Role:** ${settings.spin.rewardRoleId ? `<@&${settings.spin.rewardRoleId}>` : 'None'}`,
      ].join('\n');
      break;

    default:
      description = 'Unknown system selected.';
  }

  await interaction.reply({
    embeds: [embeds.admin(description)],
    ephemeral: true,
  });
}

// ═══════════════════════════════════════════════
//   HELPER FUNCTIONS
// ═══════════════════════════════════════════════

function getTimeDiff(start, end) {
  const diff = end - new Date(start);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

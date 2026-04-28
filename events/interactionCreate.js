/**
 * Core Game Bot — Interaction Router (interactionCreate)
 * Routes slash commands, buttons, select menus, and modals
 * Includes full Ticket System + Admin Panel logic
 */

const { InteractionType, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const emojis = require('../config/emojis');
const colors = require('../config/colors');
const { checkChannel } = require('../utils/checkChannel');
const { isStaff } = require('../utils/permissions');

// ── In-memory ticket tracking (works without MongoDB) ──
const activeTickets = new Map(); // channelId -> { userId, ticketNumber, category, createdAt }
let ticketCounter = 0;

module.exports = {
  name: 'interactionCreate',
  once: false,

  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) {
        return await handleCommand(interaction, client);
      }
      if (interaction.isButton()) {
        return await handleButton(interaction, client);
      }
      if (interaction.isStringSelectMenu()) {
        return await handleSelectMenu(interaction, client);
      }
    } catch (error) {
      logger.error(`Interaction error: ${error.message}`);
      logger.error(error.stack);

      const errorEmbed = embeds.error(
        'An unexpected error occurred.\nببوورە، هەڵەیەک ڕوویدا.',
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

// Commands that need longer than 3 seconds to respond
const SLOW_COMMANDS = ['play', 'playlist', 'skip', 'stop', 'queue'];

async function handleCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // For slow commands, defer reply IMMEDIATELY to prevent timeout
  if (SLOW_COMMANDS.includes(interaction.commandName)) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }
    } catch (e) {
      // Stale interaction from reboot — command will still execute, just can't reply
      console.log(`[Handler] Defer failed for /${interaction.commandName} (stale interaction)`);
    }
  }

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

  // ── Ticket Buttons ─────────────────────────
  if (customId === 'create_ticket') {
    return await showTicketCategoryMenu(interaction);
  }
  if (customId === 'close_ticket') {
    return await showCloseConfirmation(interaction);
  }
  if (customId === 'confirm_close_ticket') {
    return await closeTicket(interaction, client);
  }
  if (customId === 'cancel_close_ticket') {
    return await interaction.update({
      content: '❌ Ticket close cancelled. — داخستن هەڵوەشایەوە.',
      embeds: [],
      components: [],
    });
  }
  if (customId === 'claim_ticket') {
    return await claimTicket(interaction);
  }
  if (customId === 'add_user_ticket') {
    return await showAddUserModal(interaction);
  }

  // ── Admin Panel Buttons ────────────────────
  if (customId.startsWith('admin_toggle_')) {
    return await handleAdminToggle(interaction, customId);
  }
  if (customId === 'admin_refresh') {
    return await interaction.reply({
      embeds: [embeds.success('Admin panel refreshed. Use `/panel` to see updated status.')],
      ephemeral: true,
    });
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
  if (customId === 'help_category_select') {
    // Handled by help command select menu
    return await handleHelpSelect(interaction);
  }
}

// ═══════════════════════════════════════════════
//   TICKET SYSTEM — FULL IMPLEMENTATION
// ═══════════════════════════════════════════════

/**
 * Step 1: Show ticket category menu when user clicks "Create Ticket"
 */
async function showTicketCategoryMenu(interaction) {
  // Check if user already has an open ticket
  for (const [channelId, ticket] of activeTickets) {
    if (ticket.userId === interaction.user.id && ticket.guildId === interaction.guild.id) {
      return interaction.reply({
        embeds: [embeds.warning(
          `You already have an open ticket: <#${channelId}>\n\nتۆ تیکێتی کراوەت هەیە.`
        )],
        ephemeral: true,
      });
    }
  }

  const categories = ['📋 General', '🛠️ Technical', '👑 VIP', '📢 Report'];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder('📂 Select ticket category — جۆری تیکێت هەڵبژێرە')
    .addOptions(
      categories.map((cat, i) => ({
        label: cat,
        value: `ticket_cat_${i}`,
        description: `Open a ${cat.replace(/^[^\s]+\s/, '')} ticket`,
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('📩 Create a Ticket')
      .setDescription('Please select the category for your ticket:\n\nتکایە جۆری تیکێتەکەت هەڵبژێرە:')
      .setColor(colors.PRIMARY)
    ],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Step 2: Create the private ticket channel under the correct category
 */
async function createTicket(interaction, client) {
  await interaction.deferUpdate();

  const categoryIndex = parseInt(interaction.values[0].replace('ticket_cat_', ''));
  const categories = ['📋 General', '🛠️ Technical', '👑 VIP', '📢 Report'];
  const categoryName = categories[categoryIndex] || '📋 General';

  ticketCounter++;
  const ticketNumber = ticketCounter;
  const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

  // ── Get settings for configured category ───
  const GuildSettings = require('../models/GuildSettings');
  const settings = await GuildSettings.getOrCreate(interaction.guild.id);

  // ── Find or create the ticket category ─────
  let parentCategory = null;

  // First check if a category is set in settings
  if (settings.ticket?.categoryId) {
    parentCategory = interaction.guild.channels.cache.get(settings.ticket.categoryId);
  }

  // If no configured category, find one named "Tickets" or "tickets"
  if (!parentCategory) {
    parentCategory = interaction.guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory &&
           c.name.toLowerCase().includes('ticket')
    );
  }

  // If still none, create a "Tickets" category
  if (!parentCategory) {
    try {
      parentCategory = await interaction.guild.channels.create({
        name: '🎫 Tickets',
        type: ChannelType.GuildCategory,
      });
    } catch (e) {
      console.error('Failed to create ticket category:', e.message);
    }
  }

  // ── Permission overwrites ──────────────────
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
        PermissionsBitField.Flags.ManageMessages,
      ],
    },
  ];

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

  // ── Create channel under the category ──────
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `🎫 Ticket #${ticketNumber} | ${categoryName} | User: ${interaction.user.tag}`,
    permissionOverwrites,
  };

  // Place under category
  if (parentCategory) {
    channelOptions.parent = parentCategory.id;
  }

  const ticketChannel = await interaction.guild.channels.create(channelOptions);

  // ── Save to memory ─────────────────────────
  activeTickets.set(ticketChannel.id, {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    ticketNumber,
    category: categoryName,
    guildId: interaction.guild.id,
    createdAt: new Date(),
    claimedBy: null,
    logChannelId: settings.ticket?.logChannelId || process.env.LOG_CHANNEL_ID || '1491193267902222418',
  });

  // ── Ticket info embed ──────────────────────
  const ticketEmbed = new EmbedBuilder()
    .setTitle(`🎫 Ticket #${ticketNumber}`)
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `👤 **Opened by:** <@${interaction.user.id}>`,
      `📂 **Category:** ${categoryName}`,
      `🕐 **Opened at:** <t:${Math.floor(Date.now() / 1000)}:F>`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'Please describe your issue and a staff member will assist you.',
      '',
      'تکایە کێشەکەت باس بکە و یەکێک لە ستافەکان یارمەتیت دەدات.',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'))
    .setColor(colors.PRIMARY)
    .setTimestamp()
    .setFooter({ text: 'Core Game • Ticket System' });

  // ── Action buttons ─────────────────────────
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close — داخستن')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim — وەرگرتن')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✋'),
    new ButtonBuilder()
      .setCustomId('add_user_ticket')
      .setLabel('Add User — زیادکردنی کەس')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('➕'),
  );

  // ── Send welcome message in the ticket ─────
  await ticketChannel.send({
    content: `<@${interaction.user.id}>${staffRoleId ? ` | <@&${staffRoleId}>` : ''}`,
    embeds: [ticketEmbed],
    components: [buttonRow],
  });

  // ── Notify user ────────────────────────────
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setDescription(`✅ Your ticket has been created: <#${ticketChannel.id}>\n\nتیکێتەکەت دروستکرا!`)
      .setColor(colors.SUCCESS)
    ],
    components: [],
  });

  logger.info(`Ticket #${ticketNumber} created by ${interaction.user.tag}`);
}

/**
 * Claim ticket — ADMIN/STAFF ONLY
 */
async function claimTicket(interaction) {
  // ── Permission check: only admin or staff can claim ──
  if (!isStaff(interaction.member) && !interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('Only admins/staff can claim tickets.\n\nتەنها ئادمین/ستاف دەتوانێت تیکێت وەربگرێت.')],
      ephemeral: true,
    });
  }

  const ticket = activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      embeds: [embeds.warning('This is not a ticket channel.')],
      ephemeral: true,
    });
  }

  if (ticket.claimedBy) {
    return interaction.reply({
      embeds: [embeds.warning(`This ticket is already claimed by <@${ticket.claimedBy}>.`)],
      ephemeral: true,
    });
  }

  ticket.claimedBy = interaction.user.id;

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setDescription(`✋ **<@${interaction.user.id}> claimed this ticket.**\n\nئەم تیکێتە لەلایەن <@${interaction.user.id}> وەرگیرا.`)
      .setColor(colors.SUCCESS)
    ],
  });
}

/**
 * Add user to ticket — show modal to enter user ID
 */
async function showAddUserModal(interaction) {
  if (!isStaff(interaction.member) && !interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('Only staff can add users to tickets.')],
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('add_user_modal')
    .setTitle('Add User to Ticket');

  const userInput = new TextInputBuilder()
    .setCustomId('user_id_input')
    .setLabel('User ID or @mention')
    .setPlaceholder('Enter the user ID (e.g. 123456789)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(userInput));
  await interaction.showModal(modal);
}

/**
 * Show close confirmation
 */
async function showCloseConfirmation(interaction) {
  const ticket = activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      embeds: [embeds.warning('This is not an active ticket channel.')],
      ephemeral: true,
    });
  }

  // Only ticket owner or staff can close
  if (ticket.userId !== interaction.user.id && !isStaff(interaction.member) && !interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You do not have permission to close this ticket.\n\nتۆ مۆڵەتت نیە ئەم تیکێتە داخەیت.')],
      ephemeral: true,
    });
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('confirm_close_ticket')
      .setLabel('✅ Confirm Close — دڵنیاکردنەوە')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('cancel_close_ticket')
      .setLabel('❌ Cancel — هەڵوەشاندنەوە')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('🔒 Close Ticket?')
      .setDescription('Are you sure you want to close this ticket?\nThe chat log will be saved and the channel will be deleted.\n\nدڵنیایت دەتەوێت ئەم تیکێتە داخەیت?\nلۆگی چات پاشەکەوت دەکرێت و کەناڵەکە دەسڕێتەوە.')
      .setColor(colors.WARNING)
    ],
    components: [confirmRow],
  });
}

/**
 * Close ticket — save transcript, log, delete channel
 */
async function closeTicket(interaction, client) {
  await interaction.update({
    embeds: [new EmbedBuilder()
      .setDescription('⏳ Closing ticket and saving transcript...\n\nداخستنی تیکێت و پاشەکەوتکردنی لۆگ...')
      .setColor(colors.WARNING)
    ],
    components: [],
  });

  const ticket = activeTickets.get(interaction.channel.id);
  if (!ticket) return;

  // ── Collect transcript ─────────────────────
  let transcript = [];
  try {
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    transcript = messages
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(msg => `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content || '[embed/attachment]'}`)
      .join('\n');
  } catch (e) {
    transcript = 'Failed to collect transcript.';
  }

  // ── Send log to log channel ────────────────
  const logChannelId = ticket.logChannelId || process.env.LOG_CHANNEL_ID;
  if (logChannelId) {
    try {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const { AttachmentBuilder } = require('discord.js');
        const buffer = Buffer.from(transcript, 'utf-8');
        const file = new AttachmentBuilder(buffer, {
          name: `transcript-ticket-${ticket.ticketNumber}.txt`,
        });

        const duration = getTimeDiff(ticket.createdAt, new Date());

        const logEmbed = new EmbedBuilder()
          .setTitle(`📝 Ticket #${ticket.ticketNumber} — Closed`)
          .setDescription([
            `**Category:** ${ticket.category}`,
            `**Opened by:** <@${ticket.userId}> (${ticket.userTag})`,
            `**Closed by:** <@${interaction.user.id}>`,
            `**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed'}`,
            `**Duration:** ${duration}`,
          ].join('\n'))
          .setColor(colors.ERROR)
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed], files: [file] });
      }
    } catch (e) {
      logger.error(`Failed to send ticket log: ${e.message}`);
    }
  }

  // ── Remove from tracking & delete channel ──
  activeTickets.delete(interaction.channel.id);
  logger.info(`Ticket #${ticket.ticketNumber} closed by ${interaction.user.tag}`);

  setTimeout(async () => {
    try {
      await interaction.channel.delete('Ticket closed');
    } catch (err) {
      logger.error(`Failed to delete ticket channel: ${err.message}`);
    }
  }, 3000);
}

// ═══════════════════════════════════════════════
//   HELP SELECT MENU HANDLER
// ═══════════════════════════════════════════════

async function handleHelpSelect(interaction) {
  const selected = interaction.values[0];
  let description = '';

  switch (selected) {
    case 'help_admin':
      description = [
        '**🛠️ Admin Commands — فەرمانەکانی بەڕێوەبردن**',
        '',
        '`/panel` — Open the admin control panel',
        '`/setwelcome` — Set welcome channel & message',
        '`/setup-ticket` — Deploy ticket creation panel',
        '`/post` — Send announcement with buttons',
        '`/spin` — Spin gift wheel (admin only)',
      ].join('\n');
      break;
    case 'help_fun':
      description = '**🎁 Fun Commands**\n\n`/spin` — Admin-only gift spinner with photo upload';
      break;
    case 'help_utility':
      description = '**⚙️ Utility Commands**\n\n`/ping` — Check bot latency\n`/help` — Show this menu';
      break;
    case 'help_ticket':
      description = [
        '**🎫 Ticket System**',
        '',
        '1️⃣ Admin runs `/setup-ticket` to deploy the panel',
        '2️⃣ Users click **Create Ticket** button',
        '3️⃣ Private channel is created with Close/Claim/Add buttons',
        '4️⃣ Staff claims and helps the user',
        '5️⃣ Ticket is closed → transcript saved → channel deleted',
      ].join('\n');
      break;
    case 'help_vip':
      description = '**👑 VIP Room System**\n\nJoin the VIP trigger voice channel to auto-create a private room. Room is deleted when empty.';
      break;
    default:
      description = 'Unknown category.';
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setDescription(description).setColor(colors.PRIMARY)],
    ephemeral: true,
  });
}

// ═══════════════════════════════════════════════
//   ADMIN PANEL FUNCTIONS
// ═══════════════════════════════════════════════

async function handleAdminToggle(interaction, customId) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You need Administrator permission.')],
      ephemeral: true,
    });
  }

  const system = customId.replace('admin_toggle_', '');
  await interaction.reply({
    embeds: [embeds.success(`**${system.charAt(0).toUpperCase() + system.slice(1)}** system toggled successfully!`)],
    ephemeral: true,
  });
}

async function showAdminSystemConfig(interaction) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      embeds: [embeds.error('You need Administrator permission.')],
      ephemeral: true,
    });
  }

  await interaction.reply({
    embeds: [embeds.admin('Use the web dashboard at `/dashboard` for detailed configuration.')],
    ephemeral: true,
  });
}

// ═══════════════════════════════════════════════
//   HELPERS
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

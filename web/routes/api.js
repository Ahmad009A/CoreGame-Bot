/**
 * Core Game Bot — Dashboard API Routes
 * REST API endpoints for managing bot settings from the web panel
 */

const express = require('express');
const router = express.Router();
const GuildSettings = require('../../models/GuildSettings');
const Ticket = require('../../models/Ticket');
const logger = require('../../utils/logger');

/**
 * GET /api/guilds — List guilds the user can manage
 */
router.get('/guilds', async (req, res) => {
  try {
    const guilds = req.session.user.guilds.map(g => {
      const botGuild = req.botClient.guilds.cache.get(g.id);
      return {
        ...g,
        memberCount: botGuild?.memberCount || 0,
        icon: botGuild?.iconURL({ dynamic: true, size: 128 }) || null,
      };
    });
    res.json(guilds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guilds/:id/settings — Get guild settings
 */
router.get('/guilds/:id/settings', async (req, res) => {
  try {
    // Verify user has access to this guild
    const hasAccess = req.session.user.guilds.some(g => g.id === req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const settings = await GuildSettings.getOrCreate(req.params.id);
    const guild = req.botClient.guilds.cache.get(req.params.id);

    // Get channels and roles for the dropdowns
    // Always fetch fresh from Discord API to ensure data is available
    let channels = [];
    let voiceChannels = [];
    let categories = [];

    if (guild) {
      try {
        // Force fetch channels from Discord API
        const fetched = await guild.channels.fetch();
        
        channels = Array.from(fetched.filter(c => c && c.type === 0).values())
          .map(c => ({ id: c.id, name: c.name }));

        voiceChannels = Array.from(fetched.filter(c => c && c.type === 2).values())
          .map(c => ({ id: c.id, name: c.name }));

        categories = Array.from(fetched.filter(c => c && c.type === 4).values())
          .map(c => ({ id: c.id, name: c.name }));
      } catch (e) {
        console.error('Failed to fetch channels:', e.message);
      }
    }

    const roles = guild ? guild.roles.cache
      .filter(r => !r.managed && r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor })) : [];

    res.json({
      settings: typeof settings.toObject === 'function' ? settings.toObject() : settings,
      channels,
      voiceChannels,
      categories,
      roles,
      guild: {
        id: guild?.id,
        name: guild?.name,
        icon: guild?.iconURL({ dynamic: true, size: 128 }),
        memberCount: guild?.memberCount,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/guilds/:id/settings — Update guild settings
 */
router.patch('/guilds/:id/settings', async (req, res) => {
  try {
    const hasAccess = req.session.user.guilds.some(g => g.id === req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const settings = await GuildSettings.getOrCreate(req.params.id);
    const updates = req.body;

    // ── Welcome Settings ─────────────────────
    if (updates.welcome !== undefined) {
      if (updates.welcome.enabled !== undefined) settings.welcome.enabled = updates.welcome.enabled;
      if (updates.welcome.channelId !== undefined) settings.welcome.channelId = updates.welcome.channelId;
      if (updates.welcome.message !== undefined) settings.welcome.message = updates.welcome.message;
      if (updates.welcome.backgroundUrl !== undefined) settings.welcome.backgroundUrl = updates.welcome.backgroundUrl;
    }

    // ── Ticket Settings ──────────────────────
    if (updates.ticket !== undefined) {
      if (updates.ticket.enabled !== undefined) settings.ticket.enabled = updates.ticket.enabled;
      if (updates.ticket.categoryId !== undefined) settings.ticket.categoryId = updates.ticket.categoryId;
      if (updates.ticket.logChannelId !== undefined) settings.ticket.logChannelId = updates.ticket.logChannelId;
    }

    // ── VIP Settings ─────────────────────────
    if (updates.vip !== undefined) {
      if (updates.vip.enabled !== undefined) settings.vip.enabled = updates.vip.enabled;
      if (updates.vip.triggerChannelId !== undefined) settings.vip.triggerChannelId = updates.vip.triggerChannelId;
    }

    // ── Spin Settings ────────────────────────
    if (updates.spin !== undefined) {
      if (updates.spin.enabled !== undefined) settings.spin.enabled = updates.spin.enabled;
      if (updates.spin.cooldownHours !== undefined) settings.spin.cooldownHours = updates.spin.cooldownHours;
      if (updates.spin.rewardRoleId !== undefined) settings.spin.rewardRoleId = updates.spin.rewardRoleId;
    }

    // ── Leveling Settings ────────────────────
    if (updates.leveling !== undefined) {
      if (!settings.leveling) settings.leveling = {};
      if (updates.leveling.enabled !== undefined) settings.leveling.enabled = updates.leveling.enabled;
      if (updates.leveling.voiceHoursPerLevel !== undefined) settings.leveling.voiceHoursPerLevel = updates.leveling.voiceHoursPerLevel;
      if (updates.leveling.xpPerMessage !== undefined) settings.leveling.xpPerMessage = updates.leveling.xpPerMessage;
      if (updates.leveling.bestMemberRoleId !== undefined) settings.leveling.bestMemberRoleId = updates.leveling.bestMemberRoleId;
      if (updates.leveling.bestMemberLevel !== undefined) settings.leveling.bestMemberLevel = updates.leveling.bestMemberLevel;
      if (updates.leveling.levelUpChannelId !== undefined) settings.leveling.levelUpChannelId = updates.leveling.levelUpChannelId;
    }

    await settings.save();
    logger.info(`Settings updated for guild ${req.params.id} by ${req.session.user.username}`);

    res.json({ success: true, settings: typeof settings.toObject === 'function' ? settings.toObject() : settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guilds/:id/tickets — Get ticket statistics
 */
router.get('/guilds/:id/tickets', async (req, res) => {
  try {
    const hasAccess = req.session.user.guilds.some(g => g.id === req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const openTickets = await Ticket.countDocuments({ guildId: req.params.id, status: 'open' });
    const closedTickets = await Ticket.countDocuments({ guildId: req.params.id, status: 'closed' });
    const recentTickets = await Ticket.find({ guildId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('ticketNumber category status userId createdAt closedAt');

    res.json({ openTickets, closedTickets, recentTickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/guilds/:id/post — Send an announcement to a channel
 */
router.post('/guilds/:id/post', async (req, res) => {
  try {
    const hasAccess = req.session.user.guilds.some(g => g.id === req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const { channelId, title, content, imageUrl, thumbnailUrl, color, mentionEveryone, buttons } = req.body;
    const guild = req.botClient.guilds.cache.get(req.params.id);

    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const colors = require('../../config/colors');

    const colorMap = {
      purple: colors.PRIMARY,
      blue: colors.SECONDARY,
      green: colors.SUCCESS,
      gold: colors.GOLD,
      red: colors.ERROR,
      indigo: colors.INFO,
    };

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(content)
      .setColor(colorMap[color] || colors.PRIMARY)
      .setTimestamp()
      .setFooter({
        text: `Posted by ${req.session.user.username} • Core Game Dashboard`,
      });

    if (imageUrl) embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

    const messagePayload = {
      content: mentionEveryone ? '@everyone' : undefined,
      embeds: [embed],
    };

    // Build link buttons if provided
    if (buttons && buttons.length > 0) {
      const buttonEmojis = ['🔗', '🌐', '📎'];
      const row = new ActionRowBuilder();
      buttons.forEach((btn, i) => {
        if (btn.label && btn.url) {
          const url = btn.url.startsWith('http') ? btn.url : `https://${btn.url}`;
          row.addComponents(
            new ButtonBuilder()
              .setLabel(btn.label)
              .setURL(url)
              .setStyle(ButtonStyle.Link)
              .setEmoji(buttonEmojis[i] || '🔗')
          );
        }
      });
      if (row.components.length > 0) {
        messagePayload.components = [row];
      }
    }

    await channel.send(messagePayload);

    logger.info(`Post sent to #${channel.name} in ${guild.name} by ${req.session.user.username}`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Post error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

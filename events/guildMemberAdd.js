/**
 * Core Game Bot — Welcome System (guildMemberAdd)
 * Generates a canvas welcome image and sends it to the welcome channel
 */

const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const emojis = require('../config/emojis');
const GuildSettings = require('../models/GuildSettings');
const { generateWelcomeImage } = require('../utils/welcomeCanvas');
const { AttachmentBuilder } = require('discord.js');

module.exports = {
  name: 'guildMemberAdd',
  once: false,

  async execute(member, client) {
    try {
      // ── Fetch guild settings ───────────────
      const settings = await GuildSettings.getOrCreate(member.guild.id);

      if (!settings.welcome.enabled) return;

      // ── Find welcome channel ───────────────
      let channel;
      if (settings.welcome.channelId) {
        channel = member.guild.channels.cache.get(settings.welcome.channelId);
      }
      if (!channel) {
        // Fallback: look for channel by env var ID
        const envChannelId = process.env.WELCOME_CHANNEL_ID;
        if (envChannelId) {
          channel = member.guild.channels.cache.get(envChannelId);
        }
      }
      if (!channel) {
        // Fallback: look for channel named "welcome"
        channel = member.guild.channels.cache.find(
          c => c.name.toLowerCase().includes('welcome')
        );
      }

      if (!channel) {
        logger.warn(`No welcome channel found for guild ${member.guild.name}`);
        return;
      }

      // ── Generate welcome image ─────────────
      const imageBuffer = await generateWelcomeImage(member, settings.welcome.backgroundUrl);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome.png' });

      // ── Build welcome message ──────────────
      const welcomeText = (settings.welcome.message || 'Welcome {user} to **{server}**!')
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{membercount}/g, member.guild.memberCount);

      const welcomeEmbed = embeds.custom({
        title: `${emojis.SPARKLES} بەخێربێیت! — Welcome!`,
        description: welcomeText,
        color: 0x7C3AED,
        image: 'attachment://welcome.png',
        fields: [
          {
            name: `${emojis.GAMING} Member #${member.guild.memberCount}`,
            value: `شوێنی ئاماده بوون: ${member.guild.memberCount}`,
            inline: true,
          },
          {
            name: `${emojis.STAR} Account Created`,
            value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
        ],
        footer: {
          text: `Core Game • کۆری گەیم | ${member.guild.name}`,
          iconURL: member.guild.iconURL({ dynamic: true }),
        },
      });

      await channel.send({
        content: `${emojis.CONFETTI} Hey <@${member.id}>!`,
        embeds: [welcomeEmbed],
        files: [attachment],
      });

      logger.info(`Welcome sent for ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
      logger.error(`Welcome system error: ${error.message}`);
      logger.error(error.stack);
    }
  },
};

const { EmbedBuilder } = require('discord.js');
const colors = require('../config/colors');
const emojis = require('../config/emojis');

/**
 * Build a standard gaming-themed embed
 * @param {Object} options
 */
function buildEmbed({ title, description, color, fields = [], thumbnail, image, footer, author } = {}) {
  const embed = new EmbedBuilder()
    .setColor(color || colors.PRIMARY)
    .setTimestamp();

  if (title)       embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (thumbnail)   embed.setThumbnail(thumbnail);
  if (image)       embed.setImage(image);
  if (fields.length) embed.addFields(fields);

  if (footer) {
    embed.setFooter({ text: footer.text, iconURL: footer.iconURL });
  } else {
    embed.setFooter({ text: 'Core Game Bot • کۆری گەیم' });
  }

  if (author) {
    embed.setAuthor({ name: author.name, iconURL: author.iconURL });
  }

  return embed;
}

const embeds = {
  success: (description, title = `${emojis.SUCCESS} Success`) =>
    buildEmbed({ title, description, color: colors.SUCCESS }),

  error: (description, title = `${emojis.ERROR} Error`) =>
    buildEmbed({ title, description, color: colors.ERROR }),

  warning: (description, title = `${emojis.WARNING} Warning`) =>
    buildEmbed({ title, description, color: colors.WARNING }),

  info: (description, title = `${emojis.INFO} Info`) =>
    buildEmbed({ title, description, color: colors.SECONDARY }),

  music: (description, fields = [], thumbnail) =>
    buildEmbed({
      title: `${emojis.MUSIC} Music Player`,
      description,
      color: colors.ACCENT,
      fields,
      thumbnail,
    }),

  ticket: (description, fields = []) =>
    buildEmbed({
      title: `${emojis.TICKET} Ticket System`,
      description,
      color: colors.INFO,
      fields,
    }),

  vip: (description, fields = []) =>
    buildEmbed({
      title: `${emojis.VIP} VIP Room`,
      description,
      color: colors.GOLD,
      fields,
    }),

  admin: (description, fields = []) =>
    buildEmbed({
      title: `${emojis.ADMIN} Admin Panel`,
      description,
      color: colors.PRIMARY,
      fields,
    }),

  custom: buildEmbed,
};

module.exports = embeds;

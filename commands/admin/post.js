/**
 * Core Game Bot — /post Command
 * Send announcements with embeds, images, and link buttons
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colors = require('../../config/colors');
const emojis = require('../../config/emojis');

const COLOR_MAP = {
  purple: colors.PRIMARY,
  blue: colors.SECONDARY,
  green: colors.SUCCESS,
  gold: colors.GOLD,
  red: colors.ERROR,
  indigo: 0x4F46E5,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Send an announcement with buttons — ناردنی پۆست بە دوگمە')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Target channel — کەناڵ')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Post title — ناونیشان')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('content')
        .setDescription('Post content — ناوەڕۆک')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('color')
        .setDescription('Embed color')
        .setRequired(false)
        .addChoices(
          { name: '💜 Purple', value: 'purple' },
          { name: '💙 Blue', value: 'blue' },
          { name: '💚 Green', value: 'green' },
          { name: '💛 Gold', value: 'gold' },
          { name: '❤️ Red', value: 'red' },
          { name: '🤍 Indigo', value: 'indigo' },
        )
    )
    .addStringOption(opt =>
      opt.setName('image')
        .setDescription('Image URL — لینکی وێنە')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('thumbnail')
        .setDescription('Thumbnail URL')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button1-label')
        .setDescription('Button 1 label — ناوی دوگمە ١')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button1-url')
        .setDescription('Button 1 link URL — لینکی دوگمە ١')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button2-label')
        .setDescription('Button 2 label — ناوی دوگمە ٢')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button2-url')
        .setDescription('Button 2 link URL — لینکی دوگمە ٢')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button3-label')
        .setDescription('Button 3 label — ناوی دوگمە ٣')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('button3-url')
        .setDescription('Button 3 link URL — لینکی دوگمە ٣')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('mention-everyone')
        .setDescription('Mention @everyone?')
        .setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    const colorKey = interaction.options.getString('color') || 'purple';
    const imageUrl = interaction.options.getString('image');
    const thumbnailUrl = interaction.options.getString('thumbnail');
    const mentionEveryone = interaction.options.getBoolean('mention-everyone') || false;

    // ── Build embed ──────────────────────────
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(content)
      .setColor(COLOR_MAP[colorKey] || colors.PRIMARY)
      .setTimestamp()
      .setFooter({
        text: `Posted by ${interaction.user.tag} • Core Game`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      });

    if (imageUrl) embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

    // ── Build buttons ────────────────────────
    const buttons = [];
    const buttonEmojis = ['🔗', '🌐', '📎'];

    for (let i = 1; i <= 3; i++) {
      const label = interaction.options.getString(`button${i}-label`);
      const url = interaction.options.getString(`button${i}-url`);

      if (label && url) {
        // Ensure URL starts with http
        const finalUrl = url.startsWith('http') ? url : `https://${url}`;
        buttons.push(
          new ButtonBuilder()
            .setLabel(label)
            .setURL(finalUrl)
            .setStyle(ButtonStyle.Link)
            .setEmoji(buttonEmojis[i - 1])
        );
      }
    }

    const messagePayload = {
      content: mentionEveryone ? '@everyone' : undefined,
      embeds: [embed],
    };

    // Add button row if any buttons
    if (buttons.length > 0) {
      messagePayload.components = [new ActionRowBuilder().addComponents(...buttons)];
    }

    // ── Send to channel ──────────────────────
    await channel.send(messagePayload);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription(`✅ Post sent to <#${channel.id}> successfully!\n\nپۆستەکە نێردرا بۆ <#${channel.id}>!`)
        .setColor(colors.SUCCESS)
      ],
      ephemeral: true,
    });
  },
};

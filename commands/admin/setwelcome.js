/**
 * Core Game Bot — /setwelcome Command
 * Configure the welcome system channel, message, and background image
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const embeds = require('../../utils/embeds');
const emojis = require('../../config/emojis');
const GuildSettings = require('../../models/GuildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Configure the welcome system — ڕێکخستنی سیستەمی بەخێرهاتن')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('channel')
        .setDescription('Set the welcome channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('The channel to send welcome messages to')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('message')
        .setDescription('Set the welcome message template')
        .addStringOption(opt =>
          opt.setName('text')
            .setDescription('Message template. Use {user}, {username}, {server}, {membercount}')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('background')
        .setDescription('Set a custom welcome image background')
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('Direct URL to the background image (PNG/JPG)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('test')
        .setDescription('Send a test welcome message')
    ),

  async execute(interaction) {
    const settings = await GuildSettings.getOrCreate(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      // ── Set Channel ────────────────────────
      case 'channel': {
        const channel = interaction.options.getChannel('channel');
        settings.welcome.channelId = channel.id;
        await settings.save();

        await interaction.reply({
          embeds: [embeds.success(
            `Welcome channel set to <#${channel.id}>\n\nکەناڵی بەخێرهاتن ڕێکخرا بۆ <#${channel.id}>`
          )],
          ephemeral: true,
        });
        break;
      }

      // ── Set Message ────────────────────────
      case 'message': {
        const text = interaction.options.getString('text');
        settings.welcome.message = text;
        await settings.save();

        await interaction.reply({
          embeds: [embeds.success(
            `${emojis.SUCCESS} Welcome message updated!\n\n**Preview:**\n${text
              .replace(/{user}/g, `<@${interaction.user.id}>`)
              .replace(/{username}/g, interaction.user.username)
              .replace(/{server}/g, interaction.guild.name)
              .replace(/{membercount}/g, interaction.guild.memberCount)
            }`
          )],
          ephemeral: true,
        });
        break;
      }

      // ── Set Background ─────────────────────
      case 'background': {
        const url = interaction.options.getString('url');

        // Validate URL format
        if (!url.match(/^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)/i)) {
          return interaction.reply({
            embeds: [embeds.error('Please provide a valid image URL ending in `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`.')],
            ephemeral: true,
          });
        }

        settings.welcome.backgroundUrl = url;
        await settings.save();

        await interaction.reply({
          embeds: [embeds.success(
            `${emojis.SUCCESS} Welcome background image updated!\n\n**URL:** ${url}\n\nUse \`/setwelcome test\` to preview.`
          )],
          ephemeral: true,
        });
        break;
      }

      // ── Test Welcome ───────────────────────
      case 'test': {
        await interaction.deferReply({ ephemeral: true });

        try {
          const { generateWelcomeImage } = require('../../utils/welcomeCanvas');
          const { AttachmentBuilder } = require('discord.js');

          const imageBuffer = await generateWelcomeImage(interaction.member, settings.welcome.backgroundUrl);
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome-test.png' });

          const welcomeText = (settings.welcome.message || 'Welcome {user} to **{server}**!')
            .replace(/{user}/g, `<@${interaction.user.id}>`)
            .replace(/{username}/g, interaction.user.username)
            .replace(/{server}/g, interaction.guild.name)
            .replace(/{membercount}/g, interaction.guild.memberCount);

          const testEmbed = embeds.custom({
            title: `${emojis.SPARKLES} بەخێربێیت! — Welcome! (TEST)`,
            description: welcomeText,
            color: 0x7C3AED,
            image: 'attachment://welcome-test.png',
            fields: [
              { name: `${emojis.GAMING} Member #${interaction.guild.memberCount}`, value: 'Test preview', inline: true },
            ],
          });

          await interaction.editReply({
            embeds: [testEmbed],
            files: [attachment],
          });
        } catch (error) {
          await interaction.editReply({
            embeds: [embeds.error(`Failed to generate test welcome: ${error.message}`)],
          });
        }
        break;
      }
    }
  },
};

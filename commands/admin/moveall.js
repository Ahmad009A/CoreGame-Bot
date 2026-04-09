/**
 * Core Game Bot — /moveall Command
 * Admin-only: move all members from current voice to target channel
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moveall')
    .setDescription('Move all voice members to a channel — گواستنەوەی هەمووان بۆ چات (Admin)')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Target voice channel — ڤۆیسی مەبەست')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Only administrators can use this command!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetChannel = interaction.options.getChannel('channel');
    const sourceChannel = interaction.member.voice?.channel;

    if (!sourceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sourceChannel.id === targetChannel.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ You are already in that channel!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    let moved = 0;
    const members = sourceChannel.members;

    for (const [, member] of members) {
      try {
        await member.voice.setChannel(targetChannel);
        moved++;
      } catch (e) {
        console.error(`[MoveAll] Failed to move ${member.user.tag}:`, e.message);
      }
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('📦 Members Moved')
        .setDescription(`Moved **${moved}** member(s) from \`${sourceChannel.name}\` → \`${targetChannel.name}\``)
        .setColor(colors.SUCCESS)
        .setTimestamp()],
    });
  },
};

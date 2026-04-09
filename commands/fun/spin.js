/**
 * Core Game Bot — /spin Command
 * Admin-only gift spinner with photo upload for the gift claim
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const emojis = require('../../config/emojis');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spin')
    .setDescription('Spin the gift wheel! — چەرخی دیاری بسوڕێنە!')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption(opt =>
      opt.setName('gift-image')
        .setDescription('Upload a photo of the gift — وێنەی دیاری')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('gift-name')
        .setDescription('Name of the gift — ناوی دیاری')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('image-url')
        .setDescription('Image URL for the gift (alternative to upload)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const giftImage = interaction.options.getAttachment('gift-image');
    const giftName = interaction.options.getString('gift-name') || '🎁 Mystery Gift';
    const imageUrl = interaction.options.getString('image-url');
    const finalImage = giftImage?.url || imageUrl || null;

    // ── Get all members ──────────────────────
    const members = await interaction.guild.members.fetch();
    const humanMembers = members.filter(m => !m.user.bot);

    if (humanMembers.size === 0) {
      return interaction.editReply({
        embeds: [embeds.error('No members found!')],
      });
    }

    // ── Spinning animation ───────────────────
    const spinEmbed = new EmbedBuilder()
      .setTitle(`${emojis.SPIN || '🎰'} Spinning the Wheel...`)
      .setDescription('🔴 ⚪ ⚪ ⚪ ⚪\n\n**چەرخەکە دەسوڕێتەوە...**')
      .setColor(colors.ACCENT)
      .setTimestamp();

    const msg = await interaction.editReply({ embeds: [spinEmbed] });

    const spinFrames = [
      '🔴 ⚪ ⚪ ⚪ ⚪',
      '⚪ 🟣 ⚪ ⚪ ⚪',
      '⚪ ⚪ 🔵 ⚪ ⚪',
      '⚪ ⚪ ⚪ 🟡 ⚪',
      '⚪ ⚪ ⚪ ⚪ 🟢',
      '🎯 🎯 🎯 🎯 🎯',
    ];

    for (const frame of spinFrames) {
      await new Promise(r => setTimeout(r, 500));
      spinEmbed.setDescription(`${frame}\n\n**چەرخەکە دەسوڕێتەوە...**`);
      await msg.edit({ embeds: [spinEmbed] });
    }

    // ── Pick winner ──────────────────────────
    const memberArray = [...humanMembers.values()];
    const winner = memberArray[Math.floor(Math.random() * memberArray.length)];

    // ── Result embed ─────────────────────────
    const resultEmbed = new EmbedBuilder()
      .setTitle(`🎉🎁 WINNER! — براوە! 🎁🎉`)
      .setDescription([
        '',
        '⭐⭐⭐',
        '',
        `🎉 Congratulations **${winner.displayName}**!`,
        `<@${winner.id}> has won **${giftName}**!`,
        '',
        `پیرۆزە **${winner.displayName}**!`,
        `<@${winner.id}> بردییەوە **${giftName}**!`,
        '',
        '⭐⭐⭐',
      ].join('\n'))
      .setColor(colors.GOLD)
      .setThumbnail(winner.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({
        text: `Spun by ${interaction.user.tag} • Core Game Bot`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      })
      .setTimestamp();

    // Add gift image if provided
    if (finalImage) {
      resultEmbed.setImage(finalImage);
    }

    await msg.edit({ embeds: [resultEmbed] });
  },
};

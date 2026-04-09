/**
 * Core Game Bot — /ping Command
 * Shows bot and API latency
 */

const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const emojis = require('../../config/emojis');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency — پشکنینی خێرایی بۆت'),

  async execute(interaction) {
    const sent = await interaction.deferReply({ fetchReply: true });
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = interaction.client.ws.ping;

    // Color based on ping quality
    let pingColor = colors.SUCCESS;
    let quality = '🟢 Excellent';
    if (roundtrip > 200) { pingColor = colors.WARNING; quality = '🟡 Good'; }
    if (roundtrip > 500) { pingColor = colors.ERROR; quality = '🔴 Poor'; }

    const pingEmbed = embeds.custom({
      title: `${emojis.GAMING} Core Game — Pong!`,
      description: `**Connection Quality:** ${quality}`,
      color: pingColor,
      fields: [
        {
          name: '🏓 Round Trip',
          value: `\`${roundtrip}ms\``,
          inline: true,
        },
        {
          name: '💓 WebSocket',
          value: `\`${wsLatency}ms\``,
          inline: true,
        },
        {
          name: '📡 API Status',
          value: roundtrip < 300 ? '`Online ✅`' : '`Slow ⚠️`',
          inline: true,
        },
      ],
    });

    await interaction.editReply({ embeds: [pingEmbed] });
  },
};

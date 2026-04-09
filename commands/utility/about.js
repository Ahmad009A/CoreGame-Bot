/**
 * Core Game Bot — /about Command
 * Shows bot info
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('About this bot — دەربارەی بۆت'),

  async execute(interaction) {
    const client = interaction.client;
    const uptime = formatUptime(client.uptime);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Core Game Bot')
      .setDescription([
        '> This bot is **fully private** and owned by **Core Game**.',
        '> Created and developed by **NOT_AHMAD**.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '🎵 **Music** — Play any YouTube song by name or URL',
        '🎫 **Tickets** — Support ticket system',
        '👋 **Welcome** — Custom welcome messages with images',
        '🎰 **Spin** — Spin wheel for prizes',
        '🏆 **Ranks** — Level up by chatting and being in voice',
        '🕹️ **Games** — Fun games like Tic-Tac-Toe',
        '📢 **Announcements** — Post announcements from dashboard',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'))
      .addFields(
        { name: '👥 Servers', value: `${client.guilds.cache.size}`, inline: true },
        { name: '👤 Users', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`, inline: true },
        { name: '⏱️ Uptime', value: uptime, inline: true },
      )
      .setColor(colors.PRIMARY)
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: '© Core Game • NOT_AHMAD' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

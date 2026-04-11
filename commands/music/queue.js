/**
 * Core Game Bot — /queue Command
 * Show the current music queue
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show music queue — پیشاندانی ڕیزی گۆرانی'),

  async execute(interaction) {
    try {
      const { queues } = require('./play');
      const queue = queues.get(interaction.guild.id);

      if (!queue || queue.songs.length === 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('📭 Queue is empty. Use `/play` to add songs!\n\nڕیزەکە بەتاڵە. `/play` بەکاربهێنە بۆ زیادکردنی گۆرانی!')
            .setColor(colors.INFO)],
        });
      }

      const lines = queue.songs.map((song, i) => {
        const prefix = i === 0 ? '▶️' : `${i}.`;
        return `${prefix} **${song.title}** — \`${song.duration}\``;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🎶 Music Queue (${queue.songs.length} song${queue.songs.length > 1 ? 's' : ''})`)
        .setDescription(lines.join('\n'))
        .setColor(colors.ACCENT)
        .setFooter({ text: '/skip to skip • /stop to stop all' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[Music] Queue error:', err.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('📭 No queue active.')
          .setColor(colors.INFO)],
      });
    }
  },
};

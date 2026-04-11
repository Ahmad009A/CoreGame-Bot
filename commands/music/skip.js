/**
 * Core Game Bot — /skip Command
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song — بازدانی گۆرانی ئێستا'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Nothing is playing!\n\nهیچ شتێک لێنادرێت!')
          .setColor(colors.ERROR)],
      });
    }

    const { queues } = require('./play');
    const queue = queues.get(interaction.guild.id);

    if (!queue || queue.songs.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Nothing is playing!')
          .setColor(colors.ERROR)],
      });
    }

    const skippedTitle = queue.songs[0]?.title || 'Unknown';
    const nextSong = queue.songs.length > 1 ? queue.songs[1] : null;

    // Stop player → triggers Idle event → auto-plays next
    queue.player.stop();

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('⏭️ Skipped')
        .setDescription(`Skipped: **${skippedTitle}**${nextSong ? `\n\n🎵 Next: **${nextSong.title}**` : '\n\n📭 Queue is empty.'}`)
        .setColor(colors.SUCCESS)
        .setTimestamp()],
    });
  },
};

/**
 * Core Game Bot — /skip Command
 * Skip current song, kill ffmpeg, play next in queue
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song — بازدانی گۆرانی ئێستا'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Nothing is playing!\n\nهیچ شتێک لێنادرێت!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const { queues } = require('./play');
      const queue = queues.get(interaction.guild.id);

      if (!queue || queue.songs.length === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Nothing is playing!')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const skippedTitle = queue.songs[0]?.title || 'Unknown';
      const nextSong = queue.songs.length > 1 ? queue.songs[1] : null;

      // Kill current ffmpeg process
      if (queue.ffmpeg) { queue.ffmpeg.kill('SIGKILL'); queue.ffmpeg = null; }

      // Stop player → triggers Idle event → auto-plays next
      queue.player.stop();

      const embed = new EmbedBuilder()
        .setTitle('⏭️ Skipped')
        .setDescription(`Skipped: **${skippedTitle}**${nextSong ? `\n\n🎵 Next: **${nextSong.title}**` : '\n\n📭 Queue is empty.'}`)
        .setColor(colors.SUCCESS)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

    } catch (err) {
      console.error('[Music] Skip error:', err.message);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Could not skip.')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

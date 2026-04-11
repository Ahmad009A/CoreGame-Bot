/**
 * Core Game Bot — /stop Command
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music and leave voice — وەستاندنی مۆسیقا'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ I am not in any voice channel!')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    try {
      const { queues } = require('./play');
      const queue = queues.get(interaction.guild.id);
      if (queue) {
        queue.playing = false;
        queue.songs = [];
        queue.player.stop(true);
        // Kill ffmpeg & audio stream
        if (queue.ffmpeg) { try { queue.ffmpeg.kill('SIGKILL'); } catch {} }
        if (queue.audioStream) { try { queue.audioStream.destroy(); } catch {} }
        queues.delete(interaction.guild.id);
      }
    } catch {}

    try { connection.destroy(); } catch {}

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Music Stopped')
        .setDescription('Cleared queue and left voice.\n\nمۆسیقا وەستا و دەرچووم.')
        .setColor(colors.SUCCESS)],
    }).catch(() => {});
  },
};

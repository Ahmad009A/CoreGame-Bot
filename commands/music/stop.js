/**
 * Core Game Bot — /stop Command
 * Stop music, kill stream, clear queue, leave voice
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music and leave voice — وەستاندنی مۆسیقا'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ I am not in any voice channel!\n\nمن لە هیچ ڤۆیس چاتێک نیم!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Clear queue and kill ffmpeg
    try {
      const { queues } = require('./play');
      const queue = queues.get(interaction.guild.id);
      if (queue) {
        queue.songs = [];
        if (queue.ffmpeg) { queue.ffmpeg.kill('SIGKILL'); queue.ffmpeg = null; }
        queue.player.stop(true);
        queues.delete(interaction.guild.id);
      }
    } catch {}

    try { connection.destroy(); } catch {}

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Music Stopped')
        .setDescription('Cleared queue and left voice.\n\nمۆسیقا وەستا و دەرچووم.')
        .setColor(colors.SUCCESS)],
    });
  },
};

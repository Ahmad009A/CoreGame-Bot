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
          .setDescription('❌ I am not in any voice channel!\n\nمن لە هیچ ڤۆیس چاتێک نیم!')
          .setColor(colors.ERROR)],
      });
    }

    try {
      const { queues } = require('./play');
      const queue = queues.get(interaction.guild.id);
      if (queue) {
        queue.songs = [];
        queue.playing = false;
        queue.player.stop(true);
        queues.delete(interaction.guild.id);
      }
    } catch {}

    try { connection.destroy(); } catch {}

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Music Stopped')
        .setDescription('Cleared queue and left voice.\n\nمۆسیقا وەستا و دەرچووم.')
        .setColor(colors.SUCCESS)],
    });
  },
};

/**
 * Core Game Bot — /stop Command
 * Stop music, clear queue, and leave voice channel
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
          .setColor(colors.ERROR)
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Clear queue if exists
    try {
      const { queues } = require('./play');
      if (queues.has(interaction.guild.id)) {
        const queue = queues.get(interaction.guild.id);
        queue.songs = [];
        queue.player.stop();
        queues.delete(interaction.guild.id);
      }
    } catch {}

    try {
      connection.destroy();
    } catch {}

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Music Stopped')
        .setDescription('Cleared queue and left voice.\n\nمۆسیقا وەستا و دەرچووم لە ڤۆیس.')
        .setColor(colors.SUCCESS)
      ],
    });
  },
};

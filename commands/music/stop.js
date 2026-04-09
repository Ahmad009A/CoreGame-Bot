/**
 * Core Game Bot — /stop Command
 * Stop music playback and leave voice channel
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
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ I am not in any voice channel!\n\nمن لە هیچ ڤۆیس چاتێک نیم!')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    try {
      connection.destroy();
    } catch (e) {
      // already destroyed
    }

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Music Stopped')
        .setDescription('Left the voice channel.\n\nمۆسیقا وەستا. دەرچووم لە ڤۆیس.')
        .setColor(colors.SUCCESS)
      ],
    });
  },
};

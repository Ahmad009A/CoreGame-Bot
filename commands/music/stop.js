/**
 * Core Game Bot — /stop Command
 * Stop music and leave voice channel
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music and leave voice — وەستاندن و دەرچوون لە ڤۆیس'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ I am not in a voice channel!\n\nمن لە ڤۆیس چاتێک نیم!')
          .setColor(colors.ERROR)
        ],
        ephemeral: true,
      });
    }

    connection.destroy();

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setDescription('⏹️ **Music stopped.** Left the voice channel.\n\nمۆسیقا وەستا. دەرچووم لە ڤۆیس.')
        .setColor(colors.SUCCESS)
      ],
    });
  },
};

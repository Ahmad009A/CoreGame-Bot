/**
 * Core Game Bot — /playlist Command
 * Create and play playlists of YouTube URLs
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const colors = require('../../config/colors');

// In-memory playlist storage per user
const playlists = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Manage music playlists — لیستی مۆسیقا')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a playlist — دروستکردنی لیست')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
        .addStringOption(o => o.setName('url1').setDescription('YouTube URL #1').setRequired(true))
        .addStringOption(o => o.setName('url2').setDescription('YouTube URL #2').setRequired(false))
        .addStringOption(o => o.setName('url3').setDescription('YouTube URL #3').setRequired(false))
        .addStringOption(o => o.setName('url4').setDescription('YouTube URL #4').setRequired(false))
        .addStringOption(o => o.setName('url5').setDescription('YouTube URL #5').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('Play a saved playlist — لێدانی لیست')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show your playlists — پیشاندانی لیستەکان')
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a playlist — سڕینەوەی لیست')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (!playlists.has(userId)) playlists.set(userId, new Map());
    const userPlaylists = playlists.get(userId);

    // ── CREATE ────────────────────────────
    if (sub === 'create') {
      const name = interaction.options.getString('name').toLowerCase();
      const urls = [];
      for (let i = 1; i <= 5; i++) {
        const url = interaction.options.getString(`url${i}`);
        if (url) urls.push(url);
      }

      if (userPlaylists.size >= 10) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Max 10 playlists. Delete one first.')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      userPlaylists.set(name, urls);

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('📋 Playlist Created')
          .setDescription(`**${name}** — ${urls.length} song(s)\n\nUse \`/playlist play ${name}\` to play!`)
          .setColor(colors.SUCCESS)
          .setTimestamp()],
      });
    }

    // ── PLAY ──────────────────────────────
    else if (sub === 'play') {
      const name = interaction.options.getString('name').toLowerCase();
      const urls = userPlaylists.get(name);

      if (!urls) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription(`❌ Playlist **${name}** not found.\n\nUse \`/playlist list\` to see your playlists.`)
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Join a voice channel first!')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      // Play each URL through the /play command
      const playCmd = interaction.client.commands.get('play');

      for (let i = 0; i < urls.length; i++) {
        try {
          // Create a mock interaction for the play command
          const fakeInteraction = {
            ...interaction,
            options: {
              getString: (key) => key === 'query' || key === 'url' ? urls[i] : null,
            },
            deferReply: async () => {},
            editReply: async (data) => {
              if (i === 0) await interaction.editReply(data);
              else await interaction.channel.send(data);
            },
            reply: async (data) => await interaction.channel.send(data),
          };

          await playCmd.execute(fakeInteraction);
        } catch (e) {
          console.error(`[Playlist] Error playing URL ${i + 1}:`, e.message);
        }
      }

      if (urls.length > 1) {
        await interaction.channel.send({
          embeds: [new EmbedBuilder()
            .setDescription(`📋 Playlist **${name}** — ${urls.length} songs queued!`)
            .setColor(colors.ACCENT)],
        });
      }
    }

    // ── LIST ──────────────────────────────
    else if (sub === 'list') {
      if (userPlaylists.size === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('📭 No playlists yet. Use `/playlist create` to make one!')
            .setColor(colors.INFO)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = [];
      for (const [name, urls] of userPlaylists) {
        lines.push(`📋 **${name}** — ${urls.length} song(s)`);
      }

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🎵 Your Playlists')
          .setDescription(lines.join('\n'))
          .setColor(colors.ACCENT)
          .setFooter({ text: 'Use /playlist play <name> to play' })],
      });
    }

    // ── DELETE ────────────────────────────
    else if (sub === 'delete') {
      const name = interaction.options.getString('name').toLowerCase();
      if (!userPlaylists.has(name)) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription(`❌ Playlist **${name}** not found.`)
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      userPlaylists.delete(name);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`🗑️ Playlist **${name}** deleted.`)
          .setColor(colors.SUCCESS)],
      });
    }
  },
};

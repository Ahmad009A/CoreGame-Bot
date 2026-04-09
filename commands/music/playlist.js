/**
 * Core Game Bot — /playlist Command
 * Create and play playlists of YouTube URLs
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
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

      // Use play.js internals directly
      const { queues, getAudioInfo, playSong } = require('./play');

      try {
        // Get or create queue
        let queue = queues.get(interaction.guild.id);

        if (!queue) {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
          });

          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
          } catch {
            connection.destroy();
            return interaction.editReply({
              embeds: [new EmbedBuilder().setDescription('❌ Cannot join voice!').setColor(colors.ERROR)],
            });
          }

          const player = createAudioPlayer();
          connection.subscribe(player);

          queue = { connection, player, songs: [], channel: interaction.channel, guildId: interaction.guild.id };
          queues.set(interaction.guild.id, queue);

          player.on(AudioPlayerStatus.Idle, () => {
            queue.songs.shift();
            if (queue.songs.length > 0) {
              playSong(queue);
              queue.channel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('🎵 Now Playing')
                  .setDescription(`🎶 **${queue.songs[0].title}**\n⏱️ \`${queue.songs[0].duration}\``)
                  .setColor(colors.ACCENT)],
              }).catch(() => {});
            } else {
              console.log('■ Queue empty, leaving voice.');
              queue.connection.destroy();
              queues.delete(interaction.guild.id);
            }
          });

          player.on('error', err => {
            console.error('[Music] Player error:', err.message);
            queue.songs.shift();
            if (queue.songs.length > 0) playSong(queue);
          });

          connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
              await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
            } catch { connection.destroy(); queues.delete(interaction.guild.id); }
          });
        }

        // Load all songs into queue
        let loaded = 0;
        let firstTitle = '';

        for (const url of urls) {
          try {
            const info = await getAudioInfo(url);
            if (info.audioUrl) {
              queue.songs.push(info);
              loaded++;
              if (!firstTitle) firstTitle = info.title;
            }
          } catch (e) {
            console.error(`[Playlist] Failed to load: ${url} — ${e.message}`);
          }
        }

        if (loaded === 0) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('❌ Could not load any songs from this playlist.')
              .setColor(colors.ERROR)],
          });
        }

        // Start playing if this is the first batch
        if (queue.songs.length === loaded) {
          playSong(queue);
        }

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle(`📋 Playing Playlist: ${name}`)
            .setDescription([
              `🎶 Loaded **${loaded}/${urls.length}** songs`,
              `▶️ Now: **${firstTitle}**`,
              '',
              `Use \`/queue\` to see all songs`,
            ].join('\n'))
            .setColor(colors.ACCENT)
            .setTimestamp()],
        });

      } catch (error) {
        console.error('[Playlist] Error:', error.message);
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Playlist error. Try again.')
            .setColor(colors.ERROR)],
        }).catch(() => {});
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
      for (const [pName, pUrls] of userPlaylists) {
        lines.push(`📋 **${pName}** — ${pUrls.length} song(s)`);
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

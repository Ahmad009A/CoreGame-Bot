/**
 * Core Game Bot — /playlist Command
 * Create, manage, and play playlists with dropdown UI
 * Kurdish Sorani + English
 */

const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ActionRowBuilder, StringSelectMenuBuilder, ComponentType,
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const colors = require('../../config/colors');

// In-memory playlists per user
const playlists = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('لیستی مۆسیقا — Manage playlists')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('دروستکردنی لیست — Create a new playlist')
        .addStringOption(o => o.setName('name').setDescription('ناوی لیست — Playlist name').setRequired(true))
        .addStringOption(o => o.setName('url1').setDescription('لینکی ١ — YouTube URL #1').setRequired(true))
        .addStringOption(o => o.setName('url2').setDescription('لینکی ٢ — YouTube URL #2').setRequired(false))
        .addStringOption(o => o.setName('url3').setDescription('لینکی ٣ — YouTube URL #3').setRequired(false))
        .addStringOption(o => o.setName('url4').setDescription('لینکی ٤ — YouTube URL #4').setRequired(false))
        .addStringOption(o => o.setName('url5').setDescription('لینکی ٥ — YouTube URL #5').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('لێدانی لیست — Play a saved playlist')
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('سڕینەوەی لیست — Delete a playlist')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (!playlists.has(userId)) playlists.set(userId, new Map());
    const userPlaylists = playlists.get(userId);

    // ══════════════════════════════════════
    //  CREATE — دروستکردنی لیست
    // ══════════════════════════════════════
    if (sub === 'create') {
      const name = interaction.options.getString('name').trim();
      const urls = [];
      for (let i = 1; i <= 5; i++) {
        const url = interaction.options.getString(`url${i}`);
        if (url && url.startsWith('http')) urls.push(url.trim());
      }

      if (urls.length === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ لانیکەم یەک لینکی YouTube داربنێ!\nProvide at least one YouTube URL!')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (userPlaylists.size >= 10) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ زۆرترین ١٠ لیست دروست دەکرێت. یەکێک بسڕەوە!\nMax 10 playlists. Delete one first!')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      userPlaylists.set(name, urls);

      const embed = new EmbedBuilder()
        .setTitle('📋 لیست دروستکرا — Playlist Created')
        .setDescription([
          `📛 **${name}**`,
          `🎵 **${urls.length}** گۆرانی — songs`,
          '',
          ...urls.map((u, i) => `${i + 1}. ${u}`),
          '',
          `✅ بۆ لێدان: \`/playlist play\``,
          `To play: \`/playlist play\``,
        ].join('\n'))
        .setColor(colors.SUCCESS)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // ══════════════════════════════════════
    //  PLAY — لێدانی لیست (Dropdown UI)
    // ══════════════════════════════════════
    else if (sub === 'play') {
      if (userPlaylists.size === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('📭 هیچ لیستێکت نییە! `/playlist create` بەکاربهێنە\nNo playlists! Use `/playlist create`')
            .setColor(colors.INFO)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ سەرەتا بچوو بۆ ڤۆیس چات!\nJoin a voice channel first!')
            .setColor(colors.ERROR)],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Build the dropdown menu
      const options = [];
      for (const [name, urls] of userPlaylists) {
        options.push({
          label: name,
          description: `${urls.length} گۆرانی — ${urls.length} songs`,
          value: name,
          emoji: '🎵',
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`playlist_select_${userId}`)
        .setPlaceholder('🎵 لیستێک هەڵبژێرە — Select a playlist')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setTitle('🎵 لیستەکانت — Your Playlists')
        .setDescription('لیستێک هەڵبژێرە بۆ لێدان\nSelect a playlist to play:')
        .setColor(colors.ACCENT);

      const msg = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      // Wait for selection (60 seconds)
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60_000,
        filter: (i) => i.user.id === userId,
      });

      collector.on('collect', async (selectInteraction) => {
        const selectedName = selectInteraction.values[0];
        const urls = userPlaylists.get(selectedName);

        if (!urls) {
          return selectInteraction.update({
            embeds: [new EmbedBuilder()
              .setDescription('❌ لیست نەدۆزرایەوە!\nPlaylist not found!')
              .setColor(colors.ERROR)],
            components: [],
          });
        }

        // Disable the dropdown
        await selectInteraction.update({
          embeds: [new EmbedBuilder()
            .setTitle(`🎶 لیست: ${selectedName}`)
            .setDescription(`⏳ بارکردنی ${urls.length} گۆرانی...\nLoading ${urls.length} songs...`)
            .setColor(colors.ACCENT)],
          components: [],
        });

        // Get play.js internals
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
              return selectInteraction.followUp({
                embeds: [new EmbedBuilder().setDescription('❌ نەتوانم بچمە ڤۆیس!').setColor(colors.ERROR)],
                flags: MessageFlags.Ephemeral,
              });
            }

            const player = createAudioPlayer();
            connection.subscribe(player);

            queue = {
              connection, player,
              songs: [],
              channel: interaction.channel,
              guildId: interaction.guild.id,
            };
            queues.set(interaction.guild.id, queue);

            player.on(AudioPlayerStatus.Idle, () => {
              queue.songs.shift();
              if (queue.songs.length > 0) {
                playSong(queue);
                queue.channel.send({
                  embeds: [new EmbedBuilder()
                    .setTitle('🎵 ئێستا لێدەدرێت — Now Playing')
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
              console.error('[Playlist] Player error:', err.message);
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

          // Load all songs
          let loaded = 0;
          const wasEmpty = queue.songs.length === 0;

          for (const url of urls) {
            try {
              const info = await getAudioInfo(url);
              if (info && info.audioUrl) {
                queue.songs.push(info);
                loaded++;
              }
            } catch (e) {
              console.error(`[Playlist] Failed: ${url.substring(0, 50)} — ${e.message}`);
            }
          }

          if (loaded === 0) {
            return selectInteraction.followUp({
              embeds: [new EmbedBuilder()
                .setDescription('❌ هیچ گۆرانییەک بارنەکرا!\nCould not load any songs!')
                .setColor(colors.ERROR)],
            });
          }

          // Start playing if queue was empty
          if (wasEmpty && queue.songs.length > 0) {
            playSong(queue);
          }

          await selectInteraction.followUp({
            embeds: [new EmbedBuilder()
              .setTitle(`🎶 لیست لێدەدرێت — Playing: ${selectedName}`)
              .setDescription([
                `✅ **${loaded}/${urls.length}** گۆرانی بارکرا — songs loaded`,
                '',
                `▶️ ئێستا: **${queue.songs[0]?.title || '...'}**`,
                '',
                `📋 \`/queue\` — بینینی ڕیز`,
                `⏭️ \`/skip\` — بازدان`,
                `⏹️ \`/stop\` — وەستان`,
              ].join('\n'))
              .setColor(colors.SUCCESS)
              .setTimestamp()],
          });

        } catch (error) {
          console.error('[Playlist] Error:', error.message);
          await selectInteraction.followUp({
            embeds: [new EmbedBuilder()
              .setDescription(`❌ هەڵە! ${error.message}\nError! Try again.`)
              .setColor(colors.ERROR)],
          }).catch(() => {});
        }

        collector.stop();
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('⏰ کاتت تەواو بوو! دووبارە هەوڵ بدەرەوە.\nTime expired! Try again.')
              .setColor(colors.ERROR)],
            components: [],
          }).catch(() => {});
        }
      });
    }

    // ══════════════════════════════════════
    //  DELETE — سڕینەوەی لیست (Dropdown UI)
    // ══════════════════════════════════════
    else if (sub === 'delete') {
      if (userPlaylists.size === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('📭 هیچ لیستێکت نییە!\nNo playlists to delete!')
            .setColor(colors.INFO)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const options = [];
      for (const [name, urls] of userPlaylists) {
        options.push({
          label: name,
          description: `${urls.length} گۆرانی — songs`,
          value: name,
          emoji: '🗑️',
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`playlist_del_${userId}`)
        .setPlaceholder('🗑️ لیستێک هەڵبژێرە بۆ سڕینەوە — Select to delete')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const msg = await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🗑️ سڕینەوەی لیست — Delete Playlist')
          .setDescription('کام لیست بسڕدرێتەوە?\nWhich playlist to delete?')
          .setColor(colors.ERROR)],
        components: [row],
        fetchReply: true,
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 30_000,
        filter: (i) => i.user.id === userId,
      });

      collector.on('collect', async (selectInteraction) => {
        const name = selectInteraction.values[0];
        userPlaylists.delete(name);

        await selectInteraction.update({
          embeds: [new EmbedBuilder()
            .setDescription(`🗑️ لیستی **${name}** سڕایەوە!\nPlaylist **${name}** deleted!`)
            .setColor(colors.SUCCESS)],
          components: [],
        });
        collector.stop();
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction.editReply({
            embeds: [new EmbedBuilder().setDescription('⏰ کاتت تەواو بوو!').setColor(colors.ERROR)],
            components: [],
          }).catch(() => {});
        }
      });
    }
  },
};

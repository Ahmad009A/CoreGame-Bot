/**
 * Core Game Bot — /play Command
 * Full rewrite based on reference architecture:
 * yt-dlp (get audio URL) → createAudioResource(URL) → Discord Voice
 * 
 * Simple, reliable, no prism.FFmpeg, no Invidious.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior, getVoiceConnection,
} = require('@discordjs/voice');
const YouTubeModule = require('../../src/YouTube');
const colors = require('../../config/colors');

// Queue per server — exported for skip/stop/queue commands
const queues = new Map();

// ── Play the current song ──
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}"`);
  try {
    // Get fresh audio URL via yt-dlp
    const data = await YouTubeModule.getStreamUrl(song.url);

    // createAudioResource directly from URL — discord.js handles ffmpeg internally
    const resource = createAudioResource(data.audioUrl, {
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.0);

    queue.player.play(resource);
    queue.playing = true;
    console.log(`[Music] ✅ Playing: "${song.title}"`);

  } catch (err) {
    console.error(`[Music] playSong error: ${err.message}`);
    queue.songs.shift();

    // Try next song
    if (queue.songs.length > 0) {
      queue.channel.send({
        embeds: [new EmbedBuilder()
          .setDescription(`⚠️ Failed to play. Trying next...`)
          .setColor(colors.WARNING)],
      }).catch(() => {});
      await playSong(queue);
    } else {
      try { queue.connection.destroy(); } catch {}
      queues.delete(queue.guildId);
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music in voice — لێدانی مۆسیقا لە ڤۆیس')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name or YouTube URL — ناوی گۆرانی یان لینک')
        .setRequired(true)
    ),

  queues,
  playSong,

  async execute(interaction) {
    // Defer reply (handler already defers for slow commands)
    if (!interaction.deferred && !interaction.replied) {
      try { await interaction.deferReply(); } catch {}
    }

    const query = (interaction.options.getString('query') || '').trim();
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    if (!query) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }

    try {
      // ── Step 1: Resolve track metadata ──
      let track;
      if (query.startsWith('http')) {
        console.log(`[Music] URL: ${query}`);
        const info = await YouTubeModule.getInfo(query);
        track = {
          title: info.title || 'Unknown',
          url: info.url,
          durationFormatted: info.durationFormatted || '?',
          thumbnail: info.thumbnail || null,
        };
      } else {
        console.log(`[Music] Searching: "${query}"`);
        const results = await YouTubeModule.search(query, 1);
        if (!results?.length) throw new Error('No results found');
        const r = results[0];
        track = {
          title: r.title || 'Unknown',
          url: r.url,
          durationFormatted: r.durationFormatted || '?',
          thumbnail: r.thumbnail || null,
        };
        console.log(`[Music] Found: "${track.title}"`);
      }

      let queue = queues.get(interaction.guild.id);

      // ── Step 2: Join voice if needed ──
      if (!queue) {
        // Kill stale connections
        const existing = getVoiceConnection(interaction.guild.id);
        if (existing) {
          try { existing.destroy(); } catch {}
          await new Promise(r => setTimeout(r, 300));
        }

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        // Wait for voice ready (30s for Railway)
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
          console.log(`[Music] ✅ Joined: ${voiceChannel.name}`);
        } catch {
          try { connection.destroy(); } catch {}
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setDescription('❌ Could not join voice channel.\nCheck **Connect** and **Speak** permissions!')
              .setColor(colors.ERROR)],
          }).catch(() => {});
        }

        const player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play },
        });
        connection.subscribe(player);

        queue = {
          connection, player, songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
          playing: false,
        };
        queues.set(interaction.guild.id, queue);

        // ── Track finished → play next ──
        player.on(AudioPlayerStatus.Idle, () => {
          if (!queue.playing) return;
          queue.playing = false;
          queue.songs.shift();

          if (queue.songs.length > 0) {
            playSong(queue);
            queue.channel.send({
              embeds: [new EmbedBuilder()
                .setTitle('🎵 Now Playing')
                .setDescription(`🎶 **${queue.songs[0].title}**`)
                .setColor(colors.ACCENT)],
            }).catch(() => {});
          } else {
            console.log('[Music] Queue empty, leaving.');
            try { queue.connection.destroy(); } catch {}
            queues.delete(queue.guildId);
          }
        });

        player.on(AudioPlayerStatus.Playing, () => {
          queue.playing = true;
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          queue.playing = false;
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
          else {
            try { queue.connection.destroy(); } catch {}
            queues.delete(queue.guildId);
          }
        });

        // Handle disconnects
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          console.log('[Music] Disconnected, trying to reconnect...');
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            console.log('[Music] Reconnect failed, cleaning up.');
            try { connection.destroy(); } catch {}
            queues.delete(queue.guildId);
          }
        });

        connection.on('stateChange', (old, curr) => {
          console.log(`[Voice] ${old.status} → ${curr.status}`);
        });
      }

      // ── Step 3: Add to queue and play ──
      queue.songs.push(track);

      if (queue.songs.length === 1) {
        await playSong(queue);

        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${track.title}**\n\n⏱️ \`${track.durationFormatted}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(track.url)
          .setFooter({ text: '/skip • /queue • /stop' })
          .setTimestamp();
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${track.title}**\n📌 #${queue.songs.length} in queue • ⏱️ \`${track.durationFormatted}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      }

    } catch (error) {
      console.error('[Music] ERROR:', error.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(`Could not play.\n\`${error.message?.substring(0, 100)}\`\n\nتاقی بکەرەوە.`)
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

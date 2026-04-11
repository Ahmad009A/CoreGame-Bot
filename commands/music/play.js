/**
 * Core Game Bot — /play Command
 * Uses play-dl — native Node.js YouTube streaming
 * No cookies, no CLI, no account. Anonymous public access.
 * Opens a live audio stream and pushes audio data in real time to Discord
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Get audio info — search YouTube or resolve direct URL
async function getAudioInfo(query) {
  const isUrl = query.startsWith('http');

  if (isUrl) {
    console.log(`[Music] URL: ${query}`);
    try {
      const type = await play.validate(query);
      console.log(`[Music] URL type: ${type}`);
      if (type === 'yt_video') {
        const info = await play.video_info(query);
        const v = info.video_details;
        return {
          title: v.title || 'Unknown',
          videoUrl: v.url,
          duration: v.durationRaw || 'Live 🔴',
          thumbnail: v.thumbnails?.[0]?.url || null,
        };
      }
    } catch (e) {
      console.log('[Music] URL info failed:', e.message);
    }
    // Fallback: search
    const results = await play.search(query, { limit: 1 });
    if (results.length === 0) throw new Error('No results');
    const v = results[0];
    return { title: v.title, videoUrl: v.url, duration: v.durationRaw || '?', thumbnail: v.thumbnails?.[0]?.url };
  }

  // Search YouTube by text
  console.log(`[Music] Searching: "${query}"`);
  const results = await play.search(query, { limit: 1 });
  if (results.length === 0) throw new Error('No results found');

  const v = results[0];
  console.log(`[Music] Found: "${v.title}" → ${v.url}`);
  return {
    title: v.title || 'Unknown',
    videoUrl: v.url,
    duration: v.durationRaw || 'Live 🔴',
    thumbnail: v.thumbnails?.[0]?.url || null,
  };
}

// Play the current song — opens a live audio stream and pushes it to Discord
async function playSong(queue) {
  const song = queue.songs[0];
  if (!song) return;

  console.log(`▶ Playing: "${song.title}" — ${song.videoUrl}`);

  try {
    // Open a live audio stream from YouTube
    console.log('[Music] Creating stream...');
    const stream = await play.stream(song.videoUrl);
    console.log(`[Music] Stream created, type: ${stream.type}`);

    // Create Discord audio resource
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    resource.playStream.on('error', (err) => {
      console.error('[Music] Resource stream error:', err.message);
    });

    // Push the audio to Discord
    queue.player.play(resource);
    queue.playing = true;
    console.log('[Music] Audio resource sent to player ✅');

  } catch (err) {
    console.error(`[Music] Stream error for "${song.title}":`, err.message);
    console.error('[Music] Full error:', err);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      await playSong(queue);
    } else {
      console.log('■ Queue empty after error, leaving voice.');
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
  getAudioInfo,
  playSong,

  async execute(interaction) {
    // Note: deferReply() is already called by interactionCreate handler
    const query = (interaction.options.getString('query') || '').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
      });
    }

    if (!query) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
      });
    }

    try {
      // Search/resolve the song
      const info = await getAudioInfo(query);

      // Get or create queue for this server
      let queue = queues.get(interaction.guild.id);

      if (!queue) {
        // Join the voice channel
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
          console.log(`[Music] Joined voice: ${voiceChannel.name}`);
        } catch {
          connection.destroy();
          return interaction.editReply({
            embeds: [new EmbedBuilder().setDescription('❌ Cannot join voice!').setColor(colors.ERROR)],
          });
        }

        // Create audio player
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });

        connection.subscribe(player);

        queue = {
          connection,
          player,
          songs: [],
          channel: interaction.channel,
          guildId: interaction.guild.id,
          playing: false,
        };
        queues.set(interaction.guild.id, queue);

        // When a song finishes, play next
        player.on(AudioPlayerStatus.Idle, () => {
          console.log(`[Music] Player Idle — playing was: ${queue.playing}`);
          if (!queue.playing) return; // Don't act on initial Idle

          queue.playing = false;
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
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        // Track when audio actually starts
        player.on(AudioPlayerStatus.Playing, () => {
          console.log('[Music] ✅ Audio is now streaming');
          queue.playing = true;
        });

        // Handle buffering
        player.on(AudioPlayerStatus.Buffering, () => {
          console.log('[Music] ⏳ Buffering...');
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
          console.error('[Music] Resource:', err.resource?.metadata);
          queue.playing = false;
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
          else {
            try { queue.connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        // Handle disconnection
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          console.log('[Music] Voice disconnected');
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch {
            try { connection.destroy(); } catch {}
            queues.delete(interaction.guild.id);
          }
        });

        // Log all state changes
        connection.on('stateChange', (old, cur) => {
          console.log(`[Music] Connection: ${old.status} → ${cur.status}`);
        });
      }

      // Add song to queue
      queue.songs.push(info);

      if (queue.songs.length === 1) {
        // First song — start playing
        await playSong(queue);

        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${info.title}**\n\n⏱️ \`${info.duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(info.videoUrl)
          .setFooter({ text: '/skip • /queue • /stop' })
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${info.title}**\n📌 #${queue.songs.length} • ⏱️ \`${info.duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (info.thumbnail) embed.setThumbnail(info.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] ERROR:', error.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try again.\n\nتاقی بکەرەوە.')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

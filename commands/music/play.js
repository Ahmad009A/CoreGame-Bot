/**
 * Core Game Bot — /play Command
 * Uses play-dl — native Node.js YouTube streaming
 * No cookies, no CLI, no account. Anonymous public access.
 * Like pro bots: opens a live audio stream and pushes it in real time
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  StreamType, NoSubscriberBehavior,
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
      // Validate and get video info
      const type = await play.validate(query);
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
      console.log('[Music] URL failed, trying search:', e.message);
    }
    // Fallback: search by the URL text
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
  console.log(`[Music] Found: "${v.title}"`);
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
    const stream = await play.stream(song.videoUrl);
    console.log(`▶ Stream ready, type: ${stream.type}`);

    // Create Discord audio resource from the stream
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    // Push the audio to Discord voice
    queue.player.play(resource);
    console.log(`▶ Audio resource pushed to player`);

  } catch (err) {
    console.error(`[Music] Stream error for "${song.title}":`, err.message);
    // Skip to next song on error
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
    // IMMEDIATELY defer — prevents "Unknown interaction" timeout
    await interaction.deferReply();

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

        // Create audio player with proper behavior
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play, // Keep playing even if no one listens
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

        // When a song finishes, play the next one
        player.on(AudioPlayerStatus.Idle, () => {
          console.log('[Music] Player went Idle');
          // Only advance queue if we were actually playing
          if (queue.playing) {
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
          }
        });

        // Track when player starts playing
        player.on(AudioPlayerStatus.Playing, () => {
          console.log('[Music] Player is now Playing ✅');
          queue.playing = true;
        });

        player.on('error', err => {
          console.error('[Music] Player error:', err.message);
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
      }

      // Add song to queue
      queue.songs.push(info);

      if (queue.songs.length === 1) {
        // First song — start playing now
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
        // Added to queue
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

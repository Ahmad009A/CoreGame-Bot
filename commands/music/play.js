/**
 * Core Game Bot — /play Command (Production)
 * Strategy: YouTube first → SoundCloud fallback
 * SoundCloud NEVER blocks cloud IPs = 100% uptime
 * Queue system with auto-play next
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const play = require('play-dl');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

// Initialize SoundCloud client (runs once)
let scReady = false;
async function initSoundCloud() {
  if (scReady) return;
  try {
    const clientId = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientId } });
    scReady = true;
    console.log('[Music] SoundCloud initialized ✅');
  } catch (e) {
    console.error('[Music] SoundCloud init failed:', e.message);
  }
}

// Play the first song in the queue
async function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}" (${song.source})`);

  try {
    const stream = await play.stream(song.streamUrl);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    queue.player.play(resource);
  } catch (err) {
    console.error('[Music] playSong error:', err.message);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      playSong(queue);
    } else {
      queue.connection.destroy();
      queues.delete(queue.guildId);
    }
  }
}

// Try to get a streamable result
async function findAndStream(query) {
  await initSoundCloud();

  const isUrl = query.startsWith('http');
  const isYouTubeUrl = isUrl && (query.includes('youtu.be') || query.includes('youtube.com'));
  const isSoundCloudUrl = isUrl && query.includes('soundcloud.com');

  // ── Direct SoundCloud URL ────────────────
  if (isSoundCloudUrl) {
    const info = await play.soundcloud(query);
    return {
      title: info.name || 'SoundCloud Track',
      streamUrl: query,
      displayUrl: query,
      duration: formatMs(info.durationInMs),
      thumbnail: info.thumbnail,
      source: 'SoundCloud',
    };
  }

  // ── Try YouTube first (URL or search) ────
  if (isYouTubeUrl) {
    try {
      const info = await play.video_info(query);
      const stream = await play.stream(query);
      // If we got here, YouTube works!
      stream.stream.destroy(); // Close test stream
      return {
        title: info.video_details.title,
        streamUrl: query,
        displayUrl: query,
        duration: info.video_details.durationRaw || 'Live 🔴',
        thumbnail: info.video_details.thumbnails?.pop()?.url,
        source: 'YouTube',
      };
    } catch (ytErr) {
      console.log(`[Music] YouTube URL failed: ${ytErr.message?.substring(0, 60)}`);
      // Extract title from URL for SoundCloud search
      const videoId = query.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (videoId) {
        // Try to get title from YouTube search (search still works)
        const ytResults = await play.search(query, { limit: 1 }).catch(() => []);
        const searchTerm = ytResults[0]?.title || query;
        return await searchSoundCloud(searchTerm);
      }
    }
  }

  // ── Search: try YouTube, fallback to SoundCloud ──
  if (!isUrl) {
    // YouTube search works even when streaming doesn't
    console.log(`[Music] Searching YouTube: "${query}"`);
    const ytResults = await play.search(query, { limit: 1 }).catch(() => []);

    if (ytResults.length) {
      const ytUrl = ytResults[0].url;
      try {
        // Try YouTube stream
        const testStream = await play.stream(ytUrl);
        testStream.stream.destroy();
        return {
          title: ytResults[0].title,
          streamUrl: ytUrl,
          displayUrl: ytUrl,
          duration: ytResults[0].durationRaw || '??:??',
          thumbnail: ytResults[0].thumbnails?.[0]?.url,
          source: 'YouTube',
        };
      } catch (streamErr) {
        console.log(`[Music] YouTube stream blocked, falling back to SoundCloud`);
        // Use YouTube title to search SoundCloud
        return await searchSoundCloud(ytResults[0].title || query);
      }
    }

    // YouTube search also failed — go straight to SoundCloud
    return await searchSoundCloud(query);
  }

  throw new Error('Could not find any playable source');
}

async function searchSoundCloud(query) {
  console.log(`[Music] Searching SoundCloud: "${query}"`);
  const scResults = await play.search(query, {
    source: { soundcloud: 'tracks' },
    limit: 1,
  });

  if (!scResults.length) {
    throw new Error('No results on YouTube or SoundCloud');
  }

  return {
    title: scResults[0].name,
    streamUrl: scResults[0].url,
    displayUrl: scResults[0].url,
    duration: formatMs(scResults[0].durationInMs),
    thumbnail: scResults[0].thumbnail,
    source: 'SoundCloud',
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music in voice — لێدانی مۆسیقا لە ڤۆیس')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Song name or URL — ناوی گۆرانی یان لینک')
        .setRequired(true)
    ),

  queues,

  async execute(interaction) {
    const query = (interaction.options.getString('query') || interaction.options.getString('url') || '').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nبچوو بۆ ناو ڤۆیس چات!')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!query) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Provide a song name or URL\n\n**Example:** `/play Ahmet Kaya`')
          .setColor(colors.ERROR)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      // ── Find playable source ───────────────
      const result = await findAndStream(query);

      console.log(`[Music] Ready: "${result.title}" via ${result.source}`);

      // ── Get or create queue ────────────────
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
            embeds: [new EmbedBuilder()
              .setDescription('❌ Cannot join voice channel!')
              .setColor(colors.ERROR)],
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
                .setTitle('🎵 Now Playing')
                .setDescription(`🎶 **${queue.songs[0].title}**`)
                .setColor(colors.ACCENT)],
            }).catch(() => {});
          } else {
            console.log('■ Queue empty, leaving voice.');
            queue.connection.destroy();
            queues.delete(interaction.guild.id);
          }
        });

        player.on('error', (err) => {
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
          } catch {
            connection.destroy();
            queues.delete(interaction.guild.id);
          }
        });
      }

      // ── Add to queue ───────────────────────
      queue.songs.push(result);

      const sourceEmoji = result.source === 'YouTube' ? '📺' : '☁️';

      if (queue.songs.length === 1) {
        await playSong(queue);
        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription([
            `🎶 **${result.title}**`,
            '',
            `⏱️ \`${result.duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`,
            `${sourceEmoji} Source: **${result.source}**`,
          ].join('\n'))
          .setColor(colors.ACCENT)
          .setURL(result.displayUrl)
          .setFooter({ text: '/stop to stop • /play to add more' })
          .setTimestamp();
        if (result.thumbnail) embed.setThumbnail(result.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${result.title}**\n\n📌 Position: **#${queue.songs.length}** • ⏱️ \`${result.duration}\` • ${sourceEmoji} ${result.source}`)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (result.thumbnail) embed.setThumbnail(result.thumbnail);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] ERROR:', error.message);

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Could Not Play')
          .setDescription('No results found on YouTube or SoundCloud.\n\nتاقی بکەرەوە بە ناوێکی تر.')
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

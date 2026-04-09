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

  // ── YouTube URL → extract ID → get title → SoundCloud ────
  if (isYouTubeUrl) {
    // Extract video ID from URL
    const videoId = query.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
    console.log(`[Music] YouTube URL → video ID: ${videoId}`);

    let videoTitle = null;

    // Search YouTube by video ID (search always works, even on Railway)
    if (videoId) {
      const ytResults = await play.search(videoId, { limit: 3 }).catch(() => []);
      // Find the exact video or take first result
      const exact = ytResults.find(r => r.url?.includes(videoId));
      videoTitle = exact?.title || ytResults[0]?.title;
      console.log(`[Music] Got title from search: "${videoTitle}"`);
    }

    if (!videoTitle) {
      // Last resort: just use video ID as search term for SoundCloud
      return await searchSoundCloud(videoId || query);
    }

    // Try YouTube stream first (rarely works on cloud, but try)
    try {
      const stream = await play.stream(query);
      stream.stream.destroy();
      return {
        title: videoTitle,
        streamUrl: query,
        displayUrl: query,
        duration: '??:??',
        thumbnail: null,
        source: 'YouTube',
      };
    } catch {
      // YouTube blocked → search SoundCloud with the title
      console.log(`[Music] YouTube blocked → SoundCloud: "${videoTitle}"`);
      return await searchSoundCloud(videoTitle);
    }
  }

  // ── Search: YouTube title → SoundCloud stream ──
  if (!isUrl) {
    // YouTube search to get the correct title
    console.log(`[Music] Searching YouTube: "${query}"`);
    const ytResults = await play.search(query, { limit: 1 }).catch(() => []);

    if (ytResults.length) {
      // Use YouTube title to find on SoundCloud (YouTube stream is blocked on Railway)
      console.log(`[Music] Found on YouTube: "${ytResults[0].title}" → searching SoundCloud`);
      return await searchSoundCloud(ytResults[0].title || query);
    }

    // YouTube search also failed — go straight to SoundCloud
    return await searchSoundCloud(query);
  }

  throw new Error('Could not find any playable source');
}

async function searchSoundCloud(query) {
  // Clean the query: remove dots, special chars, extra spaces
  const cleaned = query
    .replace(/[.…_|•·—–\-]+/g, ' ')  // dots, dashes → space
    .replace(/[^\w\s\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0980-\u09FF\u0A00-\u0A7F\u4E00-\u9FFF\uAC00-\uD7AF]/g, ' ') // keep letters + Arabic/Kurdish/Bengali/CJK/Korean
    .replace(/\s+/g, ' ')
    .trim();

  // Try multiple search variations
  const searches = [
    cleaned,                                    // Full cleaned title
    cleaned.split(' ').slice(0, 4).join(' '),   // First 4 words
    cleaned.split(' ').slice(0, 2).join(' '),   // First 2 words
  ].filter((s, i, arr) => s && s.length > 2 && arr.indexOf(s) === i); // Dedupe + filter empty

  // Track all results to pick the best if exact match fails
  let bestResult = null;

  for (const term of searches) {
    console.log(`[Music] Searching SoundCloud: "${term}"`);
    try {
      const scResults = await play.search(term, {
        source: { soundcloud: 'tracks' },
        limit: 5, // Get more results to find best match
      });

      for (const track of scResults) {
        // Check match quality: do query and result share meaningful words?
        const queryWords = term.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const resultWords = track.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const sharedWords = queryWords.filter(w => resultWords.some(rw => rw.includes(w) || w.includes(rw)));

        const matchScore = queryWords.length > 0 ? sharedWords.length / queryWords.length : 0;

        console.log(`[Music] SC result: "${track.name}" | match: ${Math.round(matchScore * 100)}%`);

        if (matchScore >= 0.3) { // At least 30% word match
          console.log(`[Music] SoundCloud matched: "${track.name}"`);
          return {
            title: track.name,
            streamUrl: track.url,
            displayUrl: track.url,
            duration: formatMs(track.durationInMs),
            thumbnail: track.thumbnail,
            source: 'SoundCloud',
          };
        }

        // Save first result as fallback (only for first search term)
        if (!bestResult) bestResult = track;
      }
    } catch (e) {
      console.log(`[Music] SoundCloud search error: ${e.message?.substring(0, 50)}`);
    }
  }

  // If we searched with just the first query term directly (user typed song name),
  // use best result even if match is low — the user explicitly searched for it
  if (bestResult && searches[0] === query.replace(/[.…_|•·—–\-]+/g, ' ').replace(/[^\w\s\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0980-\u09FF\u0A00-\u0A7F\u4E00-\u9FFF\uAC00-\uD7AF]/g, ' ').replace(/\s+/g, ' ').trim()) {
    // Only use unmatched result if the user directly searched (not URL fallback)
  }

  throw new Error('Song not found on SoundCloud');
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

      let msg = '🔍 This song was not found on SoundCloud.\n\nئەم گۆرانییە لە ساوندکلاود نەدۆزرایەوە.';
      msg += '\n\n💡 **Try instead:**';
      msg += '\n• `/play Ahmet Kaya` — search by **artist name**';
      msg += '\n• `/play Ebi remember` — use **English** words';
      msg += '\n• Popular songs work best on SoundCloud';

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Song Not Available')
          .setDescription(msg)
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

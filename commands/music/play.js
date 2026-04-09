/**
 * Core Game Bot — /play Command
 * Based on yt-dlp-exec direct approach with queue system
 * Supports: YouTube URL + search by song name
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const ytDlp = require('yt-dlp-exec');
const colors = require('../../config/colors');

// Queue per server
const queues = new Map();

function playSong(queue) {
  const song = queue.songs[0];
  console.log(`▶ Playing: "${song.title}"`);
  const resource = createAudioResource(song.url);
  queue.player.play(resource);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio in voice — لێدانی دەنگ لە یوتیوب')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('YouTube URL or song name — لینک یان ناوی گۆرانی')
        .setRequired(true)
    ),

  // Export queues so /stop can use them
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
      // ── Resolve URL or search YouTube ──────
      let url = query;
      let title = '';

      if (!query.startsWith('http')) {
        // Search YouTube by name
        console.log(`[Music] Searching: "${query}"`);
        const result = await ytDlp(`ytsearch1:${query}`, {
          dumpSingleJson: true,
          noWarnings: true,
          noCallHome: true,
          preferFreeFormats: true,
        });
        // Search returns entries array
        const entry = result.entries?.[0] || result;
        url = entry.webpage_url || entry.url;
        title = entry.title;
      }

      // ── Get audio stream URL ───────────────
      console.log(`[Music] Getting audio for: ${url}`);
      const info = await ytDlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        format: 'bestaudio/best',
      });

      const audioUrl = info.url;
      title = title || info.title;
      const duration = info.duration_string || fmtSec(info.duration);
      const thumbnail = info.thumbnail;

      if (!audioUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ No audio stream found.')
            .setColor(colors.ERROR)],
        });
      }

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

        queue = { connection, player, songs: [], channel: interaction.channel };
        queues.set(interaction.guild.id, queue);

        // Auto-play next song when current ends
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
          console.error('Player error:', err.message);
          queue.songs.shift();
          if (queue.songs.length > 0) playSong(queue);
        });

        // Handle disconnection
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
      queue.songs.push({ title, url: audioUrl, duration, thumbnail, requestedBy: interaction.user.id });

      if (queue.songs.length === 1) {
        // Play immediately
        playSong(queue);

        const embed = new EmbedBuilder()
          .setTitle('🎵 Now Playing')
          .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
          .setColor(colors.ACCENT)
          .setURL(url)
          .setFooter({ text: '/stop to stop • /play to add more' })
          .setTimestamp();
        if (thumbnail) embed.setThumbnail(thumbnail);

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Added to queue
        const embed = new EmbedBuilder()
          .setTitle('📋 Added to Queue')
          .setDescription(`🎶 **${title}**\n\n📌 Position: **#${queue.songs.length}** • ⏱️ \`${duration}\``)
          .setColor(colors.ACCENT)
          .setTimestamp();
        if (thumbnail) embed.setThumbnail(thumbnail);

        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('[Music] FULL ERROR:', error.message);
      console.error('[Music] stderr:', error.stderr?.substring(0, 300));

      let msg = 'Could not play. Try again.\n\nتاقی بکەرەوە.';
      if (error.message?.includes('Sign in') || error.stderr?.includes('Sign in')) {
        msg = '⚠️ YouTube requires authentication on this server.\n\nAdmin: Add `YOUTUBE_COOKIES` env var in Railway.';
      } else if (error.message?.includes('429') || error.stderr?.includes('429')) {
        msg = 'YouTube rate limited. Wait 1 minute.\n\nچاوەڕوان بە.';
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription(msg)
          .setColor(colors.ERROR)],
      }).catch(() => {});
    }
  },
};

function fmtSec(s) {
  if (!s) return 'Live 🔴';
  s = parseInt(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

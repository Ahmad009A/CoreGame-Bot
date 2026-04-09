/**
 * Core Game Bot — /play Command
 * Play YouTube audio — works WITHOUT cookies using tv_embedded client
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior, StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const colors = require('../../config/colors');

const COOKIES_FILE = path.join(__dirname, '..', '..', 'cookies.txt');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio in voice — لێدانی دەنگ لە یوتیوب')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('YouTube video URL — لینکی ڤیدیۆی یوتیوب')
        .setRequired(true)
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url').trim();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Join a voice channel first!\n\nپێویستە سەرەتا بچیتە ناو ڤۆیس!')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    if (!url.includes('youtu')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Invalid YouTube URL!\n\n**Example:** `https://www.youtube.com/watch?v=...`')
          .setColor(colors.ERROR)],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // ── Try multiple strategies to get audio URL ──
      let info = null;
      let lastErr = '';

      // Strategy 1: No cookies, use tv_embedded client (works for most videos)
      const strategies = [
        {
          name: 'tv_embedded',
          opts: {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            format: 'bestaudio/best',
            extractorArgs: 'youtube:player_client=tv_embedded',
          }
        },
        {
          name: 'web_embedded',
          opts: {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            format: 'bestaudio/best',
            extractorArgs: 'youtube:player_client=web_embedded',
          }
        },
        {
          name: 'default',
          opts: {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            format: 'bestaudio/best',
          }
        },
      ];

      // If cookies file exists, add it to all strategies
      const hasCookies = fs.existsSync(COOKIES_FILE);

      for (const strat of strategies) {
        try {
          const opts = { ...strat.opts };
          if (hasCookies) opts.cookies = COOKIES_FILE;

          info = await youtubedl(url, opts);
          if (info && (info.url || info.requested_downloads?.[0]?.url || info.formats?.length)) {
            console.log(`[Music] Strategy "${strat.name}" worked for: ${info.title}`);
            break;
          }
        } catch (e) {
          lastErr = e.stderr || e.message || '';
          console.log(`[Music] Strategy "${strat.name}" failed, trying next...`);
          info = null;
        }
      }

      if (!info) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Cannot Play')
            .setDescription('YouTube blocked this video.\nTry a different video.\n\nیوتیوب ئەم ڤیدیۆیەی بلۆک کرد.')
            .setColor(colors.ERROR)],
        });
      }

      const title = info.title || 'YouTube Audio';
      const thumbnail = info.thumbnail || null;
      const duration = info.duration_string || fmtSec(info.duration);

      // Find audio URL from multiple possible locations
      const audioUrl = info.url
        || info.requested_downloads?.[0]?.url
        || info.formats?.filter(f => f.acodec && f.acodec !== 'none').pop()?.url;

      if (!audioUrl) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ No audio stream found. Try another video.')
            .setColor(colors.ERROR)],
        });
      }

      // ── Join VC ────────────────────────────
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        connection.destroy();
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setDescription('❌ Cannot join voice channel. Check bot permissions!')
            .setColor(colors.ERROR)],
        });
      }

      // ── ffmpeg: stream URL → PCM audio ────
      const ff = spawn(ffmpegPath, [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', audioUrl,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-loglevel', 'error',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      ff.stderr.on('data', d => console.log('ffmpeg:', d.toString().trim()));

      const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });

      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Playing, () => console.log(`▶ Playing: ${title}`));
      player.on(AudioPlayerStatus.Idle, () => { try { ff.kill(); } catch {} });
      player.on('error', e => { console.error('Player:', e.message); try { ff.kill(); } catch {} });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch { connection.destroy(); try { ff.kill(); } catch {} }
      });

      // ── Reply ──────────────────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`🎶 **${title}**\n\n⏱️ \`${duration}\` • 🔊 \`${voiceChannel.name}\` • 🎧 <@${interaction.user.id}>`)
        .setColor(colors.ACCENT).setURL(url)
        .setFooter({ text: '/stop to stop • Core Game Bot' }).setTimestamp();
      if (thumbnail) embed.setThumbnail(thumbnail);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Play error:', error.stderr || error.message);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Playback Error')
          .setDescription('Could not play. Try a different video.\n\nنەتوانرا لێبدرێت. ڤیدیۆیەکی تر تاقی بکەرەوە.')
          .setColor(colors.ERROR)],
      });
    }
  },
};

function fmtSec(s) {
  if (!s) return 'Live 🔴';
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

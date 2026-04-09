/**
 * Core Game Bot — /rank Command
 * Show your level, XP, and leaderboard
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getLeaderboard, formatVoiceTime, LEVEL_UP_XP } = require('../../models/UserLevel');
const colors = require('../../config/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your rank or leaderboard — ئاستی تۆ یان لیستی باشترینان')
    .addSubcommand(sub =>
      sub.setName('me')
        .setDescription('Show your own rank — ئاستی خۆت')
    )
    .addSubcommand(sub =>
      sub.setName('top')
        .setDescription('Show the leaderboard — لیستی باشترینان')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'me') {
      const user = getUser(interaction.guild.id, interaction.user.id);
      const xpNeeded = LEVEL_UP_XP - (user.xp % LEVEL_UP_XP);
      const progress = Math.round(((user.xp % LEVEL_UP_XP) / LEVEL_UP_XP) * 100);
      const bar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

      let voiceMs = user.totalVoiceMs;
      if (user.voiceJoinedAt) voiceMs += Date.now() - user.voiceJoinedAt;

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${interaction.user.displayName}'s Rank`)
        .setDescription([
          `**Level:** ${user.level}`,
          `**XP:** ${user.xp} / ${(user.level + 1) * LEVEL_UP_XP}`,
          `**Progress:** [${bar}] ${progress}%`,
          '',
          `💬 **Messages:** ${user.messageCount}`,
          `🔊 **Voice Time:** ${formatVoiceTime(voiceMs)}`,
          '',
          user.level >= 10 ? '👑 **Best Member** ✅' : `📈 **${10 - user.level}** levels to Best Member`,
        ].join('\n'))
        .setColor(user.level >= 10 ? colors.GOLD : colors.ACCENT)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    else if (sub === 'top') {
      const top = getLeaderboard(interaction.guild.id, 10);

      if (top.length === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setDescription('📭 No activity yet. Start chatting and join voice!')
            .setColor(colors.INFO)],
        });
      }

      const lines = top.map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `${medal} <@${u.userId}> — Level **${u.level}** • ${u.xp} XP • 🔊 ${formatVoiceTime(u.totalVoiceMs)}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 Activity Leaderboard')
        .setDescription(lines.join('\n'))
        .setColor(colors.GOLD)
        .setFooter({ text: '3h voice = 1 level • Chat to earn XP' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};

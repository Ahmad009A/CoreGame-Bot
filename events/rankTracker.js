/**
 * Core Game Bot — Rank Activity Tracker
 * Tracks messages and voice time for leveling
 * Level-up messages in Kurdish Sorani + English
 */

const { Events, EmbedBuilder } = require('discord.js');
const { addMessageXP, joinVoice, leaveVoice, BEST_MEMBER_ROLE_ID } = require('../models/UserLevel');
const colors = require('../config/colors');

// Cooldown: 1 message XP per 30 seconds per user
const messageCooldowns = new Map();

module.exports = {
  name: 'rankTracker',

  async register(client) {
    // ── Message XP ─────────────────────────
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || !message.guild) return;

      // Cooldown check (prevent spam XP)
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      if (messageCooldowns.has(key) && now - messageCooldowns.get(key) < 30000) return;
      messageCooldowns.set(key, now);

      const levelUp = addMessageXP(message.guild.id, message.author.id);

      if (levelUp) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 Level Up! — ئاستت بەرزبووەوە!')
          .setDescription([
            `🏆 <@${message.author.id}> پیرۆزبێت!`,
            '',
            `**Congratulations!** You reached **Level ${levelUp.newLevel}**! 🌟`,
            `**پیرۆزبێت!** گەیشتیت بە **ئاستی ${levelUp.newLevel}**! 🌟`,
            '',
            `💬 بەردەوام بە لە چات و ڤۆیس بۆ ئەوەی ئاستت بەرزتر ببێتەوە!`,
            `Keep chatting and joining voice to level up more!`,
          ].join('\n'))
          .setColor(colors.GOLD)
          .setThumbnail(message.author.displayAvatarURL({ size: 128 }))
          .setTimestamp();

        await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed] }).catch(() => {});

        // Award Best Member role at level 10
        if (levelUp.reachedBestMember) {
          try {
            const member = await message.guild.members.fetch(message.author.id);
            const role = message.guild.roles.cache.get(BEST_MEMBER_ROLE_ID);
            if (role && !member.roles.cache.has(BEST_MEMBER_ROLE_ID)) {
              await member.roles.add(role);
              await message.channel.send({
                content: `<@${message.author.id}>`,
                embeds: [new EmbedBuilder()
                  .setTitle('👑 Best Member! — باشترین ئەندام!')
                  .setDescription([
                    `🎊 <@${message.author.id}>`,
                    '',
                    `**پیرۆزبێت!** تۆ گەیشتیت بە **ئاستی ١٠** و رۆڵی **${role.name}** وەرگرت! 🏅`,
                    `**Congratulations!** You reached **Level 10** and earned the **${role.name}** role! 🏅`,
                    '',
                    `تۆ یەکێکیت لە چالاکترین ئەندامانی سێرڤەرەکە! 💪`,
                    `You are one of the most active members! 💪`,
                  ].join('\n'))
                  .setColor(0xFFD700)
                  .setThumbnail(message.author.displayAvatarURL({ size: 256 }))],
              });
            }
          } catch (e) {
            console.error('[Rank] Role error:', e.message);
          }
        }
      }
    });

    // ── Voice State Tracking ───────────────
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      const userId = newState.member?.id || oldState.member?.id;
      const guildId = newState.guild?.id || oldState.guild?.id;
      if (!userId || !guildId) return;

      // Skip bots
      if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

      // Joined voice
      if (!oldState.channelId && newState.channelId) {
        joinVoice(guildId, userId);
      }

      // Left voice
      if (oldState.channelId && !newState.channelId) {
        const levelUp = leaveVoice(guildId, userId);

        if (levelUp) {
          try {
            const channel = newState.guild.channels.cache.find(c => c.id === '1491193021734326293') ||
                            newState.guild.channels.cache.find(c => c.name === 'bot-use');
            if (channel) {
              const member = await newState.guild.members.fetch(userId).catch(() => null);
              const avatar = member?.user?.displayAvatarURL({ size: 128 }) || null;

              await channel.send({
                content: `<@${userId}>`,
                embeds: [new EmbedBuilder()
                  .setTitle('🎉 Level Up! — ئاستت بەرزبووەوە!')
                  .setDescription([
                    `🏆 <@${userId}> پیرۆزبێت!`,
                    '',
                    `**Congratulations!** Reached **Level ${levelUp.newLevel}** from voice time! 🎙️`,
                    `**پیرۆزبێت!** گەیشتیت بە **ئاستی ${levelUp.newLevel}** لە ڤۆیس! 🎙️`,
                    '',
                    `🔊 بەردەوام بە لە ڤۆیس بۆ ئەوەی ئاستت بەرزتر ببێتەوە!`,
                  ].join('\n'))
                  .setColor(colors.GOLD)
                  .setThumbnail(avatar)
                  .setTimestamp()],
              });

              if (levelUp.reachedBestMember) {
                const role = newState.guild.roles.cache.get(BEST_MEMBER_ROLE_ID);
                if (role && member && !member.roles.cache.has(BEST_MEMBER_ROLE_ID)) {
                  await member.roles.add(role);
                  await channel.send({
                    content: `<@${userId}>`,
                    embeds: [new EmbedBuilder()
                      .setTitle('👑 Best Member! — باشترین ئەندام!')
                      .setDescription([
                        `🎊 <@${userId}>`,
                        '',
                        `**پیرۆزبێت!** رۆڵی **${role.name}** وەرگرت! 🏅`,
                        `**Congratulations!** Earned the **${role.name}** role! 🏅`,
                      ].join('\n'))
                      .setColor(0xFFD700)],
                  });
                }
              }
            }
          } catch (e) {
            console.error('[Rank] Voice level-up error:', e.message);
          }
        }
      }
    });

    console.log('[Rank] Activity tracker loaded ✅');
  },
};

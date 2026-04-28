/**
 * Core Game Bot — Rank Activity Tracker
 * Tracks messages and voice time for leveling
 * Level-up messages in Kurdish Sorani + English
 * 
 * Reads voiceHoursPerLevel, xpPerMessage, bestMemberRoleId from GuildSettings
 * Dedup guard via lastLevelNotified in UserLevel model
 */

const { Events, EmbedBuilder } = require('discord.js');
const {
  addMessageXP, joinVoice, leaveVoice,
  DEFAULT_BEST_MEMBER_ROLE_ID,
} = require('../models/UserLevel');
const GuildSettings = require('../models/GuildSettings');
const colors = require('../config/colors');

// Cooldown: 1 message XP per 30 seconds per user
const messageCooldowns = new Map();

module.exports = {
  name: 'rankTracker',

  async register(client) {
    // ── Message XP ─────────────────────────
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || !message.guild) return;

      // Cooldown check
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      if (messageCooldowns.has(key) && now - messageCooldowns.get(key) < 30000) return;
      messageCooldowns.set(key, now);

      // Load guild leveling settings
      let settings;
      try { settings = await GuildSettings.getOrCreate(message.guild.id); } catch {}
      const leveling = settings?.leveling || {};
      if (settings?.leveling?.enabled === false) return; // leveling disabled

      const xpPerMessage = leveling.xpPerMessage || 5;
      const bestMemberLevel = leveling.bestMemberLevel || 10;
      const bestMemberRoleId = leveling.bestMemberRoleId || DEFAULT_BEST_MEMBER_ROLE_ID;

      const levelUp = addMessageXP(message.guild.id, message.author.id, xpPerMessage, bestMemberLevel);

      if (levelUp) {
        // Determine target channel for level-up message
        let targetChannel = message.channel;
        if (leveling.levelUpChannelId) {
          const ch = message.guild.channels.cache.get(leveling.levelUpChannelId);
          if (ch) targetChannel = ch;
        }

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

        await targetChannel.send({ content: `<@${message.author.id}>`, embeds: [embed] }).catch(() => {});

        // Award Best Member role
        if (levelUp.reachedBestMember) {
          try {
            const member = await message.guild.members.fetch(message.author.id);
            const role = message.guild.roles.cache.get(bestMemberRoleId);
            if (role && !member.roles.cache.has(bestMemberRoleId)) {
              await member.roles.add(role);
              await targetChannel.send({
                content: `<@${message.author.id}>`,
                embeds: [new EmbedBuilder()
                  .setTitle('👑 Best Member! — باشترین ئەندام!')
                  .setDescription([
                    `🎊 <@${message.author.id}>`,
                    '',
                    `**پیرۆزبێت!** تۆ گەیشتیت بە **ئاستی ${bestMemberLevel}** و رۆڵی **${role.name}** وەرگرت! 🏅`,
                    `**Congratulations!** You reached **Level ${bestMemberLevel}** and earned the **${role.name}** role! 🏅`,
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
      if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

      // Joined voice
      if (!oldState.channelId && newState.channelId) {
        joinVoice(guildId, userId);
      }

      // Left voice (not just switching channels)
      if (oldState.channelId && !newState.channelId) {
        // Load guild leveling settings
        let settings;
        try { settings = await GuildSettings.getOrCreate(guildId); } catch {}
        const leveling = settings?.leveling || {};
        if (settings?.leveling?.enabled === false) return;

        const voiceHours = leveling.voiceHoursPerLevel || 2;
        const bestMemberLevel = leveling.bestMemberLevel || 10;
        const bestMemberRoleId = leveling.bestMemberRoleId || DEFAULT_BEST_MEMBER_ROLE_ID;

        const levelUp = leaveVoice(guildId, userId, voiceHours, bestMemberLevel);

        if (levelUp) {
          try {
            // Find level-up channel
            let channel = null;
            if (leveling.levelUpChannelId) {
              channel = newState.guild.channels.cache.get(leveling.levelUpChannelId);
            }
            if (!channel) {
              channel = newState.guild.channels.cache.find(c => c.name === 'bot-use');
            }
            if (!channel) return;

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
              const role = newState.guild.roles.cache.get(bestMemberRoleId);
              if (role && member && !member.roles.cache.has(bestMemberRoleId)) {
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
          } catch (e) {
            console.error('[Rank] Voice level-up error:', e.message);
          }
        }
      }

      // Switched channels (leave old + join new — not a full leave)
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // Don't trigger leaveVoice — user is still in voice
        // Just update the join timestamp (already set from Joined handler above)
      }
    });

    console.log('[Rank] Activity tracker loaded ✅');
  },
};

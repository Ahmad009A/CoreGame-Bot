/**
 * Core Game Bot — Rank Activity Tracker
 * Tracks messages and voice time for leveling
 */

const { Events, EmbedBuilder } = require('discord.js');
const { addMessageXP, joinVoice, leaveVoice, BEST_MEMBER_ROLE_ID } = require('../models/UserLevel');
const colors = require('../config/colors');

module.exports = {
  name: 'rankTracker',

  async register(client) {
    // ── Message XP ─────────────────────────
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || !message.guild) return;

      const levelUp = addMessageXP(message.guild.id, message.author.id);

      if (levelUp) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 Level Up!')
          .setDescription(`<@${message.author.id}> reached **Level ${levelUp.newLevel}**! 🏆`)
          .setColor(colors.GOLD)
          .setTimestamp();

        await message.channel.send({ embeds: [embed] }).catch(() => {});

        // Award Best Member role at level 10
        if (levelUp.reachedBestMember) {
          try {
            const member = await message.guild.members.fetch(message.author.id);
            const role = message.guild.roles.cache.get(BEST_MEMBER_ROLE_ID);
            if (role && !member.roles.cache.has(BEST_MEMBER_ROLE_ID)) {
              await member.roles.add(role);
              await message.channel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('👑 Best Member Achieved!')
                  .setDescription(`<@${message.author.id}> reached **Level 10** and earned the **${role.name}** role! 🌟`)
                  .setColor(colors.GOLD)],
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

      // Joined voice
      if (!oldState.channelId && newState.channelId) {
        joinVoice(guildId, userId);
      }

      // Left voice
      if (oldState.channelId && !newState.channelId) {
        const levelUp = leaveVoice(guildId, userId);

        if (levelUp) {
          try {
            const channel = newState.guild.channels.cache.find(c => c.name === 'bot-use' || c.id === '1491193021734326293');
            if (channel) {
              await channel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('🎉 Level Up!')
                  .setDescription(`<@${userId}> reached **Level ${levelUp.newLevel}** from voice time! 🏆`)
                  .setColor(colors.GOLD)],
              });

              if (levelUp.reachedBestMember) {
                const member = await newState.guild.members.fetch(userId);
                const role = newState.guild.roles.cache.get(BEST_MEMBER_ROLE_ID);
                if (role && !member.roles.cache.has(BEST_MEMBER_ROLE_ID)) {
                  await member.roles.add(role);
                  await channel.send({
                    embeds: [new EmbedBuilder()
                      .setTitle('👑 Best Member Achieved!')
                      .setDescription(`<@${userId}> earned the **${role.name}** role! 🌟`)
                      .setColor(colors.GOLD)],
                  });
                }
              }
            }
          } catch (e) {
            console.error('[Rank] Voice level-up error:', e.message);
          }
        }
      }

      // Moved channels (still in voice)
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // Continue tracking — no action needed
      }
    });

    console.log('[Rank] Activity tracker loaded ✅');
  },
};

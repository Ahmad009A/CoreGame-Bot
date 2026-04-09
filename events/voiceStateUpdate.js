/**
 * Core Game Bot — VIP Voice Room System (voiceStateUpdate)
 * Auto-creates private voice channels when users join the VIP trigger channel
 * Auto-deletes them when empty
 */

const { ChannelType, PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger');
const emojis = require('../config/emojis');
const GuildSettings = require('../models/GuildSettings');

module.exports = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(oldState, newState, client) {
    try {
      // ── User joined a voice channel ────────
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        await handleJoin(newState, client);
      }

      // ── User left a voice channel ──────────
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await handleLeave(oldState, client);
      }
    } catch (error) {
      logger.error(`VIP Voice error: ${error.message}`);
    }
  },
};

/**
 * Handle user joining a voice channel
 */
async function handleJoin(state, client) {
  const settings = await GuildSettings.getOrCreate(state.guild.id);
  if (!settings.vip.enabled) return;

  // Check if it's the VIP trigger channel
  const triggerChannelName = process.env.VIP_TRIGGER_CHANNEL_NAME || 'VIP Room';
  const triggerChannelId = settings.vip.triggerChannelId;

  const isVipTrigger =
    (triggerChannelId && state.channelId === triggerChannelId) ||
    (state.channel && state.channel.name === triggerChannelName);

  if (!isVipTrigger) return;

  const member = state.member;
  const guild = state.guild;

  // ── Create private voice channel ─────────
  const parentCategory = state.channel.parent; // Same category as trigger channel

  const vipChannel = await guild.channels.create({
    name: `${emojis.VIP} ${member.displayName}'s Room`,
    type: ChannelType.GuildVoice,
    parent: parentCategory?.id || null,
    userLimit: 5,
    permissionOverwrites: [
      {
        // Default: deny connect for @everyone
        id: guild.id,
        deny: [PermissionsBitField.Flags.Connect],
      },
      {
        // Owner: full control
        id: member.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Speak,
        ],
      },
      {
        // Bot: needs manage + connect
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ViewChannel,
        ],
      },
    ],
  });

  // ── Move user to their new channel ───────
  await member.voice.setChannel(vipChannel);

  // Track the channel so we can auto-delete it
  client.vipChannels.set(vipChannel.id, {
    ownerId: member.id,
    guildId: guild.id,
  });

  logger.info(`VIP room created for ${member.user.tag}: ${vipChannel.name}`);
}

/**
 * Handle user leaving a voice channel — auto-delete if VIP and empty
 */
async function handleLeave(state, client) {
  const channelId = state.channelId;
  const vipData = client.vipChannels.get(channelId);

  if (!vipData) return; // Not a VIP channel we track

  const channel = state.guild.channels.cache.get(channelId);
  if (!channel) {
    client.vipChannels.delete(channelId);
    return;
  }

  // Check if channel is empty
  if (channel.members.size === 0) {
    try {
      await channel.delete('VIP room empty — auto cleanup');
      client.vipChannels.delete(channelId);
      logger.info(`VIP room deleted (empty): ${channel.name}`);
    } catch (err) {
      logger.error(`Failed to delete VIP room: ${err.message}`);
    }
  }
}

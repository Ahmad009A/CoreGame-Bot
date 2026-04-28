/**
 * Core Game Bot — Guild Settings Model
 * Stores per-server configuration for all bot systems
 * Includes in-memory fallback when MongoDB is not connected
 */

const mongoose = require('mongoose');

const guildSettingsSchema = new mongoose.Schema({
  // ── Guild Identifier ─────────────────────────
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // ── Welcome System ───────────────────────────
  welcome: {
    enabled: { type: Boolean, default: true },
    channelId: { type: String, default: null },
    message: {
      type: String,
      default: 'بەخێربێیت بۆ سێرڤەری {server}! 🎮\nWelcome {user} to **{server}**!',
    },
    backgroundUrl: { type: String, default: null },
  },

  // ── Ticket System ────────────────────────────
  ticket: {
    enabled: { type: Boolean, default: true },
    categoryId: { type: String, default: null },
    logChannelId: { type: String, default: '1491193267902222418' }, // ← default log channel
    nextNumber: { type: Number, default: 1 },
    categories: {
      type: [String],
      default: ['📋 General', '🛠️ Technical', '👑 VIP', '📢 Report'],
    },
  },

  // ── Leveling System ──────────────────────────
  leveling: {
    enabled: { type: Boolean, default: true },
    voiceHoursPerLevel: { type: Number, default: 2 },  // 2 hours voice = 1 level
    xpPerMessage: { type: Number, default: 5 },
    bestMemberRoleId: { type: String, default: '1491916346219565096' },
    bestMemberLevel: { type: Number, default: 10 },
    levelUpChannelId: { type: String, default: null },  // null = same channel
  },

  // ── VIP Room System ──────────────────────────
  vip: {
    enabled: { type: Boolean, default: true },
    triggerChannelId: { type: String, default: null },
  },

  // ── Gift Spinner ─────────────────────────────
  spin: {
    enabled: { type: Boolean, default: true },
    cooldownHours: { type: Number, default: 24 },
    rewardRoleId: { type: String, default: null },
  },
}, {
  timestamps: true,
});

/**
 * Get or create settings for a guild
 */
guildSettingsSchema.statics.getOrCreate = async function (guildId) {
  if (mongoose.connection.readyState !== 1) {
    return getMemorySettings(guildId);
  }

  try {
    let settings = await this.findOne({ guildId });
    if (!settings) {
      settings = await this.create({ guildId });
    }
    return settings;
  } catch (error) {
    return getMemorySettings(guildId);
  }
};

// ── In-Memory Fallback Store ─────────────────────
const memoryStore = new Map();

function getMemorySettings(guildId) {
  if (!memoryStore.has(guildId)) {
    memoryStore.set(guildId, {
      guildId,
      welcome: {
        enabled: true,
        channelId: process.env.WELCOME_CHANNEL_ID || null,
        message: 'بەخێربێیت بۆ سێرڤەری {server}! 🎮\nWelcome {user} to **{server}**!',
        backgroundUrl: null,
      },
      ticket: {
        enabled: true,
        categoryId: null,
        logChannelId: '1491193267902222418',
        nextNumber: 1,
        categories: ['📋 General', '🛠️ Technical', '👑 VIP', '📢 Report'],
      },
      leveling: {
        enabled: true,
        voiceHoursPerLevel: 2,
        xpPerMessage: 5,
        bestMemberRoleId: '1491916346219565096',
        bestMemberLevel: 10,
        levelUpChannelId: null,
      },
      vip: {
        enabled: true,
        triggerChannelId: null,
      },
      spin: {
        enabled: true,
        cooldownHours: 24,
        rewardRoleId: null,
      },
      // Mock mongoose methods
      save: async function () { return this; },
      toObject: function () {
        const obj = { ...this };
        delete obj.save;
        delete obj.toObject;
        return obj;
      },
    });
  }
  return memoryStore.get(guildId);
}

module.exports = mongoose.model('GuildSettings', guildSettingsSchema);

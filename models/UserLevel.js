/**
 * Core Game Bot — User Level Model
 * Tracks XP from chatting and voice time
 * Level 10 = Best Member role (configurable)
 * 
 * Dedup: lastLevelNotified prevents duplicate level-up messages
 * Dynamic: voiceHoursPerLevel is passed in from GuildSettings
 */

const levels = new Map(); // guildId:userId → user data

const DEFAULT_XP_PER_MESSAGE = 5;
const DEFAULT_VOICE_HOURS_PER_LEVEL = 2;  // 2 hours = 1 level (user requested)
const DEFAULT_BEST_MEMBER_ROLE_ID = '1491916346219565096';
const DEFAULT_BEST_MEMBER_LEVEL = 10;
const LEVEL_UP_XP = 1000; // XP needed per level

function getKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getUser(guildId, userId) {
  const key = getKey(guildId, userId);
  if (!levels.has(key)) {
    levels.set(key, {
      guildId, userId,
      xp: 0, level: 0,
      totalVoiceMs: 0,
      voiceJoinedAt: null,
      messageCount: 0,
      lastLevelNotified: 0, // ← dedup: tracks last level we sent a message for
    });
  }
  return levels.get(key);
}

/**
 * Add message XP — returns level-up info or null
 * @param {string} guildId
 * @param {string} userId
 * @param {number} [xpPerMessage] - from guild settings
 * @param {number} [bestMemberLevel] - from guild settings
 */
function addMessageXP(guildId, userId, xpPerMessage, bestMemberLevel) {
  const user = getUser(guildId, userId);
  user.xp += (xpPerMessage || DEFAULT_XP_PER_MESSAGE);
  user.messageCount++;
  return checkLevelUp(user, bestMemberLevel);
}

/**
 * User joined voice
 */
function joinVoice(guildId, userId) {
  const user = getUser(guildId, userId);
  user.voiceJoinedAt = Date.now();
}

/**
 * User left voice — calculate XP earned from time spent
 * @param {string} guildId
 * @param {string} userId
 * @param {number} [voiceHoursPerLevel] - from guild settings (default 2)
 * @param {number} [bestMemberLevel] - from guild settings
 */
function leaveVoice(guildId, userId, voiceHoursPerLevel, bestMemberLevel) {
  const user = getUser(guildId, userId);
  if (!user.voiceJoinedAt) return null;

  const elapsed = Date.now() - user.voiceJoinedAt;
  user.totalVoiceMs += elapsed;

  // Calculate XP based on configurable hours-per-level
  const hours = voiceHoursPerLevel || DEFAULT_VOICE_HOURS_PER_LEVEL;
  const hoursMs = hours * 60 * 60 * 1000;
  const xpEarned = Math.floor((elapsed / hoursMs) * LEVEL_UP_XP);
  user.xp += xpEarned;
  user.voiceJoinedAt = null;

  return checkLevelUp(user, bestMemberLevel);
}

/**
 * Check if user leveled up — with dedup guard
 * Only returns level-up info if this level hasn't been notified yet
 */
function checkLevelUp(user, bestMemberLevel) {
  const newLevel = Math.floor(user.xp / LEVEL_UP_XP);

  if (newLevel > user.level && newLevel > user.lastLevelNotified) {
    const oldLevel = user.level;
    user.level = newLevel;
    user.lastLevelNotified = newLevel; // ← prevents duplicate message
    const bmLevel = bestMemberLevel || DEFAULT_BEST_MEMBER_LEVEL;
    return { oldLevel, newLevel, reachedBestMember: newLevel >= bmLevel };
  }

  // Still update level even if we don't notify (catches edge cases)
  if (newLevel > user.level) {
    user.level = newLevel;
  }

  return null;
}

function getLeaderboard(guildId, limit = 10) {
  const users = [];
  for (const [, data] of levels) {
    if (data.guildId === guildId) {
      let totalMs = data.totalVoiceMs;
      if (data.voiceJoinedAt) totalMs += Date.now() - data.voiceJoinedAt;
      users.push({ ...data, totalVoiceMs: totalMs });
    }
  }
  return users.sort((a, b) => b.xp - a.xp).slice(0, limit);
}

function formatVoiceTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

module.exports = {
  getUser, addMessageXP, joinVoice, leaveVoice,
  getLeaderboard, formatVoiceTime,
  DEFAULT_BEST_MEMBER_ROLE_ID, LEVEL_UP_XP,
  DEFAULT_VOICE_HOURS_PER_LEVEL, DEFAULT_XP_PER_MESSAGE,
};

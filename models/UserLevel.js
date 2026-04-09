/**
 * Core Game Bot — User Level Model
 * Tracks XP from chatting and voice time
 * Level 10 = Best Member role
 */

const levels = new Map(); // guildId:userId → { xp, level, voiceJoinedAt, totalVoiceMs }

const XP_PER_MESSAGE = 5;
const XP_PER_3H_VOICE = 1000; // 3 hours voice = 1 level worth of XP
const BEST_MEMBER_ROLE_ID = '1491916346219565096';
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
    });
  }
  return levels.get(key);
}

function addMessageXP(guildId, userId) {
  const user = getUser(guildId, userId);
  user.xp += XP_PER_MESSAGE;
  user.messageCount++;
  return checkLevelUp(user);
}

function joinVoice(guildId, userId) {
  const user = getUser(guildId, userId);
  user.voiceJoinedAt = Date.now();
}

function leaveVoice(guildId, userId) {
  const user = getUser(guildId, userId);
  if (user.voiceJoinedAt) {
    const elapsed = Date.now() - user.voiceJoinedAt;
    user.totalVoiceMs += elapsed;

    // 3 hours = 1 level (1000 XP)
    const threeHoursMs = 3 * 60 * 60 * 1000;
    const xpEarned = Math.floor((elapsed / threeHoursMs) * XP_PER_3H_VOICE);
    user.xp += xpEarned;
    user.voiceJoinedAt = null;
    return checkLevelUp(user);
  }
  return null;
}

function checkLevelUp(user) {
  const newLevel = Math.floor(user.xp / LEVEL_UP_XP);
  if (newLevel > user.level) {
    const oldLevel = user.level;
    user.level = newLevel;
    return { oldLevel, newLevel, reachedBestMember: newLevel >= 10 };
  }
  return null;
}

function getLeaderboard(guildId, limit = 10) {
  const users = [];
  for (const [key, data] of levels) {
    if (data.guildId === guildId) {
      // Calculate current voice time if still in voice
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
  BEST_MEMBER_ROLE_ID, LEVEL_UP_XP,
};

/**
 * db.js — lightweight in-memory store
 * Drop-in replacement: swap internals for MongoDB/Postgres without changing the API.
 */
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ── Storage ──────────────────────────────────────────────────────────────────
const users   = new Map(); // id → user
const tokens  = new Map(); // token → userId
const scores  = [];        // { id, playerId, username, score, mode, ts }

// ── Users / Auth ─────────────────────────────────────────────────────────────
function registerUser({ username, password }) {
  // Check username taken
  for (const u of users.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) return { ok: false, error: 'Username taken' };
  }
  const id = uuidv4();
  const hash = hashPassword(password);
  const user = { id, username, passwordHash: hash, createdAt: Date.now() };
  users.set(id, user);
  const token = issueToken(id);
  return { ok: true, token, player: sanitize(user) };
}

function loginUser({ username, password }) {
  for (const u of users.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) {
      if (!checkPassword(password, u.passwordHash)) return { ok: false, error: 'Wrong password' };
      // Revoke old tokens for this user
      for (const [t, uid] of tokens.entries()) { if (uid === u.id) tokens.delete(t); }
      const token = issueToken(u.id);
      return { ok: true, token, player: sanitize(u) };
    }
  }
  return { ok: false, error: 'User not found' };
}

function verifyToken(token) {
  if (!token) return null;
  const userId = tokens.get(token);
  if (!userId) return null;
  const user = users.get(userId);
  return user ? sanitize(user) : null;
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, userId);
  return token;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return check === hash;
}

function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// ── Scores / Leaderboard ─────────────────────────────────────────────────────
function saveScore({ playerId, username, score, mode = 'race' }) {
  scores.push({ id: uuidv4(), playerId, username, score: Number(score), mode, ts: Date.now() });
  // Keep max 10k entries
  if (scores.length > 10000) scores.splice(0, scores.length - 10000);
}

function getLeaderboard({ mode = 'all', limit = 50 } = {}) {
  const filtered = mode === 'all' ? scores : scores.filter(s => s.mode === mode);
  // Best score per player
  const bestMap = new Map();
  for (const s of filtered) {
    if (!bestMap.has(s.playerId) || bestMap.get(s.playerId).score < s.score) {
      bestMap.set(s.playerId, s);
    }
  }
  return [...bestMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s, i) => ({ rank: i + 1, ...s }));
}

function getPlayerScores(playerId, { limit = 20 } = {}) {
  return scores
    .filter(s => s.playerId === playerId)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

module.exports = { registerUser, loginUser, verifyToken, saveScore, getLeaderboard, getPlayerScores };

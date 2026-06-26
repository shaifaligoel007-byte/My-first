/**
 * gameSync.js — authoritative game state per room
 * Handles: player positions, coin events, lives (coop), PvP interactions, and results
 */

const roomManager = require('./roomManager');

// roomId → GameState
const gameStates = new Map();

// ── Init ──────────────────────────────────────────────────────────────────────
function initState(roomId, room) {
  const state = {
    roomId,
    mode: room.mode,
    tick: 0,
    players: {},
    coins: {},       // coinId → { x, y, value, collected }
    events: [],      // recent events ring buffer
    startTime: Date.now()
  };
  for (const p of room.players) {
    state.players[p.id] = {
      id: p.id,
      username: p.username,
      character: p.character,
      x: 100,
      y: 300,
      vx: 0,
      vy: 0,
      facing: 'right',
      state: 'idle',    // idle | running | jumping | dead
      lives: 3,
      coins: 0,
      score: 0,
      finished: false,
      finishTime: null
    };
  }
  gameStates.set(roomId, state);
  return state;
}

// ── Player update (position + state) ─────────────────────────────────────────
function processPlayerUpdate(roomId, playerId, data) {
  const gs = getOrInit(roomId);
  if (!gs || !gs.players[playerId]) return null;

  const player = gs.players[playerId];

  // Only allow fields we trust from client
  const allowed = ['x', 'y', 'vx', 'vy', 'facing', 'state', 'animFrame'];
  for (const key of allowed) {
    if (data[key] !== undefined) player[key] = data[key];
  }
  gs.tick++;

  return {
    playerId,
    tick: gs.tick,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    facing: player.facing,
    state: player.state,
    animFrame: player.animFrame
  };
}

// ── Game events ───────────────────────────────────────────────────────────────
function processEvent(roomId, playerId, event) {
  const gs = getOrInit(roomId);
  if (!gs || !gs.players[playerId]) return null;

  const player = gs.players[playerId];
  const ts = Date.now();
  let broadcast = null;

  switch (event.type) {

    case 'coin:collect': {
      const { coinId, value = 1 } = event;
      if (gs.coins[coinId]?.collected) return null; // Already collected
      if (gs.coins[coinId]) gs.coins[coinId].collected = true;
      player.coins += 1;
      player.score += value * 10;
      broadcast = { type: 'coin:collect', playerId, coinId, value, newScore: player.score };
      break;
    }

    case 'coin:steal': {
      // PvP mode: steal coins from another player
      if (gs.mode !== 'pvp') return null;
      const { targetId } = event;
      const target = gs.players[targetId];
      if (!target || target.coins <= 0) return null;
      const stolen = Math.max(1, Math.floor(target.coins * 0.1));
      target.coins -= stolen;
      target.score -= stolen * 10;
      player.coins += stolen;
      player.score += stolen * 10;
      broadcast = { type: 'coin:steal', thiefId: playerId, targetId, stolen };
      break;
    }

    case 'player:die': {
      if (gs.mode === 'coop') {
        player.lives -= 1;
        broadcast = { type: 'player:die', playerId, livesRemaining: player.lives };
        // Check if all lives gone in coop
        const totalLives = Object.values(gs.players).reduce((s, p) => s + p.lives, 0);
        if (totalLives <= 0) {
          broadcast.gameOver = true;
        }
      } else {
        player.state = 'dead';
        broadcast = { type: 'player:die', playerId };
      }
      break;
    }

    case 'player:respawn': {
      player.state = 'idle';
      player.x = event.x || 100;
      player.y = event.y || 300;
      broadcast = { type: 'player:respawn', playerId, x: player.x, y: player.y };
      break;
    }

    case 'level:finish': {
      if (player.finished) return null;
      player.finished = true;
      player.finishTime = ts - gs.startTime;
      player.score += Math.max(0, 10000 - Math.floor(player.finishTime / 100)); // Time bonus
      broadcast = { type: 'level:finish', playerId, finishTime: player.finishTime, score: player.score };

      // Check if race is over (first to finish or all finished)
      const finished = Object.values(gs.players).filter(p => p.finished);
      if (gs.mode === 'race' && finished.length === 1) {
        broadcast.raceOver = true;
        broadcast.winner = playerId;
      }
      break;
    }

    default:
      // Pass-through for unknown events (powerups etc)
      broadcast = { type: event.type, playerId, ...event, ts };
  }

  if (broadcast) {
    broadcast.ts = ts;
    // Ring buffer: keep last 100 events
    gs.events.push(broadcast);
    if (gs.events.length > 100) gs.events.shift();
  }

  return broadcast;
}

// ── Game over / results ───────────────────────────────────────────────────────
function recordGameOver(roomId, playerId, clientScore) {
  const gs = gameStates.get(roomId);
  if (!gs) return null;

  const player = gs.players[playerId];
  if (player) {
    // Reconcile: take max of server score and client score (lenient)
    player.score = Math.max(player.score, Number(clientScore) || 0);
    player.finished = true;
  }

  const allFinished = Object.values(gs.players).every(p => p.finished);
  if (!allFinished) return null; // Wait for all players

  const results = buildResults(gs);
  roomManager.finishRoom(roomId);
  gameStates.delete(roomId);
  return results;
}

function buildResults(gs) {
  const sorted = Object.values(gs.players).sort((a, b) => b.score - a.score);
  return {
    mode: gs.mode,
    duration: Date.now() - gs.startTime,
    standings: sorted.map((p, i) => ({
      rank: i + 1,
      playerId: p.id,
      username: p.username,
      score: p.score,
      coins: p.coins,
      finishTime: p.finishTime
    }))
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getFullState(roomId) {
  return gameStates.get(roomId) || null;
}

function clearRoom(roomId) {
  gameStates.delete(roomId);
}

function getOrInit(roomId) {
  if (gameStates.has(roomId)) return gameStates.get(roomId);
  const room = roomManager.getRoom(roomId);
  if (!room || room.status !== 'in_progress') return null;
  return initState(roomId, room);
}

module.exports = { processPlayerUpdate, processEvent, recordGameOver, getFullState, clearRoom, initState };

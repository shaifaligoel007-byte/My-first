/**
 * roomManager.js — manages game rooms lifecycle
 * Modes: 'race' | 'coop' | 'pvp'
 */
const { v4: uuidv4 } = require('uuid');

const rooms = new Map(); // roomId → room

function createRoom({ hostId, mode = 'race', maxPlayers = 4, isPrivate = false }) {
  const id = uuidv4().slice(0, 6).toUpperCase(); // Short room code like "A3F9B2"
  const room = {
    id,
    hostId,
    mode,
    maxPlayers: Math.min(Math.max(maxPlayers, 1), 8),
    isPrivate,
    players: [],
    status: 'waiting', // waiting | starting | in_progress | finished
    createdAt: Date.now(),
    startedAt: null,
    scores: {}
  };
  rooms.set(id, room);

  // Auto-clean empty rooms after 10 min
  setTimeout(() => {
    const r = rooms.get(id);
    if (r && r.players.length === 0) rooms.delete(id);
  }, 10 * 60 * 1000);

  return room;
}

function joinRoom(roomId, player) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.status !== 'waiting') return { ok: false, error: 'Game already started' };
  if (room.players.length >= room.maxPlayers) return { ok: false, error: 'Room is full' };
  if (room.players.find(p => p.id === player.id)) return { ok: true, room }; // already in room

  room.players.push({
    id: player.id,
    username: player.username,
    ready: false,
    character: assignCharacter(room.players.length)
  });
  return { ok: true, room };
}

function leaveRoom(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.players = room.players.filter(p => p.id !== playerId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return { dissolved: true };
  }

  // Transfer host if host left
  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }

  return { ok: true, room };
}

function startRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return null;
  if (room.players.length < 1) return null;
  room.status = 'in_progress';
  room.startedAt = Date.now();
  return room;
}

function finishRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.status = 'finished';
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function getPublicRooms() {
  return [...rooms.values()]
    .filter(r => !r.isPrivate && r.status === 'waiting')
    .map(r => ({
      id: r.id,
      mode: r.mode,
      players: r.players.length,
      maxPlayers: r.maxPlayers,
      hostUsername: r.players[0]?.username || 'Unknown'
    }));
}

// Assign player slots for Pipe Sprint V4
const CHARACTERS = ['P1','P2','P3','P4','P5','P6','P7','P8'];
function assignCharacter(index) {
  return CHARACTERS[index % CHARACTERS.length];
}

module.exports = { createRoom, joinRoom, leaveRoom, startRoom, finishRoom, getRoom, getPublicRooms };

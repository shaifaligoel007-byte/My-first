const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const authRouter = require('./routes/auth');
const leaderboardRouter = require('./routes/leaderboard');
const roomManager = require('./game/roomManager');
const gameSync = require('./game/gameSync');
const db = require('./db');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// REST routes
app.use('/auth', authRouter);
app.use('/leaderboard', leaderboardRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Auth / identity ──────────────────────────────────────────────────────
  socket.on('player:auth', ({ token, username }) => {
    const player = db.verifyToken(token);
    if (!player && !username) {
      socket.emit('error', { code: 'AUTH_FAILED', message: 'Invalid token or no username' });
      return;
    }
    const identity = player || { id: uuidv4(), username, guest: true };
    socket.data.player = identity;
    socket.emit('player:authenticated', { player: identity });
    console.log(`[Auth] ${identity.username} (${identity.id})`);
  });

  // ── Room management ───────────────────────────────────────────────────────
  socket.on('room:create', ({ mode, maxPlayers = 4 }) => {
    const player = requireAuth(socket); if (!player) return;
    const room = roomManager.createRoom({ hostId: player.id, mode, maxPlayers });
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.emit('room:created', { room });
    console.log(`[Room] Created ${room.id} by ${player.username} (mode: ${mode})`);
  });

  socket.on('room:join', ({ roomId }) => {
    const player = requireAuth(socket); if (!player) return;
    const result = roomManager.joinRoom(roomId, player);
    if (!result.ok) {
      socket.emit('error', { code: 'JOIN_FAILED', message: result.error });
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('room:joined', { room: result.room });
    io.to(roomId).emit('room:updated', { room: result.room });
    console.log(`[Room] ${player.username} joined ${roomId}`);
  });

  socket.on('room:leave', () => leaveRoom(socket, io));

  socket.on('room:list', () => {
    socket.emit('room:list', { rooms: roomManager.getPublicRooms() });
  });

  socket.on('room:start', () => {
    const player = requireAuth(socket); if (!player) return;
    const room = roomManager.getRoom(socket.data.roomId);
    if (!room) return socket.emit('error', { code: 'NO_ROOM' });
    if (room.hostId !== player.id) return socket.emit('error', { code: 'NOT_HOST' });
    const started = roomManager.startRoom(room.id);
    if (started) {
      io.to(room.id).emit('game:start', { room: started });
      console.log(`[Game] Started in room ${room.id}`);
    }
  });

  // ── Real-time game state sync ─────────────────────────────────────────────
  socket.on('game:playerUpdate', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const update = gameSync.processPlayerUpdate(roomId, socket.data.player?.id, data);
    // Broadcast to others in room (not sender)
    socket.to(roomId).emit('game:playerUpdate', update);
  });

  socket.on('game:event', (event) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const processed = gameSync.processEvent(roomId, socket.data.player?.id, event);
    if (processed) {
      io.to(roomId).emit('game:event', processed);
    }
  });

  socket.on('game:stateRequest', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = gameSync.getFullState(roomId);
    socket.emit('game:fullState', state);
  });

  socket.on('game:over', ({ score }) => {
    const player = requireAuth(socket); if (!player) return;
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const result = gameSync.recordGameOver(roomId, player.id, score);
    if (result) {
      io.to(roomId).emit('game:results', result);
      // Save scores to leaderboard
      db.saveScore({ playerId: player.id, username: player.username, score, mode: result.mode });
    }
  });

  // ── Chat ──────────────────────────────────────────────────────────────────
  socket.on('chat:message', ({ text }) => {
    const player = requireAuth(socket); if (!player) return;
    const roomId = socket.data.roomId;
    if (!roomId || !text?.trim()) return;
    const msg = { id: uuidv4(), playerId: player.id, username: player.username, text: text.trim().slice(0, 200), ts: Date.now() };
    io.to(roomId).emit('chat:message', msg);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id} (${socket.data.player?.username || 'guest'})`);
    leaveRoom(socket, io);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function requireAuth(socket) {
  if (!socket.data.player) {
    socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Send player:auth first' });
    return null;
  }
  return socket.data.player;
}

function leaveRoom(socket, io) {
  const roomId = socket.data.roomId;
  const player = socket.data.player;
  if (!roomId || !player) return;
  const result = roomManager.leaveRoom(roomId, player.id);
  socket.leave(roomId);
  socket.data.roomId = null;
  if (result?.room) {
    io.to(roomId).emit('room:updated', { room: result.room });
  }
  if (result?.dissolved) {
    io.to(roomId).emit('room:dissolved');
    gameSync.clearRoom(roomId);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🏁 Pipe Sprint V4 server running on port ${PORT}`));

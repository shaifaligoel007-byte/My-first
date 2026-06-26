# 🏁 Pipe Sprint V4 — Backend Server

Full-stack multiplayer backend: real-time Socket.io, REST auth, leaderboard, and game state sync.

## Quick Start

```bash
npm install
npm run dev       # dev (nodemon)
npm start         # production
```

Server runs on **port 3001** by default. Set `PORT` env var to change.

---

## REST API

### Auth
| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/auth/register` | `{ username, password }` | `{ token, player }` |
| POST | `/auth/login` | `{ username, password }` | `{ token, player }` |
| GET | `/auth/me` | — (Bearer token) | `{ player }` |

### Leaderboard
| Method | Endpoint | Query | Response |
|--------|----------|-------|----------|
| GET | `/leaderboard` | `?mode=race&limit=50` | `{ leaderboard }` |
| GET | `/leaderboard/player/:id` | `?limit=20` | `{ scores }` |

---

## Socket.io Events

### Connection & Auth
```
Client → server:  player:auth       { token?, username? }
Server → client:  player:authenticated  { player }
Server → client:  error             { code, message }
```

### Rooms
```
Client → server:  room:create       { mode, maxPlayers }
Server → client:  room:created      { room }

Client → server:  room:join         { roomId }
Server → client:  room:joined       { room }
Server → room:    room:updated      { room }

Client → server:  room:leave
Server → room:    room:dissolved    (host left, all players gone)

Client → server:  room:list
Server → client:  room:list         { rooms }

Client → server:  room:start        (host only)
Server → room:    game:start        { room }
```

Room **modes**: `race` | `coop` | `pvp`

### Game Sync
```
Client → server:  game:playerUpdate  { x, y, vx, vy, facing, state, animFrame }
Server → others:  game:playerUpdate  { playerId, tick, x, y, ... }

Client → server:  game:event         { type, ...data }
Server → room:    game:event         { type, playerId, ...data, ts }

Client → server:  game:stateRequest
Server → client:  game:fullState     { players, coins, tick, ... }

Client → server:  game:over          { score }
Server → room:    game:results       { mode, duration, standings[] }
```

#### Event types
| type | Who sends | Data |
|------|-----------|------|
| `coin:collect` | client | `{ coinId, value }` |
| `coin:steal` | client (pvp) | `{ targetId }` |
| `player:die` | client | — |
| `player:respawn` | client | `{ x, y }` |
| `level:finish` | client | — |

### Chat
```
Client → server:  chat:message  { text }
Server → room:    chat:message  { id, playerId, username, text, ts }
```

---

## Deploy to Replit

1. Import this folder into a new Replit project (Node.js template)
2. Set `PORT` to `3001` in Secrets (or leave default)
3. Click **Run** — Replit exposes the URL automatically
4. In your game client, replace `localhost:3001` with the Replit URL

---

## Connecting from the Game Client

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

// 1. Auth (guest mode)
socket.emit('player:auth', { username: 'GopalP' });
socket.on('player:authenticated', ({ player }) => console.log(player));

// 2. Create or join a room
socket.emit('room:create', { mode: 'race', maxPlayers: 4 });
socket.on('room:created', ({ room }) => console.log('Room code:', room.id));

// 3. Start (host only)
socket.emit('room:start');
socket.on('game:start', () => startGame());

// 4. Send position every frame
socket.emit('game:playerUpdate', { x, y, vx, vy, facing, state });

// 5. Receive others' positions
socket.on('game:playerUpdate', ({ playerId, x, y, ... }) => updateSprite(playerId, ...));
```

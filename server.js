const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');
const compression = require('compression');

const app = express();
const server = http.createServer(app);

// --- gzip/brotli compression for HTTP responses ---
// Compresses HTML, CSS, JS, JSON responses (60-80% smaller)
app.use(compression({
  level: 6, // balanced speed vs ratio
  threshold: 1024, // only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress already-compressed file downloads
    if (req.path.endsWith('.compx') || req.path.endsWith('.enc')) return false;
    return compression.filter(req, res);
  }
}));

// --- Static files with optimized cache headers ---
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '2h',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Algorithm files rarely change — cache longer
    if (filePath.includes('algorithms')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h
    }
    // Worker file — cache longer
    if (filePath.includes('workers')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h
    }
    // HTML needs shorter cache for updates
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5min
    }
  }
}));

const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });

const rooms = new Map();
const users = new WeakMap();

const COLORS = [
  '#06d6a0', '#7c3aed', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316'
];
let colorIndex = 0;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function broadcastToRoom(roomCode, message, excludeWs) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const payload = typeof message === 'string' ? message : JSON.stringify(message);

  for (const client of room) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(payload);
    }
  }
}

/**
 * Broadcast binary data to room members (for file transfer).
 * Includes backpressure check — skips clients whose send buffer
 * is too full to prevent unbounded memory growth.
 */
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB backpressure threshold

function broadcastBinaryToRoom(roomCode, data, excludeWs) {
  const room = rooms.get(roomCode);
  if (!room) return;

  for (const client of room) {
    if (client !== excludeWs && client.readyState === 1) {
      // Backpressure: skip if client's send buffer is too full
      if (client.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        continue;
      }
      client.send(data);
    }
  }
}

function getRoomUsers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];

  const list = [];
  for (const client of room) {
    const user = users.get(client);
    if (user) list.push({ id: user.id, name: user.name, color: user.color });
  }
  return list;
}

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  const userId = crypto.randomBytes(4).toString('hex');
  const userColor = COLORS[colorIndex++ % COLORS.length];

  users.set(ws, {
    id: userId,
    name: `User-${userId.slice(0, 4)}`,
    room: null,
    color: userColor
  });

  send(ws, {
    event: 'welcome',
    userId,
    color: userColor
  });

  ws.on('message', (raw, isBinary) => {
    const user = users.get(ws);
    if (!user) return;

    // Binary message = file transfer chunk
    if (isBinary) {
      if (!user.room) return;
      // Relay binary data to all other room members
      broadcastBinaryToRoom(user.room, raw, ws);
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.event) {
      case 'room:create': {
        leaveRoom(ws);

        const code = generateRoomCode();
        rooms.set(code, new Set([ws]));
        user.room = code;
        if (msg.name) user.name = msg.name.slice(0, 20);

        send(ws, {
          event: 'room:created',
          roomCode: code,
          users: getRoomUsers(code)
        });
        break;
      }

      case 'room:join': {
        const code = (msg.roomCode || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { event: 'room:error', message: 'Room not found' });
          break;
        }

        if (room.size >= 10) {
          send(ws, { event: 'room:error', message: 'Room is full (max 10)' });
          break;
        }

        leaveRoom(ws);
        room.add(ws);
        user.room = code;
        if (msg.name) user.name = msg.name.slice(0, 20);

        send(ws, {
          event: 'room:joined',
          roomCode: code,
          users: getRoomUsers(code)
        });

        broadcastToRoom(code, {
          event: 'user:joined',
          user: { id: user.id, name: user.name, color: user.color },
          users: getRoomUsers(code)
        }, ws);
        break;
      }

      case 'room:leave': {
        leaveRoom(ws);
        send(ws, { event: 'room:left' });
        break;
      }

      case 'file:compressing': {
        if (!user.room) break;
        broadcastToRoom(user.room, {
          event: 'file:compressing',
          userId: user.id,
          userName: user.name,
          fileName: (msg.fileName || '').slice(0, 100),
          fileSize: msg.fileSize || 0,
          algorithm: msg.algorithm || 'unknown'
        }, ws);
        break;
      }

      case 'file:result': {
        if (!user.room) break;
        broadcastToRoom(user.room, {
          event: 'file:result',
          userId: user.id,
          userName: user.name,
          stats: msg.stats || {}
        }, ws);
        break;
      }

      // File transfer signaling messages
      case 'file:transfer:start': {
        if (!user.room) break;
        broadcastToRoom(user.room, {
          event: 'file:transfer:start',
          userId: user.id,
          userName: user.name,
          fileName: (msg.fileName || '').slice(0, 200),
          fileSize: msg.fileSize || 0,
          totalChunks: msg.totalChunks || 0,
          encrypted: !!msg.encrypted,
          transferId: msg.transferId
        }, ws);
        break;
      }

      case 'file:transfer:end': {
        if (!user.room) break;
        broadcastToRoom(user.room, {
          event: 'file:transfer:end',
          userId: user.id,
          userName: user.name,
          transferId: msg.transferId
        }, ws);
        break;
      }

      case 'file:transfer:error': {
        if (!user.room) break;
        broadcastToRoom(user.room, {
          event: 'file:transfer:error',
          userId: user.id,
          transferId: msg.transferId,
          message: msg.message
        }, ws);
        break;
      }

      case 'chat:message': {
        if (!user.room) break;
        const text = (msg.text || '').trim().slice(0, 500);
        if (!text) break;

        broadcastToRoom(user.room, {
          event: 'chat:message',
          userId: user.id,
          userName: user.name,
          userColor: user.color,
          text,
          timestamp: Date.now()
        }, ws);

        send(ws, {
          event: 'chat:message',
          userId: user.id,
          userName: user.name,
          userColor: user.color,
          text,
          timestamp: Date.now(),
          self: true
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
  });

  ws.on('error', () => {
    leaveRoom(ws);
  });
});

function leaveRoom(ws) {
  const user = users.get(ws);
  if (!user || !user.room) return;

  const code = user.room;
  const room = rooms.get(code);

  if (room) {
    room.delete(ws);

    if (room.size === 0) {
      rooms.delete(code);
    } else {
      broadcastToRoom(code, {
        event: 'user:left',
        userId: user.id,
        userName: user.name,
        users: getRoomUsers(code)
      });
    }
  }

  user.room = null;
}

const HEARTBEAT_INTERVAL = 30000;

// Single connection handler for heartbeat (merged with main handler above)
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      leaveRoom(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// Set isAlive on each new connection
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  CompressX server running at:`);
  console.log(`  → http://localhost:${PORT}\n`);
});

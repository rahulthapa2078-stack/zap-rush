'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN?.split(',') || true }, pingInterval: 10000, pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'zap-rush' }));

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const AVATARS = new Set(['bolt','fox','cat','robot','alien','shark','tiger','ghost','dragon','panda','owl','rocket']);
const now = () => Number(process.hrtime.bigint() / 1000000n);
const token = () => crypto.randomBytes(24).toString('base64url');
function makeCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = ''; for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to allocate room code');
}
function publicRoom(room) {
  return {
    code: room.code, phase: room.phase, hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, score: p.score, isHost: p.id === room.hostId, reactionMs: p.reactionMs, falseStart: p.falseStart })),
    round: room.round, roundTotal: 1, target: room.target, winnerId: room.winnerId,
    message: room.message
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function sendError(socket, message) { socket.emit('app:error', { message }); }
function findPlayerBySocket(room, socketId) { return [...room.players.values()].find(p => p.socketId === socketId); }
function finishRound(room, reason = 'complete') {
  if (room.phase !== 'playing' && room.phase !== 'waiting') return;
  clearTimeout(room.timer); room.timer = null;
  room.phase = 'results'; room.message = reason === 'no-eligible' ? 'No valid taps this round' : 'Round complete';
  emitRoom(room);
}
function startRound(room) {
  room.phase = 'waiting'; room.round = 1; room.winnerId = null; room.target = null; room.message = 'Get ready';
  for (const p of room.players.values()) { p.reactionMs = null; p.falseStart = false; p.eligible = p.connected; }
  emitRoom(room);
  const delay = crypto.randomInt(2000, 6001);
  room.timer = setTimeout(() => {
    if (room.phase !== 'waiting') return;
    room.phase = 'playing'; room.target = { x: crypto.randomInt(14, 87), y: crypto.randomInt(20, 81), size: 112 };
    room.shownAt = now(); room.message = 'ZAP!'; emitRoom(room);
  }, delay);
}
function startMatch(room, socket) {
  const player = findPlayerBySocket(room, socket.id);
  if (!player || player.id !== room.hostId) return sendError(socket, 'Only the host can start the game.');
  const connected = [...room.players.values()].filter(p => p.connected);
  if (connected.length < 3) return sendError(socket, 'At least 3 connected players are needed.');
  if (room.phase !== 'lobby' && room.phase !== 'results') return sendError(socket, 'A game is already in progress.');
  for (const p of room.players.values()) p.score = 0;
  room.phase = 'countdown'; room.message = 'Match starting'; room.round = 1; room.winnerId = null;
  emitRoom(room);
  room.timer = setTimeout(() => startRound(room), 3200);
}
function roomBySocket(socket) {
  for (const room of rooms.values()) if (findPlayerBySocket(room, socket.id)) return room;
  return null;
}

io.on('connection', socket => {
  socket.on('room:create', ({ name, avatar } = {}) => {
    name = String(name || '').trim().slice(0, 16);
    avatar = AVATARS.has(avatar) ? avatar : 'bolt';
    if (name.length < 2) return sendError(socket, 'Choose a nickname with at least 2 characters.');
    const code = makeCode(), id = crypto.randomUUID(), resumeToken = token();
    const room = { code, phase: 'lobby', hostId: id, players: new Map(), round: 0, target: null, winnerId: null, timer: null, emptyTimer: null, message: 'Waiting for players' };
    room.players.set(id, { id, name, avatar, token: resumeToken, socketId: socket.id, connected: true, score: 0, reactionMs: null, falseStart: false, eligible: true });
    rooms.set(code, room); socket.join(code); socket.emit('room:joined', { code, playerId: id, resumeToken }); emitRoom(room);
  });

  socket.on('room:join', ({ code, name, avatar } = {}) => {
    code = String(code || '').trim().toUpperCase(); name = String(name || '').trim().slice(0, 16); avatar = AVATARS.has(avatar) ? avatar : 'bolt';
    const room = rooms.get(code);
    if (!room) return sendError(socket, 'That room code does not exist. Check it and try again.');
    if (room.players.size >= 4) return sendError(socket, 'This room is full (4 players maximum).');
    if (room.phase !== 'lobby') return sendError(socket, 'This match has already started. Ask the host to start a new room.');
    if (name.length < 2) return sendError(socket, 'Choose a nickname with at least 2 characters.');
    if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return sendError(socket, 'That nickname is already taken in this room.');
    const id = crypto.randomUUID(), resumeToken = token();
    room.players.set(id, { id, name, avatar, token: resumeToken, socketId: socket.id, connected: true, score: 0, reactionMs: null, falseStart: false, eligible: true });
    socket.join(code); socket.emit('room:joined', { code, playerId: id, resumeToken }); emitRoom(room);
  });

  socket.on('room:resume', ({ code, playerId, resumeToken } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase()); const p = room?.players.get(playerId);
    if (!room || !p || p.token !== resumeToken) return sendError(socket, 'Your reconnect session could not be found. Rejoin with the room code.');
    if (p.socketId && p.socketId !== socket.id) { const old = io.sockets.sockets.get(p.socketId); if (old) old.disconnect(true); }
    p.socketId = socket.id; p.connected = true; p.eligible = room.phase === 'waiting' || room.phase === 'playing' ? !p.falseStart && p.reactionMs == null : true;
    clearTimeout(room.emptyTimer); room.emptyTimer = null;
    socket.join(room.code); socket.emit('room:joined', { code: room.code, playerId: p.id, resumeToken: p.token }); emitRoom(room);
  });

  socket.on('game:start', () => { const room = roomBySocket(socket); if (room) startMatch(room, socket); });
  socket.on('game:tap', () => {
    const room = roomBySocket(socket); if (!room) return;
    const p = findPlayerBySocket(room, socket.id); if (!p || !p.connected || !p.eligible) return;
    if (room.phase === 'waiting') {
      p.eligible = false; p.falseStart = true; p.score -= 1; p.reactionMs = null;
      room.message = `${p.name} false-started!`; emitRoom(room);
      const remaining = [...room.players.values()].filter(x => x.connected && x.eligible);
      if (!remaining.length) finishRound(room, 'no-eligible');
      return;
    }
    if (room.phase !== 'playing' || room.winnerId) return;
    p.reactionMs = Math.max(0, now() - room.shownAt); p.score += 1; p.eligible = false;
    room.winnerId = p.id; room.message = `${p.name} wins!`; finishRound(room);
  });
  socket.on('game:again', () => {
    const room = roomBySocket(socket); if (!room) return;
    const p = findPlayerBySocket(room, socket.id);
    if (p?.id !== room.hostId) return sendError(socket, 'Only the host can start another match.');
    room.phase = 'lobby'; room.round = 0; room.target = null; room.winnerId = null; room.message = 'Ready for another match';
    for (const player of room.players.values()) { player.score = 0; player.reactionMs = null; player.falseStart = false; player.eligible = true; }
    emitRoom(room);
  });
  socket.on('disconnect', () => {
    const room = roomBySocket(socket); if (!room) return;
    const p = findPlayerBySocket(room, socket.id); if (!p) return;
    p.connected = false; p.socketId = null;
    if (room.hostId === p.id) {
      const successor = [...room.players.values()].find(x => x.connected);
      if (successor) room.hostId = successor.id;
    }
    emitRoom(room);
    if (![...room.players.values()].some(x => x.connected)) {
      room.emptyTimer = setTimeout(() => { clearTimeout(room.timer); rooms.delete(room.code); }, 30 * 60 * 1000);
    }
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => console.log(`Zap Rush listening on ${PORT}`));

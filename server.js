const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { GRID, insideRoom } = require('./public/rules.js');
const { resolveAttack } = require('./combat/attack.js');

const PORT = process.env.PORT || 3000;
const DM_CODE = process.env.DM_CODE || 'dm';

const monsters = require('./data/monsters.json');
const characters = require('./data/characters.json');

// Every creature we know about, keyed by id.
const catalog = {};
[...monsters, ...characters].forEach((c) => {
  catalog[c.id] = c;
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/konva', express.static(path.join(__dirname, 'node_modules/konva')));
app.use('/tokens', express.static(path.join(__dirname, '../dnd5e/tokens')));

// The one source of truth. Clients only ever send intents.
const board = { tokens: [], nextId: 1, log: [], nextLogId: 1 };
const MAX_LOG_ENTRIES = 100;

// Build the view a given role is allowed to see.
// Players get full sheets for characters but only a name for monsters,
// and monster HP is hidden. This is where the DM-only rule lives.
function buildState(isDM) {
  const creatures = {};

  const tokens = board.tokens.map((t) => {
    const c = catalog[t.creatureId];
    const canSeeAll = isDM || c.team === 'player';
    creatures[c.id] = canSeeAll ? c : { id: c.id, name: c.name, team: c.team, token: c.token };
    return canSeeAll ? t : { ...t, hp: null, maxHp: null };
  });

  const roster = Object.values(catalog)
    .filter((c) => isDM || c.team === 'player')
    .map((c) => {
      const entry = { id: c.id, name: c.name, team: c.team };
      if (c.class) entry.class = c.class;
      return entry;
    });

  // The DM sees every roll. Players only see the one-line outcome.
  const log = board.log.map((entry) => ({
    id: entry.id,
    outcome: entry.outcome,
    lines: isDM ? entry.dm : [entry.pub],
  }));

  return { tokens, creatures, roster, log, isDM };
}

function broadcast() {
  io.sockets.sockets.forEach((s) => {
    s.emit('state', buildState(s.data.isDM));
  });
}

function footprintOf(token) {
  return { w: token.w || 1, h: token.h || 1 };
}

function isOccupied(x, y, ignoreId) {
  return board.tokens.some((t) => {
    if (t.id === ignoreId) return false;
    const { w, h } = footprintOf(t);
    return x >= t.x && x < t.x + w && y >= t.y && y < t.y + h;
  });
}

// Every square of the rectangle has to be inside the room and empty.
function fits(x, y, w, h, ignoreId) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (!insideRoom(cx, cy) || isOccupied(cx, cy, ignoreId)) return false;
    }
  }
  return true;
}

// Scan the room left to right, top to bottom for the first open rectangle.
function findFreeSpot(w, h) {
  for (let y = 1; y < GRID.rows; y++) {
    for (let x = 1; x < GRID.cols; x++) {
      if (fits(x, y, w, h, null)) return { x, y };
    }
  }
  return null;
}

function canMove(socket, token) {
  return socket.data.isDM || token.team === 'player';
}

io.on('connection', (socket) => {
  socket.data.isDM = socket.handshake.auth.dmCode === DM_CODE;
  socket.emit('state', buildState(socket.data.isDM));

  socket.on('token:add', ({ creatureId }) => {
    const c = catalog[creatureId];
    if (!c) return;
    // Players can only place characters, and each character only once.
    if (!socket.data.isDM && c.team !== 'player') return;
    if (c.team === 'player' && board.tokens.some((t) => t.creatureId === c.id)) return;

    const w = c.width || 1;
    const h = c.height || 1;
    const spot = findFreeSpot(w, h);
    if (!spot) return;

    // Monsters get numbered so "Goblin 1" and "Goblin 2" are easy to tell apart.
    let name = c.name;
    if (c.team === 'monster') {
      const count = board.tokens.filter((t) => t.creatureId === c.id).length;
      name = `${c.name} ${count + 1}`;
    }

    board.tokens.push({
      id: board.nextId++,
      creatureId: c.id,
      name,
      team: c.team,
      x: spot.x,
      y: spot.y,
      w,
      h,
      hp: c.hp,
      maxHp: c.hp,
      defeated: false,
    });
    broadcast();
  });

  socket.on('token:move', ({ id, x, y }) => {
    const token = board.tokens.find((t) => t.id === id);
    if (!token || !canMove(socket, token)) return;

    // Reject moves that leave the room or land on another token.
    // Either way we broadcast, which snaps the dragged token back if rejected.
    const { w, h } = footprintOf(token);
    if (fits(x, y, w, h, id)) {
      token.x = x;
      token.y = y;
    }
    broadcast();
  });

  socket.on('attack:declare', ({ attackerId, targetId, actionName }) => {
    const attacker = board.tokens.find((t) => t.id === attackerId);
    const target = board.tokens.find((t) => t.id === targetId);
    if (!attacker || !target || attacker.id === target.id) return;

    // Players can only attack with their own side's tokens.
    if (!socket.data.isDM && attacker.team !== 'player') return;

    const result = resolveAttack({
      attacker,
      target,
      actionName,
      tokens: board.tokens,
      catalog,
    });

    // Rule problems (out of range, defeated) go back to the sender only.
    if (!result.ok) {
      socket.emit('attack:error', { message: result.error });
      return;
    }

    target.hp = result.hpAfter;
    target.defeated = result.defeated;

    board.log.push({
      id: board.nextLogId++,
      outcome: result.outcome,
      dm: result.dm,
      pub: result.pub,
    });
    if (board.log.length > MAX_LOG_ENTRIES) board.log.shift();

    broadcast();
  });

  // Handy for demos: put a token back to full health.
  socket.on('token:restore', ({ id }) => {
    if (!socket.data.isDM) return;
    const token = board.tokens.find((t) => t.id === id);
    if (!token) return;
    token.hp = token.maxHp;
    token.defeated = false;
    broadcast();
  });

  socket.on('token:remove', ({ id }) => {
    if (!socket.data.isDM) return;
    board.tokens = board.tokens.filter((t) => t.id !== id);
    broadcast();
  });
});

function lanAddresses() {
  const found = [];
  Object.values(os.networkInterfaces()).forEach((list) => {
    list.forEach((i) => {
      if (i.family === 'IPv4' && !i.internal) found.push(i.address);
    });
  });
  return found;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Battlemat running on port ${PORT}`);
  console.log(`  DM:      http://localhost:${PORT}/?dm=${DM_CODE}`);
  console.log(`  Players: http://localhost:${PORT}/`);
  lanAddresses().forEach((ip) => {
    console.log(`  LAN:     http://${ip}:${PORT}/`);
  });
});

const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { GRID, insideRoom } = require('./public/rules.js');

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

// The one source of truth. Clients only ever send intents.
const board = { tokens: [], nextId: 1 };

// Build the view a given role is allowed to see.
// Players get full sheets for characters but only a name for monsters,
// and monster HP is hidden. This is where the DM-only rule lives.
function buildState(isDM) {
  const creatures = {};

  const tokens = board.tokens.map((t) => {
    const c = catalog[t.creatureId];
    const canSeeAll = isDM || c.team === 'player';
    creatures[c.id] = canSeeAll ? c : { id: c.id, name: c.name, team: c.team };
    return canSeeAll ? t : { ...t, hp: null, maxHp: null };
  });

  const roster = Object.values(catalog)
    .filter((c) => isDM || c.team === 'player')
    .map((c) => ({ id: c.id, name: c.name, team: c.team }));

  return { tokens, creatures, roster, isDM };
}

function broadcast() {
  io.sockets.sockets.forEach((s) => {
    s.emit('state', buildState(s.data.isDM));
  });
}

function isOccupied(x, y, ignoreId) {
  return board.tokens.some((t) => t.id !== ignoreId && t.x === x && t.y === y);
}

// Scan the room left to right, top to bottom for the first open square.
function findFreeSquare() {
  for (let y = 1; y < GRID.rows; y++) {
    for (let x = 1; x < GRID.cols; x++) {
      if (!isOccupied(x, y, null)) return { x, y };
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

    const spot = findFreeSquare();
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
      hp: c.hp,
      maxHp: c.hp,
    });
    broadcast();
  });

  socket.on('token:move', ({ id, x, y }) => {
    const token = board.tokens.find((t) => t.id === id);
    if (!token || !canMove(socket, token)) return;

    // Reject moves that leave the room or land on another token.
    // Either way we broadcast, which snaps the dragged token back if rejected.
    if (insideRoom(x, y) && !isOccupied(x, y, id)) {
      token.x = x;
      token.y = y;
    }
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

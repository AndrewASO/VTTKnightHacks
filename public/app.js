const { GRID, feetBetween, squareDistance } = window.Rules;

// Colors for the battlemat itself. The page chrome lives in style.css.
const COLORS = {
  mat: '#cfd6c8',
  gridLine: '#8f9b88',
  player: '#2f6f73',
  monster: '#a2402f',
  edge: '#1b2128',
  select: '#fff3b8',
  measure: '#c79a3b',
};

// Pass ?dm=CODE in the URL to join as the DM.
const params = new URLSearchParams(window.location.search);
const socket = io({ auth: { dmCode: params.get('dm') || '' } });

let state = { tokens: [], creatures: {}, roster: [], isDM: false };
let selected = []; // token ids, the first is the "from" token for measuring
let tokenNodes = {}; // token id -> Konva group

// ---------- Stage and layers ----------

const stage = new Konva.Stage({
  container: 'board',
  width: GRID.cols * GRID.size,
  height: GRID.rows * GRID.size,
});
const gridLayer = new Konva.Layer();
const tokenLayer = new Konva.Layer();
const measureLayer = new Konva.Layer({ listening: false });
stage.add(gridLayer, tokenLayer, measureLayer);

function drawGrid() {
  const width = GRID.cols * GRID.size;
  const height = GRID.rows * GRID.size;

  gridLayer.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: COLORS.mat }));

  for (let c = 0; c <= GRID.cols; c++) {
    const x = c * GRID.size;
    gridLayer.add(new Konva.Line({ points: [x, 0, x, height], stroke: COLORS.gridLine, strokeWidth: 1 }));
  }
  for (let r = 0; r <= GRID.rows; r++) {
    const y = r * GRID.size;
    gridLayer.add(new Konva.Line({ points: [0, y, width, y], stroke: COLORS.gridLine, strokeWidth: 1 }));
  }
  gridLayer.batchDraw();
}

// Clicking empty mat clears the selection.
stage.on('click tap', (e) => {
  if (e.target.getLayer() !== tokenLayer) {
    selected = [];
    renderTokens();
    renderPanel();
  }
});

// ---------- Tokens ----------

function initials(name) {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function canMove(token) {
  return state.isDM || token.team === 'player';
}

// While dragging, keep the token locked to grid squares and inside the room.
function snapPixels(pos) {
  const col = Math.min(GRID.cols - 1, Math.max(0, Math.round(pos.x / GRID.size)));
  const row = Math.min(GRID.rows - 1, Math.max(0, Math.round(pos.y / GRID.size)));
  return { x: col * GRID.size, y: row * GRID.size };
}

function makeToken(token) {
  const size = GRID.size;
  const isSelected = selected.includes(token.id);

  const group = new Konva.Group({
    x: token.x * size,
    y: token.y * size,
    draggable: canMove(token),
    dragBoundFunc: snapPixels,
  });

  group.add(new Konva.Circle({
    x: size / 2,
    y: size / 2,
    radius: size / 2 - 4,
    fill: token.team === 'monster' ? COLORS.monster : COLORS.player,
    stroke: isSelected ? COLORS.select : COLORS.edge,
    strokeWidth: isSelected ? 4 : 2,
  }));

  group.add(new Konva.Text({
    x: 0,
    y: 0,
    width: size,
    height: size,
    text: initials(token.name),
    align: 'center',
    verticalAlign: 'middle',
    fontSize: 16,
    fontStyle: 'bold',
    fill: '#ffffff',
    listening: false,
  }));

  group.on('click tap', (e) => selectToken(token.id, e.evt.shiftKey));
  group.on('dragmove', updateMeasure);
  group.on('dragend', () => {
    const x = Math.round(group.x() / size);
    const y = Math.round(group.y() / size);
    socket.emit('token:move', { id: token.id, x, y });
  });

  return group;
}

function renderTokens() {
  tokenLayer.destroyChildren();
  tokenNodes = {};

  state.tokens.forEach((token) => {
    const node = makeToken(token);
    tokenNodes[token.id] = node;
    tokenLayer.add(node);
  });

  tokenLayer.batchDraw();
  updateMeasure();
}

function selectToken(id, additive) {
  if (additive && selected.length > 0 && selected[0] !== id) {
    selected = [selected[0], id];
  } else {
    selected = [id];
  }
  renderTokens();
  renderPanel();
}

// ---------- Distance ----------

function currentSquare(id) {
  const node = tokenNodes[id];
  if (!node) return null;
  return {
    x: Math.round(node.x() / GRID.size),
    y: Math.round(node.y() / GRID.size),
  };
}

function nameOf(id) {
  const token = state.tokens.find((t) => t.id === id);
  return token ? token.name : '?';
}

function updateMeasure() {
  measureLayer.destroyChildren();
  const readout = document.getElementById('distance');

  const a = selected.length === 2 ? currentSquare(selected[0]) : null;
  const b = selected.length === 2 ? currentSquare(selected[1]) : null;

  if (!a || !b) {
    readout.textContent = 'Click a token, then shift-click a second one to measure.';
    measureLayer.batchDraw();
    return;
  }

  const half = GRID.size / 2;
  const ax = a.x * GRID.size + half;
  const ay = a.y * GRID.size + half;
  const bx = b.x * GRID.size + half;
  const by = b.y * GRID.size + half;

  measureLayer.add(new Konva.Line({
    points: [ax, ay, bx, by],
    stroke: COLORS.measure,
    strokeWidth: 3,
    dash: [10, 6],
  }));

  const feet = feetBetween(a, b);
  const label = new Konva.Label({ x: (ax + bx) / 2, y: (ay + by) / 2 });
  label.add(new Konva.Tag({ fill: COLORS.edge, cornerRadius: 3 }));
  label.add(new Konva.Text({ text: `${feet} ft`, padding: 4, fontSize: 14, fill: '#ffffff' }));
  measureLayer.add(label);
  measureLayer.batchDraw();

  readout.textContent =
    `${nameOf(selected[0])} to ${nameOf(selected[1])}: ${feet} ft (${squareDistance(a, b)} squares)`;
}

// ---------- Side panel ----------

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderRoster() {
  const box = document.getElementById('roster');
  box.replaceChildren();

  state.roster.forEach((c) => {
    const button = el('button', c.name, c.team);
    button.addEventListener('click', () => socket.emit('token:add', { creatureId: c.id }));
    box.appendChild(button);
  });
}

function statBox(label, value) {
  const box = el('div', undefined, 'stat');
  box.appendChild(el('b', String(value)));
  box.appendChild(document.createTextNode(label));
  return box;
}

function renderDetail() {
  const box = document.getElementById('detail');
  box.replaceChildren();

  const token = state.tokens.find((t) => t.id === selected[0]);
  if (!token) {
    box.appendChild(el('p', 'Nothing selected.', 'detail-sub'));
    return;
  }

  const c = state.creatures[token.creatureId];
  box.appendChild(el('p', token.name, 'detail-name'));
  box.appendChild(el('p', c.class || c.size || '', 'detail-sub'));

  // Monster stats stay hidden from players, so only show what we were sent.
  const stats = el('div', undefined, 'stats');
  if (token.hp !== null) stats.appendChild(statBox('HP', `${token.hp}/${token.maxHp}`));
  if (c.ac !== undefined) stats.appendChild(statBox('AC', c.ac));
  if (c.speed !== undefined) stats.appendChild(statBox('Speed', `${c.speed} ft`));
  if (c.abilities) {
    Object.entries(c.abilities).forEach(([name, score]) => {
      stats.appendChild(statBox(name.toUpperCase(), score));
    });
  }
  box.appendChild(stats);

  if (c.resist || c.immune || c.vuln) {
    const lines = [
      ['Resists', c.resist],
      ['Immune', c.immune],
      ['Vulnerable', c.vuln],
    ];
    lines.forEach(([label, list]) => {
      if (list && list.length > 0) {
        box.appendChild(el('p', `${label}: ${list.join(', ')}`, 'defenses'));
      }
    });
  }

  // Monsters call these traits, characters call them features.
  const features = c.features || c.traits || [];
  features.forEach((f) => {
    const row = el('p', undefined, 'feature');
    row.appendChild(el('b', `${f.name}. `));
    row.appendChild(document.createTextNode(f.summary));
    box.appendChild(row);
  });

  if (state.isDM) {
    const remove = el('button', 'Remove token', 'danger');
    remove.addEventListener('click', () => {
      socket.emit('token:remove', { id: token.id });
      selected = selected.filter((id) => id !== token.id);
    });
    box.appendChild(remove);
  }
}

function renderPanel() {
  document.getElementById('role').textContent = state.isDM ? 'Dungeon Master view' : 'Player view';
  renderRoster();
  renderDetail();
}

// ---------- Wiring ----------

socket.on('state', (newState) => {
  state = newState;
  // Drop any selected tokens that no longer exist.
  selected = selected.filter((id) => state.tokens.some((t) => t.id === id));
  renderTokens();
  renderPanel();
});

drawGrid();

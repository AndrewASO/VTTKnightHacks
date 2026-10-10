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

function hpColor(pct) {
  if (pct > 0.5) return '#6aa84f';
  if (pct > 0.25) return '#d6a032';
  return '#c0432f';
}

function makeToken(token) {
  const size = GRID.size;
  const isSelected = selected.includes(token.id);

  const group = new Konva.Group({
    x: token.x * size,
    y: token.y * size,
    draggable: canMove(token),
    dragBoundFunc: snapPixels,
    opacity: token.defeated ? 0.35 : 1,
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

  // Small HP bar along the bottom. Hidden when the viewer is not allowed to see HP.
  if (token.hp !== null && token.maxHp) {
    const pct = Math.max(0, token.hp / token.maxHp);
    group.add(new Konva.Rect({ x: 6, y: size - 9, width: size - 12, height: 5, fill: '#3b4450', listening: false }));
    group.add(new Konva.Rect({ x: 6, y: size - 9, width: (size - 12) * pct, height: 5, fill: hpColor(pct), listening: false }));
  }

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
    const restore = el('button', 'Restore HP');
    restore.addEventListener('click', () => socket.emit('token:restore', { id: token.id }));
    box.appendChild(restore);

    const remove = el('button', 'Remove token', 'danger');
    remove.addEventListener('click', () => {
      socket.emit('token:remove', { id: token.id });
      selected = selected.filter((id) => id !== token.id);
    });
    box.appendChild(remove);
  }
}

function tokenById(id) {
  return state.tokens.find((t) => t.id === id);
}

// The farthest an action can reach, counting both melee reach and ranged distance.
function maxReach(action) {
  const reach = action.reach || 0;
  const range = action.range ? action.range.long : 0;
  return Math.max(reach, range);
}

// Shows one button per action the attacker has. Select an attacker, then
// shift-click a target. Both stay selected so you can keep attacking.
function renderAttack() {
  const box = document.getElementById('attack-actions');
  box.replaceChildren();
  document.getElementById('attack-msg').textContent = '';

  const attacker = tokenById(selected[0]);
  const target = tokenById(selected[1]);

  if (!attacker || !target) {
    box.appendChild(el('p', 'Select an attacker, then shift-click a target.', 'detail-sub'));
    return;
  }

  const creature = state.creatures[attacker.creatureId];
  const actions = creature.actions || [];
  const allowed = state.isDM || attacker.team === 'player';

  if (actions.length === 0 || !allowed) {
    box.appendChild(el('p', 'Pick one of your own characters as the attacker.', 'detail-sub'));
    return;
  }

  const feet = feetBetween(attacker, target);

  actions.forEach((action) => {
    const button = el('button', action.name);
    let hint = '';

    if (attacker.defeated || target.defeated) {
      hint = 'a defeated token is involved';
    } else if (action.saveAbility) {
      hint = 'needs save rules (coming soon)';
    } else if (feet > maxReach(action)) {
      hint = `out of range (${feet} ft away)`;
    }

    if (hint) {
      button.disabled = true;
      button.appendChild(el('span', hint, 'hint'));
    }

    button.addEventListener('click', () => {
      socket.emit('attack:declare', {
        attackerId: attacker.id,
        targetId: target.id,
        actionName: action.name,
      });
    });
    box.appendChild(button);
  });
}

// Newest entry first, so there is no scrolling needed to see the latest attack.
function renderLog() {
  const box = document.getElementById('log');
  box.replaceChildren();

  if (state.log.length === 0) {
    box.appendChild(el('p', 'No attacks yet.', 'detail-sub'));
    return;
  }

  state.log.slice().reverse().forEach((entry) => {
    const item = el('div', undefined, `log-entry ${entry.outcome}`);
    entry.lines.forEach((line, index) => {
      item.appendChild(el('p', line, index === 0 ? 'log-head' : 'log-line'));
    });
    box.appendChild(item);
  });
}

function renderPanel() {
  document.getElementById('role').textContent = state.isDM ? 'Dungeon Master view' : 'Player view';
  renderRoster();
  renderAttack();
  renderLog();
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

// Rule errors such as "out of range" come back only to the player who asked.
socket.on('attack:error', ({ message }) => {
  document.getElementById('attack-msg').textContent = message;
});

drawGrid();

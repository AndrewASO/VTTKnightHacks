// Plain dice rolling. Nothing here knows about D&D rules, only numbers.

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

// Rolls strings like "2d4+2" or "1d8". A crit doubles the dice, never the modifier.
function rollDice(text, crit = false) {
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(text.replace(/\s/g, ''));
  if (!match) throw new Error('Bad dice string: ' + text);

  let count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (crit) count = count * 2;

  const dice = [];
  for (let i = 0; i < count; i++) {
    dice.push(rollDie(sides));
  }

  const total = dice.reduce((sum, d) => sum + d, 0) + modifier;
  return { total, dice, modifier };
}

// mode is "normal", "advantage", or "disadvantage".
// rolls holds every die rolled so the log can show both on advantage.
function rollD20(mode) {
  const first = rollDie(20);
  if (mode === 'normal') {
    return { roll: first, rolls: [first] };
  }

  const second = rollDie(20);
  const roll = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
  return { roll, rolls: [first, second] };
}

module.exports = { rollDie, rollDice, rollD20 };

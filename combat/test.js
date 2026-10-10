// Quick sanity check with no server or browser. Run with: npm test
const { resolveAttack } = require('./attack.js');
const monsters = require('../data/monsters.json');
const characters = require('../data/characters.json');

const catalog = {};
[...monsters, ...characters].forEach((c) => (catalog[c.id] = c));

function token(id, creatureId, name, team, x, y) {
  const c = catalog[creatureId];
  return { id, creatureId, name, team, x, y, hp: c.hp, maxHp: c.hp, defeated: false };
}

// Run one attack many times, resetting HP each time, and report the numbers.
function simulate(label, build, actionName, runs = 5000) {
  let hits = 0;
  let crits = 0;
  let damage = 0;
  for (let i = 0; i < runs; i++) {
    const { tokens, attacker, target } = build();
    const result = resolveAttack({ attacker, target, actionName, tokens, catalog });
    if (!result.ok) {
      console.log(label, 'failed:', result.error);
      return;
    }
    if (result.hit) hits++;
    if (result.crit) crits++;
    damage += result.totalDamage;
  }
  const pct = (n) => ((n / runs) * 100).toFixed(1) + '%';
  console.log(`${label}: hit ${pct(hits)}, crit ${pct(crits)}, avg damage ${(damage / runs).toFixed(2)}`);
}

// Goblin scimitar vs Fighter AC 19: needs a 15+, expect about 30% hits.
simulate('Goblin vs Fighter (melee)', () => {
  const a = token(1, 'goblin', 'Goblin 1', 'monster', 1, 1);
  const t = token(2, 'pc-fighter', 'Dagny', 'player', 2, 1);
  return { tokens: [a, t], attacker: a, target: t };
}, 'Scimitar');

// Fighter with Improved Critical vs Skeleton AC 13: crit on 19 or 20, so about 10%.
simulate('Fighter vs Skeleton (Longsword)', () => {
  const a = token(1, 'pc-fighter', 'Dagny', 'player', 1, 1);
  const t = token(2, 'skeleton', 'Skeleton 1', 'monster', 2, 1);
  return { tokens: [a, t], attacker: a, target: t };
}, 'Longsword');

// Rogue with an ally next to the target gets Sneak Attack, so damage should jump.
simulate('Rogue vs Goblin with ally (Sneak Attack)', () => {
  const a = token(1, 'pc-rogue', 'Wren', 'player', 1, 1);
  const ally = token(3, 'pc-fighter', 'Dagny', 'player', 3, 2);
  const t = token(2, 'goblin', 'Goblin 1', 'monster', 2, 1);
  return { tokens: [a, ally, t], attacker: a, target: t };
}, 'Rapier');

// Wolf with Pack Tactics: should hit more often than a lone wolf.
['alone', 'with pack'].forEach((label) => {
  simulate(`Wolf vs Rogue (${label})`, () => {
    const a = token(1, 'wolf', 'Wolf 1', 'monster', 1, 1);
    const t = token(2, 'pc-rogue', 'Wren', 'player', 2, 1);
    const tokens = [a, t];
    if (label === 'with pack') tokens.push(token(3, 'wolf', 'Wolf 2', 'monster', 3, 1));
    return { tokens, attacker: a, target: t };
  }, 'Bite');
});

// Damage types: a skeleton is vulnerable to bludgeoning and immune to poison.
// Zombie slam is bludgeoning, so the fighter's resistance is not involved here.
simulate('Zombie vs Fighter (Slam)', () => {
  const a = token(1, 'zombie', 'Zombie 1', 'monster', 1, 1);
  const t = token(2, 'pc-fighter', 'Dagny', 'player', 2, 1);
  return { tokens: [a, t], attacker: a, target: t };
}, 'Slam');

// Range checks.
let a = token(1, 'pc-rogue', 'Wren', 'player', 0, 0);
let t = token(2, 'goblin', 'Goblin 1', 'monster', 10, 0); // 50 ft
console.log('Rapier at 50 ft:', resolveAttack({ attacker: a, target: t, actionName: 'Rapier', tokens: [a, t], catalog }).error);
const bow = resolveAttack({ attacker: a, target: t, actionName: 'Shortbow', tokens: [a, t], catalog });
console.log('Shortbow at 50 ft ok:', bow.ok);

// One full example log so you can read what the DM sees.
a = token(1, 'pc-rogue', 'Wren Ashdown', 'player', 1, 1);
t = token(2, 'skeleton', 'Skeleton 1', 'monster', 2, 1);
const sample = resolveAttack({ attacker: a, target: t, actionName: 'Rapier', tokens: [a, t], catalog });
console.log('\nSample DM log:');
sample.dm.forEach((line) => console.log('  ' + line));
console.log('Sample player log:\n  ' + sample.pub);

// Checks the generated 2024 roster. Run with: npm test
const { resolveAttack } = require('./attack.js');
const { feetBetween } = require('../public/rules.js');
const monsters = require('../data/monsters.json');
const characters = require('../data/characters.json');

const catalog = {};
[...monsters, ...characters].forEach((c) => (catalog[c.id] = c));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const goblin = catalog.mmGoblinWarrior0;
const zanna = catalog.ZannaLv050000000;
if (!goblin) fail('Goblin Warrior is missing from monsters.json');
if (!zanna) fail('Level 5 Zanna is missing from characters.json');
if (goblin.ac !== 15) fail(`Goblin AC is ${goblin.ac}`);
if (goblin.token !== 'tokens/humanoid/Goblin.webp') fail(`Goblin token is ${goblin.token}`);
if (goblin.width !== 1 || goblin.height !== 1) fail(`Goblin footprint is ${goblin.width}x${goblin.height}`);

const giant = catalog.mmHillGiant00000;
const dragon = catalog.mmAncientRedDrag;
if (!giant || giant.width !== 3 || giant.height !== 3) fail('Hill Giant is not 3 by 3');
if (!dragon || dragon.width !== 4 || dragon.height !== 4) fail('Ancient Red Dragon is not 4 by 4');
const besideGiant = feetBetween({ x: 1, y: 1, w: 3, h: 3 }, { x: 4, y: 1, w: 1, h: 1 });
if (besideGiant !== 5) fail(`A creature beside a Hill Giant is ${besideGiant} ft away`);

const missile = zanna.actions.find((action) => action.name === 'Magic Missile');
if (!missile || !missile.autoHit) fail('Zanna has no Magic Missile auto-hit');
if (missile.img !== 'icons/magic/light/projectiles-pink-purple.webp') {
  fail(`Magic Missile icon is ${missile.img}`);
}

function token(id, creatureId, name, x, y) {
  const c = catalog[creatureId];
  return { id, creatureId, name, team: c.team, x, y, hp: c.hp, maxHp: c.hp, defeated: false };
}

const attacker = token(1, goblin.id, 'Goblin Warrior 1', 1, 1);
const target = token(2, zanna.id, zanna.name, 2, 1);
const result = resolveAttack({
  attacker,
  target,
  actionName: 'Scimitar',
  tokens: [attacker, target],
  catalog,
});

if (!result.ok) fail(result.error);
if (result.dm[0].indexOf('Scimitar') === -1) fail('Scimitar was not the action that resolved');

console.log(`${goblin.name} AC ${goblin.ac}, token ${goblin.token}`);
console.log(`${zanna.name} ${zanna.class}, Magic Missile ${missile.damage[0].dice} x${missile.damage[0].darts}`);
console.log(result.pub);

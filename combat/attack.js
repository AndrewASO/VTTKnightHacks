const { feetBetween } = require('../public/rules.js');
const { rollDice, rollD20 } = require('./dice.js');
const { collectMods } = require('./mods.js');

function abilityMod(creature, ability) {
  return Math.floor((creature.abilities[ability] - 10) / 2);
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function fail(error) {
  return { ok: false, error };
}

// Finesse takes the better of STR or DEX, ranged weapons use DEX,
// and everything else uses STR.
function weaponAbility(creature, action) {
  const props = action.properties || [];
  if (props.includes('finesse')) {
    return abilityMod(creature, 'dex') > abilityMod(creature, 'str') ? 'dex' : 'str';
  }
  if (props.includes('ranged')) return 'dex';
  return 'str';
}

// Works out the attack bonus and the flat damage bonus for an action.
function attackStats(creature, action) {
  // Monster stat blocks already have the bonus worked out, damage included.
  if (action.toHit !== undefined) {
    return { toHit: action.toHit, damageMod: 0 };
  }

  // Spell attacks use the spellcasting ability and add no damage modifier.
  if (action.attackAbility) {
    const mod = abilityMod(creature, action.attackAbility);
    return { toHit: mod + creature.proficiency, damageMod: 0 };
  }

  // Weapons: assumes the character is proficient with everything they carry.
  const mod = abilityMod(creature, weaponAbility(creature, action));
  return { toHit: mod + creature.proficiency, damageMod: mod };
}

// Applies resistance, immunity, and vulnerability to damage grouped by type.
function applyDefenses(byType, targetCreature) {
  const resist = targetCreature.resist || [];
  const immune = targetCreature.immune || [];
  const vuln = targetCreature.vuln || [];

  return Object.entries(byType).map(([type, amount]) => {
    let final = amount;
    let note = '';

    if (immune.includes(type)) {
      final = 0;
      note = 'immune';
    } else {
      if (resist.includes(type)) {
        final = Math.floor(final / 2);
        note = 'resistant';
      }
      if (vuln.includes(type)) {
        final = final * 2;
        note = note ? 'resistant and vulnerable' : 'vulnerable';
      }
    }

    return { type, amount, final, note };
  });
}

// attacker and target are board tokens. tokens is every token on the board
// (used to find allies and enemies nearby). catalog maps creature ids to data.
// This function only calculates. The caller decides what to do with the result.
function resolveAttack({ attacker, target, actionName, tokens, catalog }) {
  const attackerCreature = catalog[attacker.creatureId];
  const targetCreature = catalog[target.creatureId];
  const action = (attackerCreature.actions || []).find((a) => a.name === actionName);

  if (!action) return fail(`${attacker.name} does not have ${actionName}.`);
  if (attacker.defeated) return fail(`${attacker.name} is defeated.`);
  if (target.defeated) return fail(`${target.name} is already defeated.`);
  if (action.saveAbility) return fail(`${action.name} needs save rules, which are not built yet.`);

  // ---------- Range ----------
  const distance = feetBetween(attacker, target);
  const hasReach = action.reach !== undefined;
  const hasRange = action.range !== undefined;
  let usesRange = false;

  if (hasReach && distance <= action.reach) {
    usesRange = false; // close enough to swing it
  } else if (hasRange && distance <= action.range.long) {
    usesRange = true;
  } else {
    const farthest = hasRange ? action.range.long : action.reach;
    return fail(`${target.name} is ${distance} ft away, but ${action.name} only reaches ${farthest} ft.`);
  }

  // ---------- Situation ----------
  const props = action.properties || [];
  const alliesAdjacentToTarget = tokens.filter((t) => {
    return t.team === attacker.team && t.id !== attacker.id && !t.defeated && feetBetween(t, target) <= 5;
  }).length;

  const hostileAdjacentToAttacker = tokens.some((t) => {
    return t.team !== attacker.team && !t.defeated && feetBetween(t, attacker) <= 5;
  });

  const ctx = {
    mode: 'normal',
    alliesAdjacentToTarget,
    finesseOrRanged: props.includes('finesse') || usesRange,
  };

  // ---------- Advantage and disadvantage ----------
  const advantageFrom = [];
  const disadvantageFrom = [];

  collectMods(attackerCreature, 'attack.roll', ctx).forEach((mod) => {
    if (mod.mode === 'advantage') advantageFrom.push(mod.source);
    if (mod.mode === 'disadvantage') disadvantageFrom.push(mod.source);
  });

  if (usesRange && distance > action.range.normal) disadvantageFrom.push('long range');
  if (usesRange && hostileAdjacentToAttacker) disadvantageFrom.push('hostile within 5 ft');

  // Any advantage cancels any disadvantage, however many sources there are.
  let mode = 'normal';
  if (advantageFrom.length > 0 && disadvantageFrom.length === 0) mode = 'advantage';
  if (disadvantageFrom.length > 0 && advantageFrom.length === 0) mode = 'disadvantage';
  ctx.mode = mode;

  // ---------- Attack roll ----------
  const stats = attackStats(attackerCreature, action);
  const critMods = collectMods(attackerCreature, 'attack.critRange', ctx);
  const critRange = Math.min(20, ...critMods.map((m) => m.value));

  let hit = false;
  let crit = false;
  let natural = null;
  let attackTotal = null;
  let d20 = null;

  if (action.autoHit) {
    hit = true;
  } else {
    d20 = rollD20(mode);
    natural = d20.roll;
    attackTotal = natural + stats.toHit;

    if (natural === 1) {
      hit = false;
    } else if (natural >= critRange) {
      hit = true;
      crit = true;
    } else {
      hit = attackTotal >= targetCreature.ac;
    }
  }

  // ---------- Damage ----------
  const rolled = [];
  let parts = [];
  let totalDamage = 0;

  if (hit) {
    action.damage.forEach((entry, index) => {
      const darts = entry.darts || 1;
      for (let i = 0; i < darts; i++) {
        // Characters add their ability modifier to the first damage entry.
        let dice = entry.dice;
        if (index === 0 && stats.damageMod !== 0) dice += signed(stats.damageMod);

        const r = rollDice(dice, crit);
        const amount = Math.max(0, r.total);
        rolled.push({
          type: entry.type,
          amount,
          text: `${dice}${crit ? ' (dice doubled)' : ''} [${r.dice.join(', ')}] = ${amount} ${entry.type}`,
        });
      }
    });

    // Bonus damage like Sneak Attack takes the weapon's damage type.
    collectMods(attackerCreature, 'damage.bonus', ctx).forEach((mod) => {
      if (mod.mode !== 'add') return;
      const type = action.damage[0].type;
      const r = rollDice(mod.value, crit);
      rolled.push({
        type,
        amount: r.total,
        text: `${mod.source} ${mod.value}${crit ? ' (dice doubled)' : ''} [${r.dice.join(', ')}] = ${r.total} ${type}`,
      });
    });

    const byType = {};
    rolled.forEach((r) => {
      byType[r.type] = (byType[r.type] || 0) + r.amount;
    });

    parts = applyDefenses(byType, targetCreature);
    totalDamage = parts.reduce((sum, p) => sum + p.final, 0);
  }

  const hpBefore = target.hp;
  const hpAfter = Math.max(0, hpBefore - totalDamage);
  const defeated = hpAfter === 0;

  // ---------- Log text ----------
  const dm = [];
  dm.push(`${attacker.name} attacks ${target.name} with ${action.name} (${distance} ft).`);

  if (advantageFrom.length > 0) dm.push(`Advantage from: ${advantageFrom.join(', ')}.`);
  if (disadvantageFrom.length > 0) dm.push(`Disadvantage from: ${disadvantageFrom.join(', ')}.`);
  if (advantageFrom.length > 0 && disadvantageFrom.length > 0) dm.push('They cancel out, so a normal roll.');

  if (action.autoHit) {
    dm.push('Automatic hit, no attack roll.');
  } else {
    const rollsText = d20.rolls.length > 1 ? `Rolled ${d20.rolls.join(' and ')}, took ${natural}.` : `Rolled ${natural}.`;
    let verdict = hit ? 'hit' : 'miss';
    if (natural === 1) verdict = 'natural 1, miss';
    if (crit) verdict = natural === 20 ? 'natural 20, critical hit' : `${natural} is in crit range, critical hit`;
    dm.push(`${rollsText} ${natural} ${signed(stats.toHit)} = ${attackTotal} vs AC ${targetCreature.ac}: ${verdict}.`);
  }

  if (hit) {
    rolled.forEach((r) => dm.push(r.text));
    parts.forEach((p) => {
      const note = p.note ? ` (${p.note})` : '';
      dm.push(`${p.type}: ${p.amount} becomes ${p.final}${note}.`);
    });
    dm.push(`${target.name}: ${hpBefore} to ${hpAfter} HP.${defeated ? ' Defeated.' : ''}`);
  }

  // Players only see the outcome, never rolls, AC, or resistances.
  let pub;
  if (!hit) {
    pub = `${attacker.name} misses ${target.name}.`;
  } else if (totalDamage === 0) {
    pub = `${attacker.name} hits ${target.name}, but it does no damage.`;
  } else {
    const verb = crit ? 'critically hits' : 'hits';
    pub = `${attacker.name} ${verb} ${target.name} for ${totalDamage} damage${crit ? '!' : '.'}`;
  }
  if (defeated) pub += ` ${target.name} is defeated.`;

  let outcome = 'miss';
  if (hit) outcome = crit ? 'crit' : 'hit';

  return { ok: true, outcome, hit, crit, totalDamage, hpBefore, hpAfter, defeated, dm, pub };
}

module.exports = { resolveAttack };

// Traits and features carry a "mods" list in the JSON data. This file reads
// those lists, so adding a new trait is mostly a data change.

// Each "when" name in the data maps to a yes/no check on the current attack.
// ctx is the attack situation: { mode, alliesAdjacentToTarget, finesseOrRanged }
const conditions = {
  allyAdjacentToTarget: (ctx) => ctx.alliesAdjacentToTarget > 0,

  // Sneak Attack needs a finesse or ranged weapon, then either advantage,
  // or an ally next to the target as long as there is no disadvantage.
  sneakAttack: (ctx) => {
    if (!ctx.finesseOrRanged) return false;
    if (ctx.mode === 'advantage') return true;
    return ctx.mode === 'normal' && ctx.alliesAdjacentToTarget > 0;
  },
};

// Returns every mod on this creature with the given key whose condition passes.
// Each result remembers its source name so the combat log can explain itself.
function collectMods(creature, key, ctx) {
  const found = [];
  const sources = [...(creature.features || []), ...(creature.traits || [])];

  sources.forEach((source) => {
    (source.mods || []).forEach((mod) => {
      if (mod.key !== key) return;

      if (mod.when) {
        const check = conditions[mod.when];
        // An unknown condition name is ignored rather than crashing a fight.
        if (!check || !check(ctx)) return;
      }

      found.push({ ...mod, source: source.name });
    });
  });

  return found;
}

module.exports = { conditions, collectMods };

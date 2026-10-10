import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as YAML from "js-yaml";

/**
 * Read the 2024 SRD packs only and write a combat catalog.
 * Combat comes from system.activities. Creature tokens come from
 * json/fa-token-mapping.json when the file exists in this repo.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "packs/_source");
const OUT = path.join(ROOT, "data/2024");

const PACKS = [
  "actors24",
  "classes24",
  "content24",
  "equipment24",
  "feats24",
  "monsterfeatures24",
  "origins24",
  "spells24",
  "tables24"
];

const ACTIVITY_TYPES = new Set([
  "attack", "cast", "check", "damage", "enchant", "forward",
  "heal", "order", "save", "summon", "teleport", "transform", "utility"
]);

const tokenMap = JSON.parse(
  fs.readFileSync(path.join(ROOT, "json/fa-token-mapping.json"), "utf8")
)["dnd5e.actors24"] ?? {};

const tokenByName = indexTokenFiles(path.join(ROOT, "tokens"));

/**
 * Collect YAML files under a pack directory.
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walkYml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYml(full, out);
    else if (entry.name.endsWith(".yml")) out.push(full);
  }
  return out;
}

/**
 * Index token artwork by filename. Exact matches only, so Hippopotamus cannot pick up Hippocampus.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function indexTokenFiles(dir) {
  /** @type {Map<string, string[]>} */
  const grouped = new Map();
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "thumbs") continue;
        walk(full);
      } else if (entry.name.endsWith(".webp")) {
        const key = entry.name.slice(0, -5).toLowerCase().replace(/[^a-z0-9]/g, "");
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        const list = grouped.get(key) ?? [];
        list.push(rel);
        grouped.set(key, list);
      }
    }
  };
  walk(dir);
  const unique = new Map();
  for (const [key, files] of grouped) {
    if (files.length === 1) unique.set(key, files[0]);
  }
  return unique;
}

/**
 * Turn a Foundry asset path into a repo-relative path when the file exists.
 * @param {string} foundryPath
 * @returns {string|null}
 */
function localAsset(foundryPath) {
  if (typeof foundryPath !== "string" || foundryPath.length === 0) return null;
  const rel = foundryPath.replace(/^systems\/dnd5e\//, "");
  if (rel.startsWith("modules/") || rel.startsWith("http")) return null;
  if (!fs.existsSync(path.join(ROOT, rel))) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Read the rules edition stored on a document.
 * @param {object|undefined} system
 * @returns {string|null}
 */
function rulesOf(system) {
  const rules = system?.source?.rules;
  if (rules == null || rules === "") return null;
  return String(rules);
}

/**
 * Build a dice formula from one Foundry damage part.
 * @param {object} part
 * @param {object} [options]
 * @returns {object|null}
 */
function damagePart(part, options = {}) {
  if (!part || typeof part !== "object") return null;
  let formula = "";
  if (part.custom?.enabled && part.custom.formula) formula = String(part.custom.formula);
  else {
    const number = part.number ?? 0;
    const denomination = part.denomination ?? 0;
    if (number && denomination) formula = `${number}d${denomination}`;
    if (part.bonus) formula = formula ? `${formula} + ${part.bonus}` : String(part.bonus);
  }
  if (!formula) return null;
  const scaling = part.scaling ?? {};
  const record = {
    formula,
    types: Array.isArray(part.types) ? part.types : []
  };
  if (options.base) record.base = true;
  if (options.addsAbilityModifier) record.addsAbilityModifier = true;
  if (scaling.mode || scaling.formula) {
    record.scaling = {
      mode: scaling.mode || null,
      number: scaling.number ?? null,
      formula: scaling.formula || ""
    };
  }
  return record;
}

/**
 * Weapon base damage is prepended when an attack activity sets includeBase.
 * Foundry then adds @mod to that base part for weapon dice.
 * @param {object} item
 * @param {object} activity
 * @returns {object[]}
 */
function attackDamageParts(item, activity) {
  const damage = activity.damage ?? {};
  const parts = [];
  const offersBase = item?.type === "weapon"
    || (item?.type === "consumable" && item.system?.type?.value === "ammo");
  if (damage.includeBase !== false && offersBase) {
    const base = damagePart(item.system?.damage?.base, { base: true });
    if (base) {
      const classification = activity.attack?.type?.classification;
      const naturalSpell = classification === "spell" && item.system?.type?.value === "natural";
      const dice = /\d*d\d+/i.test(base.formula);
      if (item.type === "weapon" && dice && !naturalSpell) base.addsAbilityModifier = true;
      parts.push(base);
    }
  }
  for (const part of damage.parts ?? []) {
    const parsed = damagePart(part);
    if (parsed) parts.push(parsed);
  }
  return parts;
}

/**
 * Copy the fields that belong to one activity type.
 * @param {object} activity
 * @param {object} item
 * @returns {object}
 */
function activityDetail(activity, item) {
  switch (activity.type) {
    case "attack":
      return {
        attack: {
          ability: activity.attack?.ability || null,
          bonus: activity.attack?.bonus || "",
          flat: Boolean(activity.attack?.flat),
          type: activity.attack?.type?.value || null,
          classification: activity.attack?.type?.classification || null,
          criticalThreshold: activity.attack?.critical?.threshold ?? null
        },
        damage: {
          includeBase: activity.damage?.includeBase !== false,
          criticalBonus: activity.damage?.critical?.bonus || "",
          parts: attackDamageParts(item, activity)
        }
      };
    case "save":
      return {
        save: {
          ability: activity.save?.ability ?? null,
          bonus: activity.save?.bonus || "",
          dc: {
            calculation: activity.save?.dc?.calculation || null,
            formula: activity.save?.dc?.formula || ""
          }
        },
        damage: {
          onSave: activity.damage?.onSave || "half",
          parts: (activity.damage?.parts ?? []).map(part => damagePart(part)).filter(Boolean)
        }
      };
    case "damage":
      return {
        damage: {
          criticalBonus: activity.damage?.critical?.bonus || "",
          allowCritical: activity.damage?.critical?.allow ?? null,
          parts: (activity.damage?.parts ?? []).map(part => damagePart(part)).filter(Boolean)
        }
      };
    case "heal":
      return { healing: damagePart(activity.healing) };
    case "check":
      return {
        check: {
          ability: activity.check?.ability || null,
          associated: activity.check?.associated ?? [],
          bonus: activity.check?.bonus || "",
          dc: {
            calculation: activity.check?.dc?.calculation || null,
            formula: activity.check?.dc?.formula || ""
          }
        }
      };
    case "cast":
      return {
        spell: {
          uuid: activity.spell?.uuid || null,
          ability: activity.spell?.ability || null,
          level: activity.spell?.level ?? null,
          challenge: activity.spell?.challenge ?? null
        }
      };
    case "summon":
      return {
        summon: activity.summon ?? null,
        profiles: activity.profiles ?? [],
        bonuses: activity.bonuses ?? null
      };
    case "transform":
      return {
        transform: activity.transform ?? null,
        profiles: activity.profiles ?? []
      };
    case "teleport":
      return { teleport: activity.teleport ?? null };
    case "utility":
      return { roll: activity.roll ?? null };
    case "enchant":
      return {
        enchant: activity.enchant ?? null,
        restrictions: activity.restrictions ?? null
      };
    case "forward":
      return { activityId: activity.activity?.id || null };
    case "order":
      return { order: activity.order || null };
    default:
      return {};
  }
}

/**
 * Normalize an activities map or array into a list.
 * @param {object|undefined} activities
 * @returns {object[]}
 */
function activityList(activities) {
  if (!activities) return [];
  const values = Array.isArray(activities) ? activities : Object.values(activities);
  return values.filter(activity => activity && typeof activity === "object" && activity.type);
}

/**
 * Flatten one activity into the combat record written to disk.
 * @param {object} activity
 * @param {object} parent
 * @returns {object}
 */
function normalizeActivity(activity, parent) {
  const range = activity.range ?? {};
  const activation = activity.activation ?? {};
  const duration = activity.duration ?? {};
  const affects = activity.target?.affects ?? {};
  const template = activity.target?.template ?? {};
  return {
    id: activity._id || null,
    type: activity.type,
    name: activity.name || parent.itemName,
    sort: activity.sort ?? 0,
    rules: parent.rules,
    pack: parent.pack,
    sourcePath: parent.sourcePath,
    documentId: parent.documentId,
    documentName: parent.documentName,
    documentType: parent.documentType,
    itemId: parent.itemId,
    itemName: parent.itemName,
    itemType: parent.itemType,
    activation: {
      type: activation.type || null,
      value: activation.value ?? null,
      condition: activation.condition || ""
    },
    range: {
      value: range.value ?? null,
      units: range.units || null,
      special: range.special || ""
    },
    target: {
      affects: affects.type || null,
      count: affects.count || null,
      template: template.type || null
    },
    duration: {
      value: duration.value || "",
      units: duration.units || null,
      concentration: Boolean(duration.concentration)
    },
    consumption: {
      spellSlot: activity.consumption?.spellSlot ?? null,
      scaling: activity.consumption?.scaling ?? null
    },
    ...activityDetail(activity, parent.item)
  };
}

/**
 * Resolve a creature token from the Forgotten Adventures mapping, then by filename.
 * @param {object} doc
 * @returns {object|null}
 */
function resolveToken(doc) {
  const mapped = tokenMap[doc._id];
  const proto = doc.prototypeToken ?? {};
  let src = null;
  let scaleX = null;
  let scaleY = null;
  let width = null;
  let height = null;
  const token = mapped?.token;
  if (typeof token === "string") src = token;
  else if (token && typeof token === "object") {
    src = token.texture?.src ?? null;
    scaleX = token.texture?.scaleX ?? null;
    scaleY = token.texture?.scaleY ?? null;
    width = token.width ?? null;
    height = token.height ?? null;
  }
  if (!src) src = proto.texture?.src ?? null;
  let file = localAsset(src);
  if (!file && doc.name) {
    const key = doc.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    file = tokenByName.get(key) ?? null;
  }
  let thumb = localAsset(typeof mapped?.actor === "string" ? mapped.actor : null);
  if (!thumb && file?.startsWith("tokens/")) {
    thumb = localAsset(file.replace(/^tokens\//, "tokens/thumbs/"));
  }
  if (!file && !thumb) return null;
  return {
    src: file,
    thumb: thumb && thumb !== file ? thumb : null,
    width: width ?? proto.width ?? null,
    height: height ?? proto.height ?? null,
    scaleX: scaleX ?? proto.texture?.scaleX ?? null,
    scaleY: scaleY ?? proto.texture?.scaleY ?? null,
    credit: file?.startsWith("tokens/") ? "Forgotten Adventures" : null
  };
}

/**
 * Copy the combat stats needed to put a creature on the table.
 * @param {object} doc
 * @returns {object}
 */
function actorSheet(doc) {
  const abilities = {};
  for (const [key, score] of Object.entries(doc.system?.abilities ?? {})) {
    if (score && typeof score === "object" && score.value != null) abilities[key] = score.value;
  }
  const attributes = doc.system?.attributes ?? {};
  const movement = {};
  for (const key of ["walk", "fly", "swim", "climb", "burrow"]) {
    const value = attributes.movement?.[key];
    if (value) movement[key] = value;
  }
  const details = doc.system?.details ?? {};
  const kind = details.type;
  return {
    abilities,
    ac: attributes.ac ? {
      flat: attributes.ac.flat ?? null,
      calc: attributes.ac.calc ?? null,
      formula: attributes.ac.formula || ""
    } : null,
    hp: attributes.hp ? {
      value: attributes.hp.value ?? null,
      max: attributes.hp.max ?? null,
      formula: attributes.hp.formula || ""
    } : null,
    movement,
    movementUnits: attributes.movement?.units || null,
    creatureType: kind && typeof kind === "object"
      ? { value: kind.value ?? null, subtype: kind.subtype ?? null }
      : (kind ?? null),
    cr: details.cr ?? null
  };
}

/**
 * Append combat activities from an item, skipping 2014 source entries.
 * @param {object} item
 * @param {object} parent
 * @param {object[]} sink
 */
function collectItemActivities(item, parent, sink) {
  if (rulesOf(item.system) === "2014") {
    parent.skippedLegacyItems += 1;
    return;
  }
  const context = {
    ...parent,
    rules: rulesOf(item.system) ?? parent.rules,
    item,
    itemId: item._id || parent.documentId,
    itemName: item.name || parent.documentName,
    itemType: item.type || parent.documentType
  };
  for (const activity of activityList(item.system?.activities)) {
    sink.push(normalizeActivity(activity, context));
  }
}

fs.mkdirSync(OUT, { recursive: true });

const catalog = fs.createWriteStream(path.join(OUT, "catalog.jsonl"));
const activitiesOut = fs.createWriteStream(path.join(OUT, "activities.jsonl"));
const actorsOut = fs.createWriteStream(path.join(OUT, "actors.jsonl"));

const summary = {
  rules: "2024",
  packs: PACKS,
  documents: 0,
  skippedLegacyDocuments: 0,
  skippedLegacyItems: 0,
  activities: 0,
  actors: 0,
  actorsWithToken: 0,
  actorsMissingToken: 0,
  activityTypes: {},
  byPack: {},
  parseErrors: []
};

/** @type {object|null} */
let goblin = null;

for (const pack of PACKS) {
  const packDir = path.join(SOURCE, pack);
  summary.byPack[pack] = { documents: 0, activities: 0 };
  for (const file of walkYml(packDir)) {
    const sourcePath = path.relative(ROOT, file).split(path.sep).join("/");
    let doc;
    try {
      doc = YAML.load(fs.readFileSync(file, "utf8"));
    } catch (error) {
      summary.parseErrors.push({ sourcePath, message: error.message });
      continue;
    }
    if (!doc || typeof doc !== "object") continue;
    if (rulesOf(doc.system) === "2014") {
      summary.skippedLegacyDocuments += 1;
      continue;
    }

    summary.documents += 1;
    summary.byPack[pack].documents += 1;
    catalog.write(`${JSON.stringify({
      pack,
      id: doc._id || null,
      name: doc.name || null,
      type: doc.type || (path.basename(file) === "_folder.yml" ? "folder" : null),
      rules: rulesOf(doc.system),
      sourcePath
    })}\n`);

    const parent = {
      pack,
      sourcePath,
      rules: rulesOf(doc.system) ?? "2024",
      documentId: doc._id || null,
      documentName: doc.name || null,
      documentType: doc.type || null,
      skippedLegacyItems: 0
    };
    const found = [];
    collectItemActivities(doc, parent, found);
    for (const item of doc.items ?? []) collectItemActivities(item, parent, found);
    summary.skippedLegacyItems += parent.skippedLegacyItems;

    for (const activity of found) {
      if (!ACTIVITY_TYPES.has(activity.type)) {
        summary.parseErrors.push({
          sourcePath,
          message: `Unknown activity type ${activity.type}`
        });
      }
      summary.activities += 1;
      summary.byPack[pack].activities += 1;
      summary.activityTypes[activity.type] = (summary.activityTypes[activity.type] ?? 0) + 1;
      activitiesOut.write(`${JSON.stringify(activity)}\n`);
    }

    if (pack === "actors24" && doc.type === "npc") {
      const token = resolveToken(doc);
      const actor = {
        id: doc._id || null,
        name: doc.name || null,
        pack,
        sourcePath,
        rules: parent.rules,
        token,
        ...actorSheet(doc),
        activities: found
      };
      summary.actors += 1;
      if (token?.src) summary.actorsWithToken += 1;
      else summary.actorsMissingToken += 1;
      actorsOut.write(`${JSON.stringify(actor)}\n`);
      if (doc._id === "mmGoblinWarrior0") goblin = actor;
    }
  }
}

catalog.end();
activitiesOut.end();
actorsOut.end();

await Promise.all([
  onceFinished(catalog),
  onceFinished(activitiesOut),
  onceFinished(actorsOut)
]);

const failures = [];
if (!goblin) failures.push("Goblin Warrior mmGoblinWarrior0 was not parsed");
else {
  if (goblin.token?.src !== "tokens/humanoid/Goblin.webp") {
    failures.push(`Goblin token src is ${goblin.token?.src}`);
  } else if (!fs.existsSync(path.join(ROOT, goblin.token.src))) {
    failures.push("Goblin token file is missing");
  }
  const scimitar = goblin.activities.find(activity =>
    activity.itemName === "Scimitar" && activity.type === "attack" && activity.damage?.includeBase
  );
  const base = scimitar?.damage?.parts?.find(part => part.base);
  if (!base || base.formula !== "1d6" || !base.types?.includes("slashing") || !base.addsAbilityModifier) {
    failures.push("Goblin Scimitar base damage was not parsed as 1d6 slashing plus ability modifier");
  }
}
if (summary.skippedLegacyDocuments + summary.skippedLegacyItems < 1) {
  failures.push("Expected to drop embedded 2014 items found inside actors24");
}

const legacyLeft = await countLegacy(path.join(OUT, "activities.jsonl"));
if (legacyLeft) failures.push(`${legacyLeft} activities still tagged rules 2014`);

summary.checked = failures.length === 0;
summary.failures = failures;
fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(summary, null, 2)}\n`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  documents: summary.documents,
  activities: summary.activities,
  actors: summary.actors,
  actorsWithToken: summary.actorsWithToken,
  actorsMissingToken: summary.actorsMissingToken,
  skippedLegacyDocuments: summary.skippedLegacyDocuments,
  skippedLegacyItems: summary.skippedLegacyItems,
  activityTypes: summary.activityTypes
}, null, 2));

/**
 * Wait until a write stream finishes.
 * @param {fs.WriteStream} stream
 * @returns {Promise<void>}
 */
function onceFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

/**
 * Count activity records that are still tagged as 2014.
 * @param {string} file
 * @returns {Promise<number>}
 */
async function countLegacy(file) {
  const text = await fs.promises.readFile(file, "utf8");
  let count = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (JSON.parse(line).rules === "2014") count += 1;
  }
  return count;
}

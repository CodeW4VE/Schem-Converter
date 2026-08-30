// Translates a modern (1.13+) item id down to its pre-Flattening 1.12
// {name, damage} form, using data/legacy-items.json (data/vendor/legacy.json's
// `items` table via scripts/build-blockdata.js - see PLAN.md "B4"). Mirrors
// how lib/flattening.js inverts the block map, one level simpler: items have
// no properties, just an "id:meta" -> flat-name mapping to invert.
//
// Unlike data/vendor/block_state_map.json, this table comes straight from
// minecraft-data (Apache/CC), so it carries no LGPL question and lives in
// data/ rather than data/vendor/.

const legacyItems = require('../data/legacy-items.json'); // {"35:14": "minecraft:red_wool", ...}
const pre1_12 = require('../data/items-1.12.2.json'); // {items: [{id,name}], enchantments: [{id,name}]}

function stripPrefix(name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function buildItemIndex() {
  const idToName = new Map(pre1_12.items.map(i => [i.id, i.name]));
  const byModernName = new Map();

  for (const [idMeta, flatName] of Object.entries(legacyItems)) {
    const [idStr, metaStr] = idMeta.split(':');
    const id = Number(idStr);
    const meta = Number(metaStr);
    const name = idToName.get(id);
    if (!name) continue; // id has no 1.12.2 item (a block-only id, e.g. air)

    const modernName = stripPrefix(flatName);
    const rank = id * 16 + meta; // lower id:meta preferred, same tie-break as lib/flattening.js
    const existing = byModernName.get(modernName);
    if (!existing || rank < existing._rank) byModernName.set(modernName, { name, damage: meta, _rank: rank });
  }
  return byModernName;
}

let itemIndex;
function getItemIndex() {
  if (!itemIndex) itemIndex = buildItemIndex();
  return itemIndex;
}

// Returns {name, damage} - 1.12.2 item name (no "minecraft:" prefix) and its
// Damage value - or null if `shortName` has no entry in legacy.json (either
// genuinely new, or an id-only entry with no 1.12.2 item, e.g. a block-item
// legacy.json only tracked for the block conversion side).
function resolveLegacyItem(shortName) {
  const hit = getItemIndex().get(shortName);
  return hit ? { name: hit.name, damage: hit.damage } : null;
}

const enchantmentIdByName = new Map(pre1_12.enchantments.map(e => [e.name, e.id]));
const enchantmentNameById = new Map(pre1_12.enchantments.map(e => [e.id, e.name]));

// 1.12 `ench:[{id,lvl}]` uses these numeric ids instead of 1.13+'s namespaced
// strings (`Enchantments:[{id:"minecraft:sharpness",lvl}]`). Returns null for
// an enchantment 1.12.2 doesn't have (mending, all the 1.13+ additions).
function legacyEnchantmentId(shortName) {
  return enchantmentIdByName.has(shortName) ? enchantmentIdByName.get(shortName) : null;
}

function enchantmentNameFromLegacyId(id) {
  return enchantmentNameById.get(id) || null;
}

module.exports = { resolveLegacyItem, legacyEnchantmentId, enchantmentNameFromLegacyId };

// Rewrites a Litematica BlockStatePalette entry-by-entry against a target
// Minecraft version's real block list, so blocks that don't exist there stop
// silently vanishing.
//
// Operates on plain JS objects ({name, properties}), not NBT compounds -
// lib/convert.js does the NBT <-> plain conversion. Keeping this file NBT-free
// is what makes it testable without building fake NBT trees.
//
// Palette length is never changed: one entry always maps to exactly one
// entry. Litematica packs BlockStates indices at ceil(log2(paletteSize))
// bits, so changing the count would require repacking that bit array, which
// this deliberately avoids.
//
// data/substitutions.json's `chains`/`explicit` entries must be an OBVIOUS
// match - same material/texture family (deepslate -> stone, crimson_stem ->
// dark_oak_log), same decorative category (a flower -> another flower), or a
// real functional equivalent (barrel -> chest, smoker -> furnace). A block
// with no such match (composter, honey_block, ancient_debris, bell, every
// workstation -> crafting_table, ...) got removed after user feedback: a
// misleading lookalike is worse than the command_block marker, because
// nothing about it hints that the original is gone. When in doubt, marker.

const substitutions = require('../data/substitutions.json');

function stripPrefix(name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

// Renames apply in both directions: a block that was simply renamed between
// versions (e.g. sign -> oak_sign in 1.14) needs the reverse lookup too when
// *upgrading* - the old name is missing from a newer target exactly the same
// way the new name is missing from an older one.
const renameMap = new Map();
for (const [a, b] of substitutions.renames) {
  renameMap.set(a, b);
  renameMap.set(b, a);
}

// Every substitution table is a graph edge: name -> one or more candidate
// names that might be the right answer. A single tier's candidate can itself
// be missing from the target (e.g. exposed_copper -materialRule-> copper,
// which is also not a real block, -chain-> orange_terracotta) - that's why
// this returns *all* next hops instead of picking one, and findSubstitute
// below walks them breadth-first until something actually exists.
// extraChains: an optional second `chains`-shaped table (name -> candidate
// list), consulted alongside the block tables. Used by lib/items.js to feed
// in `itemRules` without duplicating this whole graph - see PLAN.md "B1":
// every block-shaped rule here (material renames, prefix strips, ...) is
// equally valid to try on an item name, and a wrong candidate is harmless
// because it's existence-checked before being accepted either way.
function nextCandidates(name, extraChains) {
  const out = [];
  if (renameMap.has(name)) out.push(renameMap.get(name));
  if (substitutions.splits[name]) out.push(substitutions.splits[name].to);
  if (substitutions.explicit[name]) out.push(substitutions.explicit[name]);
  if (substitutions.chains[name]) out.push(...substitutions.chains[name]);
  if (extraChains && extraChains[name]) out.push(...extraChains[name]);
  for (const [from, to] of substitutions.materialRules) {
    if (name.includes(from)) out.push(name.split(from).join(to));
  }
  for (const prefix of substitutions.prefixStrip) {
    if (name.startsWith(prefix)) out.push(name.slice(prefix.length));
  }
  for (const [prefix, candidates] of Object.entries(substitutions.prefixChains)) {
    if (name.startsWith(prefix)) out.push(...candidates);
  }
  for (const [suffix, candidates] of Object.entries(substitutions.shapeSuffixChains)) {
    if (name.endsWith(suffix)) out.push(...candidates);
  }
  return out;
}

// Breadth-first search over the substitution graph: tries every generator's
// output for `shortName` first (closest / most specific answers), then their
// outputs, and so on, verifying each candidate actually exists in the target
// block (or item, via extraChains) list before accepting it. Falls back to
// the command_block marker only once the graph is exhausted with nothing
// found - see PLAN.md "the fix" for why a single-pass tier walk (the previous
// implementation) missed most of these: a candidate one tier produces can
// itself need substituting.
function findSubstitute(shortName, targetBlocks, extraChains) {
  const seen = new Set([shortName]);
  const queue = nextCandidates(shortName, extraChains);

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    if (targetBlocks[candidate]) return candidate;
    queue.push(...nextCandidates(candidate, extraChains));
  }

  return substitutions.marker;
}

// Drops properties the target doesn't recognize for this block, drops
// invalid values, and fills in anything missing from the target's defaults.
function fixProperties(blockInfo, properties) {
  const fixed = {};
  for (const [key, values] of Object.entries(blockInfo.properties)) {
    if (properties && Object.prototype.hasOwnProperty.call(properties, key)) {
      const value = properties[key];
      fixed[key] = values.includes(value) ? value : blockInfo.defaults[key];
    } else {
      fixed[key] = blockInfo.defaults[key];
    }
  }
  return fixed;
}

// entry: {name: 'minecraft:oak_log', properties: {axis: 'x'}}
// targetData: one of the data/blocks-<version>.json files (loadBlockData()).
// Returns {name, properties, substitutedFrom} - substitutedFrom is set only
// when the name changed, for the report.
function convertPaletteEntry(entry, targetData) {
  const shortName = stripPrefix(entry.name);
  let targetName = shortName;
  let sourceProperties = entry.properties;

  if (!targetData.blocks[targetName]) {
    const split = substitutions.splits[shortName];
    if (split && targetData.blocks[split.to]) {
      // A block that was split into several in a newer version (e.g. 1.17's
      // cauldron -> water_cauldron/lava_cauldron/powder_snow_cauldron) needs
      // its per-instance data (the fill level) carried across, not just the
      // name swapped - the generic fixProperties below can't recover a value
      // this block never carried under its own name. Must run before that
      // call, with the level already merged in, so it validates as a normal
      // (already-correct) property instead of being defaulted away.
      targetName = split.to;
      const level = split.carryLevel && sourceProperties && sourceProperties.level !== undefined
        ? sourceProperties.level
        : split.defaultLevel;
      sourceProperties = { ...sourceProperties, level };
    } else {
      targetName = findSubstitute(shortName, targetData.blocks);
    }
  }

  const blockInfo = targetData.blocks[targetName];
  const properties = fixProperties(blockInfo, sourceProperties);

  const result = { name: `minecraft:${targetName}`, properties };
  if (targetName !== shortName) result.substitutedFrom = `minecraft:${shortName}`;
  return result;
}

// palette: array of {name, properties} in original order.
// Returns {palette, report} - report is an array of {from, to} for every
// entry whose block name changed, deduplicated.
function convertPalette(palette, targetData) {
  const converted = palette.map(entry => convertPaletteEntry(entry, targetData));

  const seen = new Set();
  const report = [];
  for (const entry of converted) {
    if (!entry.substitutedFrom) continue;
    const key = `${entry.substitutedFrom}=>${entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    report.push({ from: entry.substitutedFrom, to: entry.name });
  }

  return {
    palette: converted.map(({ name, properties }) => ({ name, properties })),
    report,
  };
}

module.exports = { convertPalette, convertPaletteEntry, findSubstitute, fixProperties };

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

const substitutions = require('../data/substitutions.json');

function stripPrefix(name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

// Tries the four substitution tiers in order, verifying each candidate
// actually exists in the target block list before accepting it.
function findSubstitute(shortName, targetBlocks) {
  const explicit = substitutions.explicit[shortName];
  if (explicit && targetBlocks[explicit]) return explicit;

  for (const [from, to] of substitutions.materialRules) {
    if (shortName.includes(from)) {
      const candidate = shortName.split(from).join(to);
      if (targetBlocks[candidate]) return candidate;
    }
  }

  for (const [suffix, fallback] of Object.entries(substitutions.shapeSuffixes)) {
    if (shortName.endsWith(suffix) && targetBlocks[fallback]) return fallback;
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

  if (!targetData.blocks[targetName]) {
    targetName = findSubstitute(shortName, targetData.blocks);
  }

  const blockInfo = targetData.blocks[targetName];
  const properties = fixProperties(blockInfo, entry.properties);

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

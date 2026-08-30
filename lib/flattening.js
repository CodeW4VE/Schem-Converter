// Translates a normalized 1.13+ blockstate down to its pre-Flattening 1.12
// {Name, Properties} form, using the mapping data vendored from Litematica
// itself (data/vendor/block_state_map.json - see NOTICE.md for license/origin).
//
// Callers MUST run lib/palette.js's property fixup against 1.13.2 block data
// *before* calling flattenState - see PLAN.md "Ordering: run the Phase 4
// property fixup before the flattening lookup". ~76 1.13 block families only
// fail to match here because they still carry a property 1.12 never had
// (waterlogged, powered, leaf distance, chest type); stripping those first is
// what makes the exact-match lookup succeed for the vast majority of blocks.
//
// Per-instance data that 1.13+ moved OUT of the blockstate and INTO a value
// 1.12 could only store per-instance (note_block pitch, skull type, skull
// rotation, banner color, bed color) is intentionally lost at the STATE
// level here - flattenState alone can only produce that family's default
// 1.12 state (a colored bed just becomes "bed"). The true per-instance value
// is restored separately in lib/convert.js's
// applyPreFlatteningTileEntityValues, which decodes the packed BlockStates
// bit array (lib/blockstates.js) to find each matching position and writes
// the real value into that position's TileEntities entry (lib/tile-entity-1-12.js),
// using the pre-flattening `normalized` entry this function never sees.

const vendor = require('../data/vendor/block_state_map.json').block_states;
const substitutions = require('../data/substitutions.json');

function stripPrefix(name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function stateKey(name, properties) {
  const props = Object.entries(properties || {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${stripPrefix(name)}|${props}`;
}

// Explicit 1.13-side states that block_state_map.json has no entry for at
// all (see PLAN.md Phase 6 "the rest of the 144 unmapped blocks").
const EXPLICIT_1_13_TO_1_12 = {
  'cave_air|': { block: 'minecraft:air', properties: {} },
  'void_air|': { block: 'minecraft:air', properties: {} },
  'pumpkin|': { block: 'minecraft:pumpkin', properties: { facing: 'north' } },
  // A bubble column IS water (with bubbles added by a magma/soul-sand block
  // below it, which isn't recorded in this blockstate) - the exact same
  // level:0 source state a plain 1.13 'water' block already flattens to via
  // the vendor map's own tie-break, not a lookalike guess. Only reachable
  // for the 1.12.2 target: bubble_column exists in every other supported
  // version, so lib/palette.js's resolver never sees it.
  'bubble_column|drag=false': { block: 'minecraft:flowing_water', properties: { level: '0' } },
  'bubble_column|drag=true': { block: 'minecraft:flowing_water', properties: { level: '0' } },
};

// attached_*_stem is always fully grown (1.13's unattached stem tracks 'age'
// 0-7 but has no 'facing' - the 1.12 side is what carries facing, and only
// for the age=7/fully-grown state, since that's the only age an attached
// stem can be at).
function attachedStemBaseKey(shortName) {
  if (shortName !== 'attached_pumpkin_stem' && shortName !== 'attached_melon_stem') return null;
  return stateKey(shortName.replace('attached_', ''), { age: '7' });
}

// Only the *default*-colour/type member of these families is in the vendor
// map (see PLAN.md "Kind B" - the other colours/types live in 1.12 tile
// entity data, not the blockstate, so there's no state for them to map from).
// Rather than fall through to the command_block marker and lose the block
// entirely, alias every other member of the family to the mapped one, so a
// bed downgrades to a bed - see the header comment on why the *colour* is
// what's lost, not the block identity.
const FAMILY_ALIAS_SUFFIX = [
  ['_wall_banner', 'white_wall_banner'],
  ['_banner', 'white_banner'],
  ['_wall_skull', 'skeleton_wall_skull'],
  ['_wall_head', 'skeleton_wall_skull'],
  ['_skull', 'skeleton_skull'],
  ['_head', 'skeleton_skull'],
  ['_bed', 'red_bed'],
  // Buttons, pressure plates and trapdoors only existed for oak (+ stone,
  // for buttons/plates) in 1.12 - other wood types were added in 1.13.
  // Doors are unaffected: 1.12 already had one door block per species.
  ['_button', 'oak_button'],
  ['_pressure_plate', 'oak_pressure_plate'],
  ['_trapdoor', 'oak_trapdoor'],
];

function familyAlias(shortName) {
  for (const [suffix, aliasTo] of FAMILY_ALIAS_SUFFIX) {
    if (shortName.endsWith(suffix)) return aliasTo;
  }
  return null;
}

// "stripped" wood is entirely new in 1.13; alias to the non-stripped log/wood
// (losing the stripped look, keeping species and orientation).
function strippedAlias(shortName) {
  return shortName.startsWith('stripped_') ? shortName.slice('stripped_'.length) : null;
}

// Blocks new in 1.13/1.17 with no 1.12 material at all (coral, prismarine
// variants, ...) but a recognizable shape: fall back the same way lib/palette.js's
// shape-generic tier does, reusing data/substitutions.json's table so the two
// don't drift apart. Returns a list - shapeSuffixChains gives an ordered
// fallback per suffix, not a single name, because the first choice (e.g.
// oak_sign) can itself be missing from 1.12.
function shapeGenericAlias(shortName) {
  for (const [suffix, candidates] of Object.entries(substitutions.shapeSuffixChains)) {
    if (shortName.endsWith(suffix)) return candidates;
  }
  return null;
}

// The vendor map only ever recorded the DEFAULT value of a property 1.12
// couldn't represent at all (waterlogged, powered, leaf distance/persistent,
// chest type - see PLAN.md Group 1). A non-default value (e.g. a waterlogged
// stairs block) has no exact entry, but the block's orientation/shape does -
// forcing these back to the covered default before the exact lookup keeps
// that orientation instead of losing it to the property-blind byName
// fallback. What's lost is only the property 1.12 could never store anyway.
const CANONICAL_1_12_DEFAULT = {
  waterlogged: 'false',
  powered: 'false',
  distance: '7',
  persistent: 'false',
  type: 'single',
};

function canonicalize(properties) {
  const copy = { ...properties };
  for (const key of Object.keys(CANONICAL_1_12_DEFAULT)) {
    if (key in copy) copy[key] = CANONICAL_1_12_DEFAULT[key];
  }
  return copy;
}

function buildIndex() {
  // exact: stateKey -> best 1.12 candidate (name+properties match)
  // byName: short 1.13 block name -> best 1.12 candidate for ANY state of
  //   that block, used as a fallback when the exact property combination
  //   isn't in the map (the Group 1 cases the ordering comment above exists
  //   for, plus anything else unforeseen).
  const exact = new Map();
  const byName = new Map();

  // Lower is preferred: meta_state:true beats meta_state:false, then lowest
  // id:meta - see PLAN.md's tie-break rule for the 111 many-to-one states.
  const rank = c => (c.meta_state ? 0 : 1_000_000) + c.id * 16 + c.meta;

  for (const entry of vendor) {
    const to13 = entry['1.13'];
    const from12 = entry['1.12'];
    if (!to13 || !from12) continue;

    const candidate = { block: from12.block, properties: from12.properties || {}, _rank: rank(from12) };
    const name13 = stripPrefix(to13.block);

    const key = stateKey(to13.block, to13.properties);
    const existing = exact.get(key);
    if (!existing || candidate._rank < existing._rank) exact.set(key, candidate);

    const existingByName = byName.get(name13);
    if (!existingByName || candidate._rank < existingByName._rank) byName.set(name13, candidate);
  }

  return { exact, byName };
}

let index;
function getIndex() {
  if (!index) index = buildIndex();
  return index;
}

// entry: {name: 'minecraft:oak_stairs', properties: {...}} - already run
// through lib/palette.js's fixProperties against 1.13.2 block data.
// Returns {name, properties} in the same shape, translated to 1.12.
function flattenState(entry) {
  const { exact, byName } = getIndex();
  const key = stateKey(entry.name, entry.properties);

  const explicit = EXPLICIT_1_13_TO_1_12[key];
  if (explicit) return { name: explicit.block, properties: { ...explicit.properties } };

  const shortName = stripPrefix(entry.name);
  const canonicalHit = exact.get(stateKey(entry.name, canonicalize(entry.properties)));
  const hit = exact.get(key) || canonicalHit || byName.get(shortName);
  if (hit) return { name: hit.block, properties: { ...hit.properties } };

  const stemKey = attachedStemBaseKey(shortName);
  if (stemKey) {
    const stemHit = exact.get(stemKey);
    // Override facing explicitly: the indexed 1.12 candidate for age=7 is
    // whichever facing ranked lowest, not necessarily this block's facing.
    if (stemHit) {
      return { name: stemHit.block, properties: { ...stemHit.properties, facing: entry.properties.facing } };
    }
  }

  const aliasCandidates = [familyAlias(shortName), strippedAlias(shortName), ...(shapeGenericAlias(shortName) || [])].filter(
    Boolean
  );
  for (const alias of aliasCandidates) {
    // Try the aliased block's exact state first (e.g. white_banner's own
    // rotation=3 entry, or oak_log's own axis=x entry) so orientation
    // survives; only fall back to its default state if this exact
    // combination isn't in the map either.
    const aliasHit = exact.get(stateKey(alias, entry.properties)) || byName.get(alias);
    if (aliasHit) return { name: aliasHit.block, properties: { ...aliasHit.properties } };
  }

  // Last resort: the same command_block state lib/palette.js's marker tier
  // produces, translated the same way as any other block.
  const markerKey = stateKey('minecraft:command_block', {});
  const marker = exact.get(markerKey) || byName.get('command_block');
  return marker
    ? { name: marker.block, properties: { ...marker.properties } }
    : { name: 'minecraft:command_block', properties: {} };
}

module.exports = { flattenState, stateKey };

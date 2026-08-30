// Derives the 1.12 tile-entity field a "kind B" 1.13+ block needs to carry
// its per-instance value (note pitch, skull type, banner colour, bed colour -
// see PLAN.md Phase 6 "Kind B") once its identity has collapsed to a shared
// base blockstate during flattening (see lib/flattening.js's family alias
// tier). Pure and NBT-free, like lib/palette.js and lib/flattening.js.
//
// Numbering verified against minecraft-data's legacy.json item tables (see
// PLAN.md): bed color 0=white..15=black (dye order); banner Base 0=black..
// 15=white (INVERTED dye order - do not "fix" this, it's really inverted);
// skull SkullType 0=skeleton,1=wither_skeleton,2=zombie,3=player,4=creeper,
// 5=dragon.

const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];

const SKULL_TYPE = {
  skeleton: 0,
  wither_skeleton: 1,
  zombie: 2,
  player: 3,
  creeper: 4,
  dragon: 5,
};

function bedColorFor(shortName) {
  if (!shortName.endsWith('_bed')) return null;
  const index = DYE_COLORS.indexOf(shortName.slice(0, -'_bed'.length));
  return index === -1 ? null : index;
}

function bannerBaseFor(shortName) {
  const stripped = shortName.endsWith('_wall_banner')
    ? shortName.slice(0, -'_wall_banner'.length)
    : shortName.endsWith('_banner')
      ? shortName.slice(0, -'_banner'.length)
      : null;
  if (stripped === null) return null;
  const index = DYE_COLORS.indexOf(stripped);
  return index === -1 ? null : 15 - index;
}

function skullTypeFor(shortName) {
  const base = shortName
    .replace(/_wall_(head|skull)$/, '')
    .replace(/_(head|skull)$/, '');
  return base in SKULL_TYPE ? SKULL_TYPE[base] : null;
}

// entry: a normalized 1.13.2 palette entry (post lib/palette.js, pre
// lib/flattening.js - i.e. still carries its real modern name and any
// 'note'/'rotation' property).
// Returns null (nothing to do), or { blockEntityId, fields } where `fields`
// is a plain {tagName: {type, value}} map to merge into the position's
// 1.12 TileEntities entry (creating one if none exists there yet).
function tileEntityUpdateFor(entry) {
  const shortName = entry.name.startsWith('minecraft:') ? entry.name.slice('minecraft:'.length) : entry.name;

  if (shortName === 'note_block') {
    const note = Number(entry.properties.note ?? 0);
    return { blockEntityId: 'minecraft:noteblock', fields: { note: { type: 'byte', value: note } } };
  }

  const skullType = skullTypeFor(shortName);
  if (skullType !== null) {
    const fields = { SkullType: { type: 'byte', value: skullType } };
    if ('rotation' in entry.properties) {
      fields.Rot = { type: 'byte', value: Number(entry.properties.rotation) };
    }
    return { blockEntityId: 'minecraft:skull', fields };
  }

  const bannerBase = bannerBaseFor(shortName);
  if (bannerBase !== null) {
    return { blockEntityId: 'minecraft:banner', fields: { Base: { type: 'int', value: bannerBase } } };
  }

  const bedColor = bedColorFor(shortName);
  if (bedColor !== null) {
    return { blockEntityId: 'minecraft:bed', fields: { color: { type: 'int', value: bedColor } } };
  }

  return null;
}

module.exports = { tileEntityUpdateFor, bedColorFor, bannerBaseFor, skullTypeFor, DYE_COLORS };

// Minecraft versions the bot can convert to, and the Litematica schematic
// ("NBT") version each one reads.
//
// Litematica's schematic version tracks Minecraft only coarsely:
//   4  <= 1.12.2      (pre-flattening, not supported yet - see PLAN.md phase 6)
//   5  1.13  - 1.16.5
//   6  1.17  - 1.20.4
//   7  1.20.5 +
//
// That coarseness is exactly why the target has to be a Minecraft version and
// not a schematic version: 1.13.2 and 1.16.5 are both "NBT 5", but 1.16 blocks
// do not exist in 1.13.
//
// Order here is the order shown in the Discord dropdown (newest first), and it
// drives scripts/build-blockdata.js. Discord allows at most 25 select options.
const SUPPORTED = {
  '1.21.8': 7,
  '1.21.4': 7,
  '1.21.1': 7,
  '1.20.6': 7,
  '1.20.4': 6,
  '1.20.1': 6,
  '1.19.4': 6,
  '1.18.2': 6,
  '1.17.1': 6,
  '1.16.5': 5,
  '1.15.2': 5,
  '1.14.4': 5,
  '1.13.2': 5,
};

// 1.12.2 is pre-Flattening: it has no data/blocks-1.12.2.json (its block
// model doesn't fit the {properties, defaults} shape the others use - see
// lib/flattening.js) and is never a loadBlockData() target. It IS a
// selectable conversion target, handled specially in lib/convert.js: the
// palette is normalized against 1.13.2's block data first, then translated
// through the vendored flattening map.
const PRE_FLATTENING_MC_VERSION = '1.12.2';
const PRE_FLATTENING_NBT_VERSION = 4;
const PRE_FLATTENING_DATA_VERSION = 1343;

const blockDataCache = new Map();

function loadBlockData(mcVersion) {
  if (!SUPPORTED[mcVersion]) throw new Error(`Unsupported Minecraft version: ${mcVersion}`);
  if (!blockDataCache.has(mcVersion)) {
    blockDataCache.set(mcVersion, require(`../data/blocks-${mcVersion}.json`));
  }
  return blockDataCache.get(mcVersion);
}

// Best-effort label for what the uploaded file currently is. The schematic
// stores MinecraftDataVersion, which pins it far more precisely than Version
// does, so prefer that and fall back to the schematic version's range.
const NBT_VERSION_RANGE = {
  4: '<= 1.12.2',
  5: '1.13 - 1.16.5',
  6: '1.17 - 1.20.4',
  7: '1.20.5+',
};

function describeSource(nbtVersion, dataVersion) {
  const match = Object.keys(SUPPORTED).find(
    v => loadBlockData(v).dataVersion === dataVersion
  );
  if (match) return match;
  const range = NBT_VERSION_RANGE[nbtVersion];
  return range ? `${range} (NBT ${nbtVersion})` : `NBT ${nbtVersion}`;
}

module.exports = {
  SUPPORTED,
  loadBlockData,
  describeSource,
  PRE_FLATTENING_MC_VERSION,
  PRE_FLATTENING_NBT_VERSION,
  PRE_FLATTENING_DATA_VERSION,
};

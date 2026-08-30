// Schematic conversion logic, kept free of Discord so it can be unit tested.
// commands/schem-convert.js owns the interaction; this module owns the NBT.

const {
  SUPPORTED,
  loadBlockData,
  PRE_FLATTENING_MC_VERSION,
  PRE_FLATTENING_NBT_VERSION,
  PRE_FLATTENING_DATA_VERSION,
} = require('./versions');
const { convertPalette } = require('./palette');
const { flattenState } = require('./flattening');
const { tileEntityUpdateFor } = require('./tile-entity-1-12');
const { bitsForPaletteSize, decodeBlockStates, indexToPos } = require('./blockstates');

function nbtVersionFor(mcVersion) {
  if (mcVersion === PRE_FLATTENING_MC_VERSION) return PRE_FLATTENING_NBT_VERSION;
  const v = SUPPORTED[mcVersion];
  if (!v) throw new Error(`Unsupported Minecraft version: ${mcVersion}`);
  return v;
}

function dataVersionFor(mcVersion) {
  if (mcVersion === PRE_FLATTENING_MC_VERSION) return PRE_FLATTENING_DATA_VERSION;
  return loadBlockData(mcVersion).dataVersion;
}

// Data-version thresholds for the tag-shape changes, keyed on the real
// Minecraft version they landed in rather than the coarse NBT/schematic
// version - see PLAN.md "Tag transforms keyed on data version".
const SIGN_REWORK_DATA_VERSION = 3463; // 1.20
const COUNT_LOWERCASE_DATA_VERSION = 3837; // 1.20.5

// --- BlockStatePalette: NBT compound list <-> plain JS, then lib/palette.js ---

function paletteToPlain(paletteTag) {
  const entries = (paletteTag && paletteTag.value && paletteTag.value.value) || [];
  return entries.map(entry => {
    const properties = {};
    if (entry.Properties) {
      for (const [key, tag] of Object.entries(entry.Properties.value)) {
        properties[key] = String(tag.value);
      }
    }
    return { name: entry.Name.value, properties };
  });
}

function plainToPaletteTag(entries) {
  return {
    type: 'list',
    value: {
      type: 'compound',
      value: entries.map(entry => {
        const compound = { Name: { type: 'string', value: entry.name } };
        const propKeys = Object.keys(entry.properties);
        if (propKeys.length > 0) {
          const value = {};
          for (const key of propKeys) {
            value[key] = { type: 'string', value: entry.properties[key] };
          }
          compound.Properties = { type: 'compound', value };
        }
        return compound;
      }),
    },
  };
}

function convertRegionPalette(region, toMcVersion, report) {
  const paletteTag = region.value.BlockStatePalette;
  if (!paletteTag) return;

  const plain = paletteToPlain(paletteTag);

  // 1.12.2 has no block data of its own to normalize against (see
  // lib/versions.js). Normalize to 1.13.2 first - this is what makes the
  // ordering constraint in lib/flattening.js's header comment hold - then
  // translate each resulting state through the vendored flattening map.
  const normalizeTarget = toMcVersion === PRE_FLATTENING_MC_VERSION ? '1.13.2' : toMcVersion;
  const { palette: normalized, report: regionReport } = convertPalette(plain, loadBlockData(normalizeTarget));
  for (const swap of regionReport) report.add(swap);

  if (toMcVersion === PRE_FLATTENING_MC_VERSION) {
    // Must run against `normalized` (still the real modern names/properties)
    // and BEFORE the palette is overwritten below with flattened 1.12 names -
    // tileEntityUpdateFor needs to see e.g. 'red_banner', not 'standing_banner'.
    applyPreFlatteningTileEntityValues(region, normalized);
  }

  const finalPalette =
    toMcVersion === PRE_FLATTENING_MC_VERSION ? normalized.map(flattenState) : normalized;

  region.value.BlockStatePalette = plainToPaletteTag(finalPalette);
}

// --- Phase 6 "Kind B": note pitch / skull type / banner colour / bed colour ---
//
// These live in 1.12 tile-entity data, not the blockstate (see
// lib/tile-entity-1-12.js). Palette length being invariant means every
// position's palette INDEX never changes, so the existing BlockStates array
// can be decoded as-is (see lib/blockstates.js) to find which positions use
// one of these palette entries, without ever re-encoding it.
//
// ponytail: this decode only runs when the palette actually contains a
// note/skull/banner/bed entry (the `every(u => u === null)` short-circuit
// below) - the common schematic pays nothing for this.

function applyPreFlatteningTileEntityValues(region, normalizedPalette) {
  const perIndexUpdate = normalizedPalette.map(tileEntityUpdateFor);
  if (perIndexUpdate.every(update => update === null)) return;

  const sizeTag = region.value.Size;
  const blockStatesTag = region.value.BlockStates;
  if (!sizeTag || !blockStatesTag) return; // malformed region; nothing safe to do

  const sizeX = Math.abs(sizeTag.value.x.value);
  const sizeY = Math.abs(sizeTag.value.y.value);
  const sizeZ = Math.abs(sizeTag.value.z.value);
  const volume = sizeX * sizeY * sizeZ;
  if (volume === 0) return;

  const bits = bitsForPaletteSize(normalizedPalette.length);
  const positionIndices = decodeBlockStates(blockStatesTag.value, bits, volume);

  if (!region.value.TileEntities) {
    region.value.TileEntities = { type: 'list', value: { type: 'compound', value: [] } };
  }
  const tileEntities = region.value.TileEntities.value.value;

  const byPosition = new Map();
  for (const te of tileEntities) {
    if (te.x && te.y && te.z) byPosition.set(`${te.x.value},${te.y.value},${te.z.value}`, te);
  }

  for (let index = 0; index < volume; index++) {
    const update = perIndexUpdate[positionIndices[index]];
    if (!update) continue;

    const { x, y, z } = indexToPos(index, sizeX, sizeZ);
    const key = `${x},${y},${z}`;
    let te = byPosition.get(key);
    if (!te) {
      te = {
        id: { type: 'string', value: update.blockEntityId },
        x: { type: 'int', value: x },
        y: { type: 'int', value: y },
        z: { type: 'int', value: z },
      };
      tileEntities.push(te);
      byPosition.set(key, te);
    }
    Object.assign(te, update.fields);
  }
}

// --- Phase 5: drop entities the target doesn't recognize ---
//
// ponytail: minecraft-data's entities.json is the mob/object registry
// (pig, arrow, boat, ...) and correctly backs this filter for Entities.
// TileEntities (block entities: sign, chest, beacon, ...) are a different
// id namespace that minecraft-data does not ship a per-version list for, so
// they are deliberately left unfiltered here rather than filtered against
// the wrong dataset - an earlier version of this code used entities.json for
// both and silently deleted every sign and chest. Add a real block-entity id
// table (and wire it in here) if a target actually needs this.

function filterById(listTag, validIds) {
  if (!listTag || !listTag.value || !listTag.value.value) return;
  listTag.value.value = listTag.value.value.filter(item => {
    const id = item.id || item.Id;
    if (!id || typeof id.value !== 'string') return true; // no id to check, keep it
    return validIds.has(id.value.replace(/^minecraft:/, ''));
  });
}

function convertRegionEntities(region, targetData) {
  filterById(region.value.Entities, new Set(targetData.entities));
}

// --- sign / count tag shape, re-keyed on data version ---

function walk(obj, visit) {
  if (!obj || typeof obj !== 'object') return;
  visit(obj);
  for (const key in obj) walk(obj[key], visit);
}

function upgradeSignTags(root) {
  walk(root, obj => {
    if (!['Text1', 'Text2', 'Text3', 'Text4'].some(k => k in obj)) return;
    const messages = ['Text1', 'Text2', 'Text3', 'Text4'].map(tk =>
      obj[tk] ? obj[tk].value : '{"text":""}'
    );
    const glowing = obj.GlowingText ? obj.GlowingText.value : 0;
    const color = obj.Color ? obj.Color.value : 'black';

    obj.front_text = {
      type: 'compound',
      value: {
        has_glowing_text: { type: 'byte', value: glowing },
        color: { type: 'string', value: color },
        messages: { type: 'list', value: { type: 'string', value: messages } },
      },
    };
    obj.back_text = {
      type: 'compound',
      value: {
        has_glowing_text: { type: 'byte', value: 0 },
        color: { type: 'string', value: 'black' },
        messages: {
          type: 'list',
          value: { type: 'string', value: ['{"text":""}', '{"text":""}', '{"text":""}', '{"text":""}'] },
        },
      },
    };
    delete obj.Text1;
    delete obj.Text2;
    delete obj.Text3;
    delete obj.Text4;
    delete obj.GlowingText;
    delete obj.Color;
  });
}

function downgradeSignTags(root) {
  walk(root, obj => {
    if (!obj.front_text) return;
    const front = obj.front_text.value;
    const messages = (front.messages && front.messages.value && front.messages.value.value) || [
      '{"text":""}',
      '{"text":""}',
      '{"text":""}',
      '{"text":""}',
    ];
    obj.Text1 = { type: 'string', value: messages[0] || '{"text":""}' };
    obj.Text2 = { type: 'string', value: messages[1] || '{"text":""}' };
    obj.Text3 = { type: 'string', value: messages[2] || '{"text":""}' };
    obj.Text4 = { type: 'string', value: messages[3] || '{"text":""}' };
    obj.GlowingText = { type: 'byte', value: (front.has_glowing_text && front.has_glowing_text.value) ?? 0 };
    obj.Color = { type: 'string', value: (front.color && front.color.value) ?? 'black' };
    delete obj.front_text;
    delete obj.back_text;
  });
}

function upgradeCountTags(root) {
  walk(root, obj => {
    if ('Count' in obj && obj.Count && obj.Count.value !== undefined) {
      obj.count = { type: 'int', value: obj.Count.value };
      delete obj.Count;
    }
  });
}

function downgradeCountTags(root) {
  walk(root, obj => {
    if ('count' in obj && obj.count && obj.count.type === 'int') {
      obj.Count = { type: 'int', value: obj.count.value };
      delete obj.count;
    }
  });
}

// --- main entry point ---

class SubstitutionReport {
  constructor() {
    this.swaps = new Map();
  }
  add({ from, to }) {
    this.swaps.set(`${from}=>${to}`, { from, to });
  }
  toLines() {
    return [...this.swaps.values()].map(({ from, to }) => `${from} -> ${to}`);
  }
}

// root: the parsed schematic's NBT root (data.parsed.value).
// fromDataVersion: root's MinecraftDataVersion, or a fallback derived from
//   Version when the tag is absent.
// toMcVersion: a key from lib/versions.js SUPPORTED.
// Returns a SubstitutionReport describing every block substitution made.
function convertSchematic(root, fromDataVersion, toMcVersion) {
  const toDataVersion = dataVersionFor(toMcVersion);
  const toNbtVersion = nbtVersionFor(toMcVersion);
  const isPreFlattening = toMcVersion === PRE_FLATTENING_MC_VERSION;
  const report = new SubstitutionReport();

  const regions = (root.Regions && root.Regions.value) || {};
  for (const regionKey of Object.keys(regions)) {
    const region = regions[regionKey];
    convertRegionPalette(region, toMcVersion, report);
    // 1.12.2 has no minecraft-data entity list to filter against (same
    // reasoning as TileEntities above); leave Entities alone for that target.
    if (!isPreFlattening) convertRegionEntities(region, loadBlockData(toMcVersion));
  }

  if (fromDataVersion < SIGN_REWORK_DATA_VERSION && toDataVersion >= SIGN_REWORK_DATA_VERSION) {
    upgradeSignTags(root);
  } else if (fromDataVersion >= SIGN_REWORK_DATA_VERSION && toDataVersion < SIGN_REWORK_DATA_VERSION) {
    downgradeSignTags(root);
  }

  if (fromDataVersion < COUNT_LOWERCASE_DATA_VERSION && toDataVersion >= COUNT_LOWERCASE_DATA_VERSION) {
    upgradeCountTags(root);
  } else if (fromDataVersion >= COUNT_LOWERCASE_DATA_VERSION && toDataVersion < COUNT_LOWERCASE_DATA_VERSION) {
    downgradeCountTags(root);
  }

  if (root.MinecraftDataVersion) root.MinecraftDataVersion.value = toDataVersion;
  if (root.Version) root.Version.value = toNbtVersion;

  return report;
}

module.exports = {
  convertSchematic,
  nbtVersionFor,
  dataVersionFor,
  paletteToPlain,
  plainToPaletteTag,
};

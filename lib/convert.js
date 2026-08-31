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
const {
  jsonStringToCanonical,
  canonicalToJsonString,
  nbtComponentToCanonical,
  canonicalToNbtComponent,
  canonicalToPlainText,
} = require('./text-component');
const { resolveItemName, ITEM_MARKER } = require('./items');
const { resolveLegacyItem, legacyEnchantmentId } = require('./legacy-items');
const preFlatteningItems = require('../data/items-1.12.2.json');

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
const SIGN_REWORK_DATA_VERSION = 3463; // 1.20: Text1-4 -> front_text/back_text
const TEXT_COMPONENT_NBT_DATA_VERSION = 4325; // 1.21.5: JSON string -> real NBT component
const COUNT_LOWERCASE_DATA_VERSION = 3837; // 1.20.5

// hanging_sign is the one confirmed case of a block-entity id that exists
// under a different id pre-1.20 (there was no hanging sign at all, so its
// TileEntities `id` has nowhere valid to go except the ordinary sign's) -
// see PLAN.md "A4". Add more entries here if another one is found; this is
// deliberately a flat map, not a per-version registry (see the ponytail
// comment on filterById below for why minecraft-data can't back a real one).
const BLOCK_ENTITY_ID_DOWNGRADES = { hanging_sign: 'sign' };

function signSideKey(dataVersion) {
  if (dataVersion >= TEXT_COMPONENT_NBT_DATA_VERSION) return 'nbt-component';
  if (dataVersion >= SIGN_REWORK_DATA_VERSION) return 'json-front-text';
  return 'json-text1-4';
}

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

// One message tag -> canonical (see lib/text-component.js). `raw` is either
// a full tag object (the Text1-4 shape, always pre-4325 so always a JSON
// string) or a bare NBT-list element value (the messages-list shape, which
// spans both encodings - see decodeMessagesList).
function decodeMessage(raw, fromDataVersion) {
  if (fromDataVersion >= TEXT_COMPONENT_NBT_DATA_VERSION) return nbtComponentToCanonical(raw);
  return jsonStringToCanonical(raw.value);
}

function decodeMessagesList(messagesTag, fromDataVersion) {
  const listValue = messagesTag && messagesTag.value;
  const elementType = listValue && listValue.type;
  const rawEntries = (listValue && listValue.value) || [];
  return rawEntries.map(raw =>
    decodeMessage(elementType === 'string' ? { type: 'string', value: raw } : { type: 'compound', value: raw }, fromDataVersion)
  );
}

function encodeMessagesList(canonicalMessages, toDataVersion) {
  if (toDataVersion < TEXT_COMPONENT_NBT_DATA_VERSION) {
    return { type: 'list', value: { type: 'string', value: canonicalMessages.map(canonicalToJsonString) } };
  }
  const tags = canonicalMessages.map(canonicalToNbtComponent);
  if (tags.every(t => t.type === 'string')) {
    return { type: 'list', value: { type: 'string', value: tags.map(t => t.value) } };
  }
  // ponytail: same homogeneous-list normalization as text-component.js's
  // extraListTag - a mixed-formatting sign still needs one valid NBT list.
  return {
    type: 'list',
    value: { type: 'compound', value: tags.map(t => (t.type === 'compound' ? t.value : { text: { type: 'string', value: t.value } })) },
  };
}

// Reads whichever sign shape `obj` actually has into
// {front: [c,c,c,c], back: [c,c,c,c] | null, glowing, color}. `back` is null
// when the source has no back side at all (pre-1.20 signs only ever had one).
function decodeSign(obj, fromDataVersion) {
  if (obj.front_text) {
    const front = obj.front_text.value;
    const back = obj.back_text && obj.back_text.value;
    return {
      front: decodeMessagesList(front.messages, fromDataVersion),
      back: back ? decodeMessagesList(back.messages, fromDataVersion) : null,
      glowing: !!(front.has_glowing_text && front.has_glowing_text.value),
      color: (front.color && front.color.value) || 'black',
    };
  }
  if (['Text1', 'Text2', 'Text3', 'Text4'].some(k => k in obj)) {
    return {
      front: ['Text1', 'Text2', 'Text3', 'Text4'].map(k => (obj[k] ? decodeMessage(obj[k], fromDataVersion) : '')),
      back: null,
      glowing: !!(obj.GlowingText && obj.GlowingText.value),
      color: (obj.Color && obj.Color.value) || 'black',
    };
  }
  return null;
}

function emitSign(obj, sign, toDataVersion) {
  delete obj.Text1;
  delete obj.Text2;
  delete obj.Text3;
  delete obj.Text4;
  delete obj.GlowingText;
  delete obj.Color;
  delete obj.front_text;
  delete obj.back_text;

  if (toDataVersion < SIGN_REWORK_DATA_VERSION) {
    const messages = sign.front.map(c => canonicalToJsonString(c));
    obj.Text1 = { type: 'string', value: messages[0] };
    obj.Text2 = { type: 'string', value: messages[1] };
    obj.Text3 = { type: 'string', value: messages[2] };
    obj.Text4 = { type: 'string', value: messages[3] };
    obj.GlowingText = { type: 'byte', value: sign.glowing ? 1 : 0 };
    obj.Color = { type: 'string', value: sign.color };
    return;
  }

  obj.front_text = {
    type: 'compound',
    value: {
      has_glowing_text: { type: 'byte', value: sign.glowing ? 1 : 0 },
      color: { type: 'string', value: sign.color },
      messages: encodeMessagesList(sign.front, toDataVersion),
    },
  };
  obj.back_text = {
    type: 'compound',
    value: {
      has_glowing_text: { type: 'byte', value: 0 },
      color: { type: 'string', value: 'black' },
      messages: encodeMessagesList(sign.back || ['', '', '', ''], toDataVersion),
    },
  };
}

// A4/A5: block-entity id remap, and reporting a back side that has nowhere
// to go, need per-tile-entity context (the `id` field) that decodeSign/
// emitSign don't otherwise touch.
function convertSignTags(root, fromDataVersion, toDataVersion, report) {
  walk(root, obj => {
    const sign = decodeSign(obj, fromDataVersion);
    if (!sign) return;
    emitSign(obj, sign, toDataVersion);

    if (toDataVersion < SIGN_REWORK_DATA_VERSION && sign.back && sign.back.some(c => c !== '')) {
      report.addNote('sign back text dropped (target has no back side)');
    }
    if (toDataVersion < SIGN_REWORK_DATA_VERSION && obj.id) {
      const shortId = obj.id.value.replace(/^minecraft:/, '');
      if (BLOCK_ENTITY_ID_DOWNGRADES[shortId]) {
        obj.id.value = `minecraft:${BLOCK_ENTITY_ID_DOWNGRADES[shortId]}`;
      }
    }
  });
}

// --- B1/B1a/B2/B3/B4: item stacks ---
//
// Detected generically (any compound with `id` + Count/count) rather than by
// enumerating container types (chest, shulker, item frame, armor stand,
// minecart, ...) - the same shape covers all of them, and it reaches nested
// item stacks (a shulker box's own Items list) for free, since `walk`
// recurses into every object in the tree regardless of what put it there.
// Sources are always 1.13.2+ here (1.12.2 is only ever a conversion target,
// same limitation as the block side - see lib/flattening.js's header).

function stripMcPrefix(name) {
  return name.replace(/^minecraft:/, '');
}

function isItemStack(obj) {
  return !!(obj.id && typeof obj.id.value === 'string' && ('Count' in obj || 'count' in obj));
}

const PRE_FLATTENING_ITEM_INDEX = {};
for (const item of preFlatteningItems.items) PRE_FLATTENING_ITEM_INDEX[item.name] = true;

function targetItemIndex(toMcVersion, isPreFlattening) {
  if (isPreFlattening) return PRE_FLATTENING_ITEM_INDEX;
  const index = {};
  for (const name of loadBlockData(toMcVersion).items) index[name] = true;
  return index;
}

// Name/Lore/marker-label encoding, keyed the same way sign text is (see
// TEXT_COMPONENT_NBT_DATA_VERSION above), plus a third pre-1.13 case: item
// display text was plain (unlike signs, which were already JSON by then) -
// see PLAN.md "B4"'s note on `tag.display.Name`.
function encodeTextField(canonical, toDataVersion, isPreFlattening) {
  if (isPreFlattening) {
    return { type: 'string', value: typeof canonical === 'string' ? canonical : canonicalToPlainText(canonical) };
  }
  if (toDataVersion < TEXT_COMPONENT_NBT_DATA_VERSION) return { type: 'string', value: canonicalToJsonString(canonical) };
  return canonicalToNbtComponent(canonical);
}

function decodeTextField(rawTag, fromDataVersion) {
  if (fromDataVersion < TEXT_COMPONENT_NBT_DATA_VERSION) return jsonStringToCanonical(rawTag.value);
  return nbtComponentToCanonical(rawTag);
}

function encodeTextList(canonicalList, toDataVersion, isPreFlattening) {
  if (isPreFlattening) {
    return { type: 'list', value: { type: 'string', value: canonicalList.map(c => encodeTextField(c, toDataVersion, true).value) } };
  }
  if (toDataVersion < TEXT_COMPONENT_NBT_DATA_VERSION) {
    return { type: 'list', value: { type: 'string', value: canonicalList.map(canonicalToJsonString) } };
  }
  const tags = canonicalList.map(canonicalToNbtComponent);
  if (tags.every(t => t.type === 'string')) return { type: 'list', value: { type: 'string', value: tags.map(t => t.value) } };
  // ponytail: same homogeneous-list normalization as text-component.js's extraListTag.
  return {
    type: 'list',
    value: { type: 'compound', value: tags.map(t => (t.type === 'compound' ? t.value : { text: { type: 'string', value: t.value } })) },
  };
}

function decodeTextList(listTag, fromDataVersion) {
  if (!listTag || !listTag.value) return null;
  const elementType = listTag.value.type;
  const rawEntries = listTag.value.value || [];
  if (fromDataVersion < TEXT_COMPONENT_NBT_DATA_VERSION) return rawEntries.map(jsonStringToCanonical);
  return rawEntries.map(raw => nbtComponentToCanonical(elementType === 'string' ? { type: 'string', value: raw } : { type: 'compound', value: raw }));
}

function decodeCustomName(item, fromDataVersion) {
  const tag =
    fromDataVersion >= COUNT_LOWERCASE_DATA_VERSION
      ? item.components && item.components.value['minecraft:custom_name']
      : item.tag && item.tag.value.display && item.tag.value.display.value.Name;
  return tag ? decodeTextField(tag, fromDataVersion) : null;
}

function decodeLore(item, fromDataVersion) {
  const tag =
    fromDataVersion >= COUNT_LOWERCASE_DATA_VERSION
      ? item.components && item.components.value['minecraft:lore']
      : item.tag && item.tag.value.display && item.tag.value.display.value.Lore;
  return decodeTextList(tag, fromDataVersion);
}

function writeDisplayField(item, key, tag, toDataVersion, isPreFlattening) {
  if (isPreFlattening || toDataVersion < COUNT_LOWERCASE_DATA_VERSION) {
    if (!item.tag) item.tag = { type: 'compound', value: {} };
    if (!item.tag.value.display) item.tag.value.display = { type: 'compound', value: {} };
    item.tag.value.display.value[key] = tag;
  } else {
    item.components ??= { type: 'compound', value: {} };
    item.components.value[key === 'Name' ? 'minecraft:custom_name' : 'minecraft:lore'] = tag;
  }
}

function decodeEnchantments(item, fromDataVersion) {
  if (fromDataVersion >= COUNT_LOWERCASE_DATA_VERSION) {
    const comp = item.components && item.components.value['minecraft:enchantments'];
    if (!comp || !comp.value.levels) return null;
    return Object.entries(comp.value.levels.value).map(([id, lvl]) => ({ name: stripMcPrefix(id), lvl: lvl.value }));
  }
  const list = item.tag && item.tag.value.Enchantments;
  if (!list || !list.value || !list.value.value) return null;
  return list.value.value.map(entry => ({ name: stripMcPrefix(entry.id.value), lvl: entry.lvl.value }));
}

// 1.12.2's `ench` uses numeric ids instead of namespaced strings (see
// lib/legacy-items.js) - an enchantment added after 1.12 (mending exists,
// but e.g. soul_speed/swift_sneak don't) has no numeric id and is dropped,
// reported rather than silently lost.
function applyEnchantments(item, enchantments, toDataVersion, isPreFlattening, report) {
  if (!enchantments || enchantments.length === 0) return;

  if (isPreFlattening) {
    const entries = [];
    for (const { name, lvl } of enchantments) {
      const id = legacyEnchantmentId(name);
      if (id === null) {
        report.addNote(`enchantment dropped, no 1.12.2 equivalent: ${name}`);
        continue;
      }
      entries.push({ id: { type: 'short', value: id }, lvl: { type: 'short', value: lvl } });
    }
    if (entries.length === 0) return;
    item.tag ??= { type: 'compound', value: {} };
    item.tag.value.ench = { type: 'list', value: { type: 'compound', value: entries } };
    return;
  }

  if (toDataVersion >= COUNT_LOWERCASE_DATA_VERSION) {
    const levels = {};
    for (const { name, lvl } of enchantments) levels[`minecraft:${name}`] = { type: 'int', value: lvl };
    item.components ??= { type: 'compound', value: {} };
    item.components.value['minecraft:enchantments'] = { type: 'compound', value: { levels: { type: 'compound', value: levels } } };
    return;
  }

  item.tag ??= { type: 'compound', value: {} };
  item.tag.value.Enchantments = {
    type: 'list',
    value: {
      type: 'compound',
      value: enchantments.map(({ name, lvl }) => ({
        id: { type: 'string', value: `minecraft:${name}` },
        lvl: { type: 'short', value: lvl },
      })),
    },
  };
}

function decodeDurability(item, fromDataVersion) {
  if (fromDataVersion >= COUNT_LOWERCASE_DATA_VERSION) {
    const tag = item.components && item.components.value['minecraft:damage'];
    return tag ? tag.value : null;
  }
  return item.Damage ? item.Damage.value : null;
}

function applyDurability(item, durability, toDataVersion, isPreFlattening) {
  if (durability === null) return;
  if (isPreFlattening || toDataVersion < COUNT_LOWERCASE_DATA_VERSION) {
    item.Damage = { type: 'short', value: durability };
  } else {
    item.components ??= { type: 'compound', value: {} };
    item.components.value['minecraft:damage'] = { type: 'int', value: durability };
  }
}

// B4: 1.12.2 has no item id for a coloured/typed variant (red_wool, blue_bed,
// ...) - it's the base item (wool, bed) plus a numeric Damage meta, same
// split lib/flattening.js resolves for blocks. Only writes Damage when the
// item doesn't already carry a real durability value (see PLAN.md "B4" -
// modern items never reuse Damage for meta, so a hit here always IS a
// variant, but check anyway rather than relying on that never changing).
// Returns true if the id is fully resolved (no B1 fallback needed).
function applyLegacyItemId(item, shortName, fromDataVersion) {
  const legacy = resolveLegacyItem(shortName);
  if (!legacy) return false;
  item.id.value = `minecraft:${legacy.name}`;
  if (legacy.damage !== 0 && decodeDurability(item, fromDataVersion) === null) {
    item.Damage = { type: 'short', value: legacy.damage };
  }
  return true;
}

const B3_COMPONENT_KEYS = ['minecraft:custom_name', 'minecraft:lore', 'minecraft:enchantments', 'minecraft:damage'];

// B1/B1a/B3/B4 tied together for one item stack. `minecraft:container`
// (nested shulker-box contents) is deliberately NOT translated - see
// PLAN.md "B3", flagged as a known gap rather than silently mishandled.
function convertItemStack(item, fromDataVersion, toMcVersion, toDataVersion, isPreFlattening, report) {
  const shortName = stripMcPrefix(item.id.value);

  const customName = decodeCustomName(item, fromDataVersion);
  const lore = decodeLore(item, fromDataVersion);
  const enchantments = decodeEnchantments(item, fromDataVersion);
  const durability = decodeDurability(item, fromDataVersion);

  // Only the four known B3 keys are cleared - never the whole tag/components
  // compound. A `minecraft:container` component (nested shulker contents,
  // not translated - see PLAN.md "B3") must survive this so `walk`'s
  // continued recursion still reaches and converts the items inside it;
  // left in place, it's just an extra field an old client ignores. Tidy up
  // the wrapper only once it's genuinely empty.
  if (item.tag) {
    delete item.tag.value.display;
    delete item.tag.value.Enchantments;
    delete item.tag.value.ench;
    if (Object.keys(item.tag.value).length === 0) delete item.tag;
  }
  delete item.Damage;
  if (item.components) {
    for (const key of B3_COMPONENT_KEYS) delete item.components.value[key];
    if (Object.keys(item.components.value).length === 0) delete item.components;
  }

  let markerLabel = null;
  if (!(isPreFlattening && applyLegacyItemId(item, shortName, fromDataVersion))) {
    const resolved = resolveItemName(shortName, targetItemIndex(toMcVersion, isPreFlattening));
    if (resolved.substitutedFrom) {
      item.id.value = `minecraft:${resolved.name}`;
      report.add({ from: `minecraft:${shortName}`, to: item.id.value }, 'item');
      if (resolved.name === ITEM_MARKER) markerLabel = shortName;
    }
  }

  if (customName !== null) writeDisplayField(item, 'Name', encodeTextField(customName, toDataVersion, isPreFlattening), toDataVersion, isPreFlattening);
  if (lore !== null) writeDisplayField(item, 'Lore', encodeTextList(lore, toDataVersion, isPreFlattening), toDataVersion, isPreFlattening);
  applyEnchantments(item, enchantments, toDataVersion, isPreFlattening, report);
  applyDurability(item, durability, toDataVersion, isPreFlattening);

  // B1a: labelled last so it always wins over a preserved custom name -
  // knowing an item was replaced matters more than what it used to be called.
  if (markerLabel) writeDisplayField(item, 'Name', encodeTextField(markerLabel, toDataVersion, isPreFlattening), toDataVersion, isPreFlattening);

  // B2: Count/count, scoped to real item stacks (the old code touched any
  // object with either key) and TAG_Byte-correct on downgrade - pre-1.20.5
  // Count has always been a byte, not the int the old code wrote.
  if (toDataVersion >= COUNT_LOWERCASE_DATA_VERSION && 'Count' in item) {
    item.count = { type: 'int', value: item.Count.value };
    delete item.Count;
  } else if (toDataVersion < COUNT_LOWERCASE_DATA_VERSION && 'count' in item) {
    item.Count = { type: 'byte', value: item.count.value };
    delete item.count;
  }
}

function convertItemStacks(root, fromDataVersion, toMcVersion, toDataVersion, isPreFlattening, report) {
  walk(root, obj => {
    if (isItemStack(obj)) convertItemStack(obj, fromDataVersion, toMcVersion, toDataVersion, isPreFlattening, report);
  });
}

// --- main entry point ---

class SubstitutionReport {
  constructor() {
    this.blockSwaps = new Map();
    this.itemSwaps = new Map();
    this.notes = new Set();
  }
  // kind: 'block' (default) or 'item' - kept as separate maps so callers can
  // report them as two distinct lists instead of one undifferentiated pile.
  add({ from, to }, kind = 'block') {
    const map = kind === 'item' ? this.itemSwaps : this.blockSwaps;
    map.set(`${from}=>${to}`, { from, to });
  }
  // Free-text lines for lossy conversions that aren't a block/item swap (e.g.
  // A5's dropped sign back text) - deduplicated same as swaps, since one
  // schematic can trip the same note many times.
  addNote(text) {
    this.notes.add(text);
  }
  blockLines() {
    return [...this.blockSwaps.values()].map(({ from, to }) => `${from} -> ${to}`);
  }
  itemLines() {
    return [...this.itemSwaps.values()].map(({ from, to }) => `${from} -> ${to}`);
  }
  noteLines() {
    return [...this.notes];
  }
  toLines() {
    return this.blockLines().concat(this.itemLines()).concat(this.noteLines());
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

  if (signSideKey(fromDataVersion) !== signSideKey(toDataVersion)) {
    convertSignTags(root, fromDataVersion, toDataVersion, report);
  }

  convertItemStacks(root, fromDataVersion, toMcVersion, toDataVersion, isPreFlattening, report);

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

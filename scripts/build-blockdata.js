#!/usr/bin/env node
// Generates data/blocks-<mcVersion>.json from PrismarineJS/minecraft-data.
//
// Run with `npm run build-data`. The generated files are committed, so this only
// needs re-running when adding a Minecraft version to SUPPORTED (lib/versions.js).
//
// Fetches over HTTP instead of depending on the `minecraft-data` package, which
// unpacks to ~450 MB for the handful of blocks.json files we actually want.

const fs = require('fs');
const path = require('path');
const { SUPPORTED } = require('../lib/versions');

// Pinned so regeneration is reproducible. Bump deliberately.
const REF = 'fc3f7093feb8a691d8271db4c81a48d16061301e';
const BASE = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/${REF}/data`;

const OUT_DIR = path.join(__dirname, '..', 'data');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// minecraft-data describes a property as a name plus its ordered valid values.
// Booleans are stored as a type with no explicit values; Minecraft orders them
// [true, false], which matters for decoding defaultState below.
function propertyValues(state) {
  if (state.values) return state.values.map(String);
  if (state.type === 'bool') return ['true', 'false'];
  return Array.from({ length: state.num_values }, (_, i) => String(i));
}

// A block's states are one flat id range; the last property varies fastest.
// Unravelling (defaultState - minStateId) over that range recovers the default
// value of every property, which is what we need to fill in a property that the
// source schematic does not carry.
function defaultProperties(block) {
  const states = block.states || [];
  let index = block.defaultState - block.minStateId;
  const defaults = {};
  for (let i = states.length - 1; i >= 0; i--) {
    const values = propertyValues(states[i]);
    defaults[states[i].name] = values[index % values.length];
    index = Math.floor(index / values.length);
  }
  return defaults;
}

async function main() {
  const dataPaths = (await getJson(`${BASE}/dataPaths.json`)).pc;
  const protocolVersions = await getJson(`${BASE}/pc/common/protocolVersions.json`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const mcVersion of Object.keys(SUPPORTED)) {
    const paths = dataPaths[mcVersion];
    if (!paths) throw new Error(`minecraft-data has no entry for ${mcVersion}`);

    const entry = protocolVersions.find(v => v.minecraftVersion === mcVersion);
    if (!entry) throw new Error(`no protocolVersions entry for ${mcVersion}`);

    const [rawBlocks, rawEntities] = await Promise.all([
      getJson(`${BASE}/${paths.blocks}/blocks.json`),
      getJson(`${BASE}/${paths.entities}/entities.json`),
    ]);

    const blocks = {};
    for (const block of rawBlocks) {
      const properties = {};
      for (const state of block.states || []) {
        properties[state.name] = propertyValues(state);
      }
      blocks[block.name] = {
        properties,
        defaults: defaultProperties(block),
      };
    }

    const out = {
      mcVersion,
      dataVersion: entry.dataVersion,
      blocks,
      // Kept flat: entity ids are only ever membership-tested.
      entities: rawEntities.map(e => e.name).sort(),
    };

    const file = path.join(OUT_DIR, `blocks-${mcVersion}.json`);
    fs.writeFileSync(file, JSON.stringify(out));
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(
      `${mcVersion}: ${Object.keys(blocks).length} blocks, ${out.entities.length} entities, ${kb} KB`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

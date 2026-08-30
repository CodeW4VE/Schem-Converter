const test = require('node:test');
const assert = require('node:assert/strict');
const { convertPalette, convertPaletteEntry, findSubstitute } = require('../lib/palette');
const { loadBlockData } = require('../lib/versions');

const to1_13 = loadBlockData('1.13.2');
const to1_16 = loadBlockData('1.16.5');
const to1_19 = loadBlockData('1.19.4');
const to1_21 = loadBlockData('1.21.4');

test('existing block is left untouched', () => {
  const result = convertPaletteEntry({ name: 'minecraft:stone', properties: {} }, to1_13);
  assert.equal(result.name, 'minecraft:stone');
  assert.equal(result.substitutedFrom, undefined);
});

test('material rule substitutes a newer variant that does not exist yet', () => {
  const name = findSubstitute('pale_oak_planks', to1_21.blocks);
  // pale_oak_planks exists in 1.21.4 itself; use a version that lacks it.
  const older = to1_13.blocks;
  const substitute = findSubstitute('pale_oak_planks', older);
  assert.equal(substitute, 'oak_planks');
});

test('shape suffix falls back when material rule does not apply', () => {
  // dark_prismarine_stairs (a shape suffix case with no material rule mapping)
  const substitute = findSubstitute('some_totally_unknown_block_stairs', to1_13.blocks);
  assert.equal(substitute, 'oak_stairs');
});

test('unmappable block hits the command_block marker', () => {
  const substitute = findSubstitute('vault', to1_13.blocks);
  assert.equal(substitute, 'command_block');
});

test('unknown property is stripped and replaced with the target default', () => {
  const result = convertPaletteEntry(
    { name: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'true' } },
    to1_13
  );
  // 1.13 oak_stairs does have waterlogged, so this should be kept - use a
  // version-appropriate invalid VALUE instead to prove the strip path.
  assert.equal(result.properties.waterlogged, 'true');

  const withBadValue = convertPaletteEntry(
    { name: 'minecraft:oak_stairs', properties: { facing: 'sideways', half: 'bottom', shape: 'straight', waterlogged: 'true' } },
    to1_13
  );
  assert.equal(withBadValue.properties.facing, to1_13.blocks.oak_stairs.defaults.facing);
});

test('missing property is filled from the target default', () => {
  const result = convertPaletteEntry({ name: 'minecraft:oak_log', properties: {} }, to1_13);
  assert.equal(result.properties.axis, to1_13.blocks.oak_log.defaults.axis);
});

test('copper_bulb maps to redstone_lamp via the explicit table', () => {
  const result = convertPaletteEntry({ name: 'minecraft:copper_bulb', properties: {} }, to1_13);
  assert.equal(result.name, 'minecraft:redstone_lamp');
});

test('palette length is invariant across conversion', () => {
  const palette = [
    { name: 'minecraft:air', properties: {} },
    { name: 'minecraft:pale_oak_planks', properties: {} },
    { name: 'minecraft:vault', properties: {} },
    { name: 'minecraft:oak_log', properties: { axis: 'y' } },
  ];
  const { palette: converted } = convertPalette(palette, to1_13);
  assert.equal(converted.length, palette.length);
});

test('report lists every distinct substitution once', () => {
  const palette = [
    { name: 'minecraft:vault', properties: {} },
    { name: 'minecraft:vault', properties: {} },
    { name: 'minecraft:crafter', properties: {} },
  ];
  const { report } = convertPalette(palette, to1_13);
  assert.equal(report.length, 2);
});

// --- reported bug: split blocks were losing their per-instance value entirely ---

test('BUG REPORT: a filled water cauldron downgrades to a filled cauldron, not a command block', () => {
  const result = convertPaletteEntry({ name: 'minecraft:water_cauldron', properties: { level: '2' } }, to1_16);
  assert.equal(result.name, 'minecraft:cauldron');
  assert.equal(result.properties.level, '2');
});

test('a lava cauldron downgrades to a full cauldron (no level property to carry)', () => {
  const result = convertPaletteEntry({ name: 'minecraft:lava_cauldron', properties: {} }, to1_16);
  assert.equal(result.name, 'minecraft:cauldron');
  assert.equal(result.properties.level, '3');
});

test('a powder snow cauldron carries its level across the split too', () => {
  const result = convertPaletteEntry({ name: 'minecraft:powder_snow_cauldron', properties: { level: '1' } }, to1_16);
  assert.equal(result.name, 'minecraft:cauldron');
  assert.equal(result.properties.level, '1');
});

// --- renames apply in both directions ---

test('oak_sign downgrades to sign on 1.13.2 (pre-rename)', () => {
  const result = convertPaletteEntry({ name: 'minecraft:oak_sign', properties: { rotation: '5' } }, to1_13);
  assert.equal(result.name, 'minecraft:sign');
});

test('sign upgrades to oak_sign on 1.16.5 (post-rename) - the reverse direction', () => {
  const result = convertPaletteEntry({ name: 'minecraft:sign', properties: { rotation: '5' } }, to1_16);
  assert.equal(result.name, 'minecraft:oak_sign');
});

test('short_grass downgrades to grass on 1.19.4', () => {
  assert.equal(findSubstitute('short_grass', to1_19.blocks), 'grass');
});

test('grass upgrades to short_grass on 1.21.4', () => {
  assert.equal(findSubstitute('grass', to1_21.blocks), 'short_grass');
});

// --- prefix strip must win over a material rule producing a fake name ---

test('deepslate_gold_ore resolves to gold_ore, not the non-existent stone_gold_ore', () => {
  assert.equal(findSubstitute('deepslate_gold_ore', to1_16.blocks), 'gold_ore');
});

// --- substitution tiers must chain when the first candidate is also missing ---

test('budding_amethyst chains past the also-missing amethyst_block to something real', () => {
  const result = findSubstitute('budding_amethyst', to1_16.blocks);
  assert.notEqual(result, 'command_block');
  assert.ok(to1_16.blocks[result], `${result} should exist in the target`);
});

test('oak_hanging_sign falls past the missing oak_sign to sign on 1.13.2', () => {
  assert.equal(findSubstitute('oak_hanging_sign', to1_13.blocks), 'sign');
});

// --- the marker must still fire for blocks with no real equivalent ---

test('a genuinely new block with no equivalent still hits the command_block marker', () => {
  assert.equal(findSubstitute('vault', to1_13.blocks), 'command_block');
});

test('BUG REPORT: blocks with no obvious equivalent hit the marker instead of a misleading lookalike', () => {
  // Reported: composter->crafting_table, honey_block->slime_block, and
  // ancient_debris->netherrack all preserve nothing (not shape, not
  // material, not function) - a schematic reader has no way to guess the
  // original block back out. Removed from data/substitutions.json; the
  // marker is the honest answer per the user's own stated principle -
  // "if is not a obvious conversion... just set command block".
  for (const name of [
    'composter',
    'honey_block',
    'ancient_debris',
    'bell',
    'target',
    'lodestone',
    'loom',
    'cartography_table',
    'fletching_table',
    'smithing_table',
    'stonecutter',
    'grindstone',
    'lectern',
    'scaffolding',
    'sculk',
    'bee_nest',
    'beehive',
  ]) {
    assert.equal(findSubstitute(name, to1_13.blocks), 'command_block', `${name} should hit the marker`);
  }
});

test('raw_copper_block matches the rest of the copper family (orange_terracotta), not iron_block', () => {
  assert.equal(findSubstitute('raw_copper_block', to1_13.blocks), 'orange_terracotta');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertPalette, convertPaletteEntry, findSubstitute } = require('../lib/palette');
const { loadBlockData } = require('../lib/versions');

const to1_13 = loadBlockData('1.13.2');
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

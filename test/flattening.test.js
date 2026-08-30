const test = require('node:test');
const assert = require('node:assert/strict');
const { flattenState } = require('../lib/flattening');

test('log variant + axis flattens to the pre-1.13 id:meta blockstate', () => {
  const result = flattenState({ name: 'minecraft:oak_log', properties: { axis: 'x' } });
  assert.equal(result.name, 'minecraft:log');
  assert.equal(result.properties.variant, 'oak');
  assert.equal(result.properties.axis, 'x');
});

test('color-named block flattens to base block + color property', () => {
  const result = flattenState({ name: 'minecraft:red_wool', properties: {} });
  assert.equal(result.name, 'minecraft:wool');
  assert.equal(result.properties.color, 'red');
});

test('a waterlogged stairs state (1.12 has no such concept) still preserves its orientation', () => {
  // lib/palette.js's fixProperties always fills every property the target
  // (1.13.2) block has, including waterlogged - it never omits it. A
  // waterlogged=true block has no exact vendor entry (only the default,
  // waterlogged=false, was ever representable in 1.12), so this exercises
  // the canonicalize() fallback: lose "waterlogged", keep orientation.
  const result = flattenState({
    name: 'minecraft:oak_stairs',
    properties: { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'true' },
  });
  assert.equal(result.name, 'minecraft:oak_stairs');
  assert.equal(result.properties.facing, 'north');
  assert.equal(result.properties.half, 'bottom');
  assert.equal(result.properties.shape, 'straight');
});

test('cave_air and pumpkin use the explicit fallback table', () => {
  assert.equal(flattenState({ name: 'minecraft:cave_air', properties: {} }).name, 'minecraft:air');
  const pumpkin = flattenState({ name: 'minecraft:pumpkin', properties: {} });
  assert.equal(pumpkin.name, 'minecraft:pumpkin');
  assert.equal(pumpkin.properties.facing, 'north');
});

test('note_block collapses to noteblock (pitch requires per-position TileEntities work, out of scope)', () => {
  const result = flattenState({ name: 'minecraft:note_block', properties: { instrument: 'harp', note: '13', powered: 'false' } });
  assert.equal(result.name, 'minecraft:noteblock');
});

test('a colored bed aliases to bed, preserving facing/occupied/part but not color', () => {
  const result = flattenState({
    name: 'minecraft:blue_bed',
    properties: { facing: 'north', occupied: 'false', part: 'foot' },
  });
  assert.equal(result.name, 'minecraft:bed');
  assert.equal(result.properties.facing, 'north');
  assert.equal(result.properties.part, 'foot');
});

test('a colored banner aliases to standing_banner, preserving rotation', () => {
  const result = flattenState({ name: 'minecraft:red_banner', properties: { rotation: '3' } });
  assert.equal(result.name, 'minecraft:standing_banner');
  assert.equal(result.properties.rotation, '3');
});

test('a wall banner aliases to wall_banner, preserving facing', () => {
  const result = flattenState({ name: 'minecraft:blue_wall_banner', properties: { facing: 'south' } });
  assert.equal(result.name, 'minecraft:wall_banner');
  assert.equal(result.properties.facing, 'south');
});

test('a mob head aliases to skull', () => {
  const result = flattenState({ name: 'minecraft:creeper_head', properties: {} });
  assert.equal(result.name, 'minecraft:skull');
});

test('a genuinely unmapped block falls all the way through to the command_block marker', () => {
  const result = flattenState({ name: 'minecraft:command_block', properties: { facing: 'north', conditional: 'false' } });
  assert.equal(result.name, 'minecraft:command_block');
});

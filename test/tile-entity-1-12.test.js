const test = require('node:test');
const assert = require('node:assert/strict');
const { tileEntityUpdateFor, bedColorFor, bannerBaseFor, skullTypeFor } = require('../lib/tile-entity-1-12');

test('bed colors follow dye order (0=white .. 15=black)', () => {
  assert.equal(bedColorFor('white_bed'), 0);
  assert.equal(bedColorFor('red_bed'), 14);
  assert.equal(bedColorFor('black_bed'), 15);
  assert.equal(bedColorFor('oak_planks'), null);
});

test('banner Base is INVERTED dye order (0=black .. 15=white)', () => {
  assert.equal(bannerBaseFor('black_banner'), 0);
  assert.equal(bannerBaseFor('red_banner'), 1);
  assert.equal(bannerBaseFor('white_banner'), 15);
  assert.equal(bannerBaseFor('white_wall_banner'), 15);
});

test('skull type numbering matches the item damage table', () => {
  assert.equal(skullTypeFor('skeleton_skull'), 0);
  assert.equal(skullTypeFor('wither_skeleton_skull'), 1);
  assert.equal(skullTypeFor('wither_skeleton_wall_skull'), 1);
  assert.equal(skullTypeFor('zombie_head'), 2);
  assert.equal(skullTypeFor('player_head'), 3);
  assert.equal(skullTypeFor('creeper_head'), 4);
  assert.equal(skullTypeFor('creeper_wall_head'), 4);
  assert.equal(skullTypeFor('dragon_head'), 5);
  assert.equal(skullTypeFor('oak_log'), null);
});

test('tileEntityUpdateFor: note_block carries its pitch', () => {
  const update = tileEntityUpdateFor({ name: 'minecraft:note_block', properties: { note: '13', instrument: 'harp', powered: 'false' } });
  assert.equal(update.blockEntityId, 'minecraft:noteblock');
  assert.equal(update.fields.note.value, 13);
});

test('tileEntityUpdateFor: floor skull carries type and rotation', () => {
  const update = tileEntityUpdateFor({ name: 'minecraft:creeper_head', properties: { rotation: '7' } });
  assert.equal(update.blockEntityId, 'minecraft:skull');
  assert.equal(update.fields.SkullType.value, 4);
  assert.equal(update.fields.Rot.value, 7);
});

test('tileEntityUpdateFor: wall skull has no Rot field', () => {
  const update = tileEntityUpdateFor({ name: 'minecraft:creeper_wall_head', properties: { facing: 'north' } });
  assert.equal(update.fields.Rot, undefined);
});

test('tileEntityUpdateFor: banner and bed carry their colour', () => {
  assert.equal(tileEntityUpdateFor({ name: 'minecraft:red_banner', properties: { rotation: '3' } }).fields.Base.value, 1);
  assert.equal(tileEntityUpdateFor({ name: 'minecraft:blue_bed', properties: {} }).fields.color.value, 11);
});

test('tileEntityUpdateFor: an unrelated block returns null', () => {
  assert.equal(tileEntityUpdateFor({ name: 'minecraft:oak_planks', properties: {} }), null);
});

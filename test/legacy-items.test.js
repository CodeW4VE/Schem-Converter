const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLegacyItem, legacyEnchantmentId, enchantmentNameFromLegacyId } = require('../lib/legacy-items');

test('a colour-variant item resolves to its 1.12.2 base item + Damage meta', () => {
  assert.deepEqual(resolveLegacyItem('red_wool'), { name: 'wool', damage: 14 });
});

test('an item identical across versions resolves with Damage 0', () => {
  assert.deepEqual(resolveLegacyItem('diamond_sword'), { name: 'diamond_sword', damage: 0 });
});

test('an item that postdates 1.12.2 has no legacy entry', () => {
  assert.equal(resolveLegacyItem('crafter'), null);
  assert.equal(resolveLegacyItem('netherite_sword'), null);
});

test('enchantment numeric ids round-trip name <-> id', () => {
  const id = legacyEnchantmentId('sharpness');
  assert.equal(typeof id, 'number');
  assert.equal(enchantmentNameFromLegacyId(id), 'sharpness');
});

test('an enchantment added after 1.12.2 has no numeric id', () => {
  assert.equal(legacyEnchantmentId('swift_sneak'), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveItemName, ITEM_MARKER } = require('../lib/items');

function indexOf(names) {
  const index = {};
  for (const n of names) index[n] = true;
  return index;
}

test('existing item is left alone', () => {
  const result = resolveItemName('stone', indexOf(['stone']));
  assert.equal(result.name, 'stone');
  assert.equal(result.substitutedFrom, undefined);
});

test('netherite_sword resolves to diamond_sword via itemRules on an old target', () => {
  const result = resolveItemName('netherite_sword', indexOf(['diamond_sword']));
  assert.equal(result.name, 'diamond_sword');
  assert.equal(result.substitutedFrom, 'netherite_sword');
});

test('block-shaped item rules apply too (shares the block resolver graph)', () => {
  // deepslate_gold_ore is a block-only name, but the same prefix-strip rule
  // that helps blocks also helps an item id shaped like a block name.
  const result = resolveItemName('deepslate_gold_ore', indexOf(['gold_ore']));
  assert.equal(result.name, 'gold_ore');
});

test('a genuinely new item with no equivalent hits the marker', () => {
  const result = resolveItemName('trial_key', indexOf(['stone']));
  assert.equal(result.name, ITEM_MARKER);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertSchematic } = require('../lib/convert');

// One item stack in a chest tile entity - the generic shape (any compound
// with `id` + Count/count) that lib/convert.js's isItemStack detects.
function rootWithItem(item, fromDataVersion) {
  return {
    Version: { type: 'int', value: 7 },
    MinecraftDataVersion: { type: 'int', value: fromDataVersion },
    Regions: {
      type: 'compound',
      value: {
        Main: {
          type: 'compound',
          value: {
            BlockStatePalette: { type: 'list', value: { type: 'compound', value: [] } },
            TileEntities: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  {
                    id: { type: 'string', value: 'minecraft:chest' },
                    Items: { type: 'list', value: { type: 'compound', value: [item] } },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

function firstItem(root) {
  return root.Regions.value.Main.value.TileEntities.value.value[0].Items.value.value[0];
}

test('B1: a genuinely new item hits the command_block marker and is reported', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:crafter' }, count: { type: 'int', value: 1 } }, 4440);
  const report = convertSchematic(root, 4440, '1.13.2');

  assert.equal(firstItem(root).id.value, 'minecraft:command_block');
  assert.ok(report.toLines().some(l => l.includes('crafter') && l.includes('command_block')));
});

test('B1: netherite_sword resolves to diamond_sword on a pre-Netherite target', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:netherite_sword' }, count: { type: 'int', value: 1 } }, 4440);
  convertSchematic(root, 4440, '1.13.2');
  assert.equal(firstItem(root).id.value, 'minecraft:diamond_sword');
});

test('B1a: the marker carries the original item name (1.13-1.20.4: JSON string in tag.display.Name)', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:crafter' }, count: { type: 'int', value: 1 } }, 4440);
  convertSchematic(root, 4440, '1.16.5');
  const item = firstItem(root);
  assert.equal(item.id.value, 'minecraft:command_block');
  assert.equal(item.tag.value.display.value.Name.value, '"crafter"');
});

test('B1a: the marker name is a plain string on a 1.12.2 target', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:crafter' }, count: { type: 'int', value: 1 } }, 4440);
  convertSchematic(root, 4440, '1.12.2');
  const item = firstItem(root);
  assert.equal(item.id.value, 'minecraft:command_block');
  assert.equal(item.tag.value.display.value.Name.value, 'crafter');
});

test('B1a: the marker name is an NBT component on a 1.21.5+ target', () => {
  // A made-up id with no equivalent in any supported version's item list -
  // 1.21.8 is the newest we have data for, so nothing real is missing from
  // it; this stands in for "a future item downgraded to today's newest".
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:totally_new_gadget' }, count: { type: 'int', value: 1 } }, 4440);
  convertSchematic(root, 4440, '1.21.8');
  const item = firstItem(root);
  assert.equal(item.id.value, 'minecraft:command_block');
  assert.equal(item.components.value['minecraft:custom_name'].type, 'string');
  assert.equal(item.components.value['minecraft:custom_name'].value, 'totally_new_gadget');
});

test('B2: Count is a byte on downgrade past 1.20.5, not the int the old code wrote', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:stone' }, count: { type: 'int', value: 5 } }, 4440);
  convertSchematic(root, 4440, '1.16.5');
  const item = firstItem(root);
  assert.equal(item.Count.type, 'byte');
  assert.equal(item.Count.value, 5);
  assert.equal(item.count, undefined);
});

test('B2: count/Count detection is scoped to real item stacks (an unrelated `count` key is left alone)', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:stone' }, count: { type: 'int', value: 5 } }, 4440);
  root.Regions.value.Main.value.SomeUnrelatedThing = { type: 'compound', value: { count: { type: 'int', value: 99 } } };
  convertSchematic(root, 4440, '1.16.5');
  assert.equal(root.Regions.value.Main.value.SomeUnrelatedThing.value.count.value, 99);
});

test('B3: custom name, lore, enchantments and damage move from components to tag on downgrade', () => {
  const item = {
    id: { type: 'string', value: 'minecraft:diamond_sword' },
    count: { type: 'int', value: 1 },
    components: {
      type: 'compound',
      value: {
        'minecraft:custom_name': { type: 'string', value: 'Excalibur' },
        'minecraft:lore': { type: 'list', value: { type: 'string', value: ['A fine blade'] } },
        'minecraft:enchantments': {
          type: 'compound',
          value: { levels: { type: 'compound', value: { 'minecraft:sharpness': { type: 'int', value: 5 } } } },
        },
        'minecraft:damage': { type: 'int', value: 42 },
      },
    },
  };
  const root = rootWithItem(item, 4440);
  convertSchematic(root, 4440, '1.16.5');
  const out = firstItem(root);

  assert.equal(out.components, undefined); // whole compound dropped, not just the four keys
  assert.equal(out.tag.value.display.value.Name.value, '"Excalibur"');
  assert.equal(out.tag.value.display.value.Lore.value.value[0], '"A fine blade"');
  assert.equal(out.tag.value.Enchantments.value.value[0].id.value, 'minecraft:sharpness');
  assert.equal(out.tag.value.Enchantments.value.value[0].lvl.value, 5);
  assert.equal(out.Damage.value, 42);
});

test('B3: the reverse direction - tag fields become components on upgrade past 1.20.5', () => {
  const item = {
    id: { type: 'string', value: 'minecraft:diamond_sword' },
    Count: { type: 'byte', value: 1 },
    tag: {
      type: 'compound',
      value: {
        display: { type: 'compound', value: { Name: { type: 'string', value: '{"text":"Excalibur"}' } } },
        Enchantments: {
          type: 'list',
          value: { type: 'compound', value: [{ id: { type: 'string', value: 'minecraft:sharpness' }, lvl: { type: 'short', value: 5 } }] },
        },
      },
    },
  };
  const root = rootWithItem(item, 3465); // 1.20.1
  convertSchematic(root, 3465, '1.21.8');
  const out = firstItem(root);

  assert.equal(out.tag, undefined);
  assert.equal(out.components.value['minecraft:custom_name'].value, 'Excalibur');
  assert.deepEqual(Object.keys(out.components.value['minecraft:enchantments'].value.levels.value), ['minecraft:sharpness']);
});

test('B4: red_wool downgrades to wool + Damage 14 on 1.12.2', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:red_wool' }, count: { type: 'int', value: 3 } }, 4440);
  convertSchematic(root, 4440, '1.12.2');
  const item = firstItem(root);
  assert.equal(item.id.value, 'minecraft:wool');
  assert.equal(item.Damage.value, 14);
  assert.equal(item.Damage.type, 'short');
});

test('B4: an item with no legacy.json entry falls back to the generic B1 resolver, no bogus Damage', () => {
  const root = rootWithItem({ id: { type: 'string', value: 'minecraft:netherite_sword' }, count: { type: 'int', value: 1 } }, 4440);
  convertSchematic(root, 4440, '1.12.2');
  const item = firstItem(root);
  assert.equal(item.id.value, 'minecraft:diamond_sword');
  assert.equal(item.Damage, undefined);
});

test('B4: real durability is not clobbered by the legacy meta-Damage lookup', () => {
  const item = {
    id: { type: 'string', value: 'minecraft:diamond_sword' },
    count: { type: 'int', value: 1 },
    components: { type: 'compound', value: { 'minecraft:damage': { type: 'int', value: 42 } } },
  };
  const root = rootWithItem(item, 4440);
  convertSchematic(root, 4440, '1.12.2');
  const out = firstItem(root);
  assert.equal(out.id.value, 'minecraft:diamond_sword');
  assert.equal(out.Damage.value, 42); // durability survives, not overwritten with legacy meta 0
});

test('an enchantment with no 1.12.2 numeric id is dropped and reported, not silently lost', () => {
  // A diamond_sword (in legacy.json, unlike trident which postdates 1.12.2)
  // enchanted with swift_sneak (1.19+, no 1.12.2 numeric id at all).
  const item = {
    id: { type: 'string', value: 'minecraft:diamond_sword' },
    count: { type: 'int', value: 1 },
    components: {
      type: 'compound',
      value: {
        'minecraft:enchantments': {
          type: 'compound',
          value: { levels: { type: 'compound', value: { 'minecraft:swift_sneak': { type: 'int', value: 3 } } } },
        },
      },
    },
  };
  const root = rootWithItem(item, 4440);
  const report = convertSchematic(root, 4440, '1.12.2');
  const out = firstItem(root);
  assert.equal(out.id.value, 'minecraft:diamond_sword');
  assert.equal(out.tag, undefined); // nothing left to attach the enchantment to
  assert.ok(report.toLines().some(l => l.includes('swift_sneak')));
});

test('a genuinely new item with an unhandled minecraft:container component still converts its nested items', () => {
  // minecraft:container (shulker-box contents) isn't translated (see PLAN.md
  // "B3"), but it must survive being left in place well enough that `walk`
  // still reaches and converts the item nested inside it.
  const item = {
    id: { type: 'string', value: 'minecraft:shulker_box' },
    count: { type: 'int', value: 1 },
    components: {
      type: 'compound',
      value: {
        'minecraft:container': {
          type: 'list',
          value: {
            type: 'compound',
            value: [{ item: { id: { type: 'string', value: 'minecraft:crafter' }, count: { type: 'int', value: 1 } } }],
          },
        },
      },
    },
  };
  const root = rootWithItem(item, 4440);
  convertSchematic(root, 4440, '1.13.2');
  const out = firstItem(root);
  assert.ok(out.components, 'the unhandled component must survive, not be deleted wholesale');
  const nested = out.components.value['minecraft:container'].value.value[0].item;
  assert.equal(nested.id.value, 'minecraft:command_block'); // still resolved despite the unhandled wrapper
});

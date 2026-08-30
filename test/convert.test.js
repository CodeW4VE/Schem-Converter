const test = require('node:test');
const assert = require('node:assert/strict');
const { convertSchematic } = require('../lib/convert');
const { loadBlockData, SUPPORTED } = require('../lib/versions');

function buildRoot(overrides = {}) {
  return {
    Version: { type: 'int', value: 7 },
    MinecraftDataVersion: { type: 'int', value: 4189 }, // 1.21.4
    Regions: {
      type: 'compound',
      value: {
        Main: {
          type: 'compound',
          value: {
            BlockStatePalette: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  { Name: { type: 'string', value: 'minecraft:air' } },
                  { Name: { type: 'string', value: 'minecraft:vault' } },
                ],
              },
            },
            TileEntities: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  { id: { type: 'string', value: 'minecraft:chest' }, x: { type: 'int', value: 0 } },
                  { id: { type: 'string', value: 'minecraft:vault' }, x: { type: 'int', value: 1 } },
                ],
              },
            },
            Entities: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  { id: { type: 'string', value: 'minecraft:pig' } },
                  { id: { type: 'string', value: 'minecraft:breeze' } },
                ],
              },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

test('regression: 6->5 style downgrade actually rewrites the palette (bug 2)', () => {
  const root = buildRoot();
  convertSchematic(root, 4189, '1.13.2');

  const target = loadBlockData('1.13.2');
  assert.equal(root.Version.value, SUPPORTED['1.13.2']);
  assert.equal(root.MinecraftDataVersion.value, target.dataVersion);

  const palette = root.Regions.value.Main.value.BlockStatePalette.value.value;
  assert.equal(palette.length, 2); // invariant
  assert.equal(palette[1].Name.value, 'minecraft:command_block'); // vault has no 1.13 equivalent
});

test('unknown mob entities are dropped, known ones kept', () => {
  const root = buildRoot();
  convertSchematic(root, 4189, '1.13.2');

  const entities = root.Regions.value.Main.value.Entities.value.value;
  assert.equal(entities.length, 1);
  assert.equal(entities[0].id.value, 'minecraft:pig');
});

test('tile entities (block entities) are left alone - no per-version id list exists to filter them against', () => {
  const root = buildRoot();
  convertSchematic(root, 4189, '1.13.2');

  const tileEntities = root.Regions.value.Main.value.TileEntities.value.value;
  assert.equal(tileEntities.length, 2);
});

test('sign tags convert front_text/back_text -> Text1-4 when downgrading past 1.20', () => {
  const root = buildRoot({
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
                    id: { type: 'string', value: 'minecraft:sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 1 },
                        color: { type: 'string', value: 'red' },
                        messages: {
                          type: 'list',
                          value: { type: 'string', value: ['{"text":"hi"}', '', '', ''] },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4189, '1.13.2'); // 1.13.2 dataVersion is well below the 3463 threshold

  const sign = root.Regions.value.Main.value.TileEntities.value.value[0];
  assert.equal(sign.Text1.value, '{"text":"hi"}');
  assert.equal(sign.front_text, undefined);
});

test('BUG REPORT: sign text is not empty after downgrading a 1.21.5+ (NBT component) sign', () => {
  const root = buildRoot({
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
                    id: { type: 'string', value: 'minecraft:sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        // 1.21.5+ shape: messages are real NBT strings, not JSON.
                        messages: { type: 'list', value: { type: 'string', value: ['Hello', 'world', '', ''] } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4440, '1.12.2'); // 1.21.8 -> 1.12.2

  const sign = root.Regions.value.Main.value.TileEntities.value.value[0];
  assert.equal(sign.Text1.value, '"Hello"');
  assert.equal(sign.Text2.value, '"world"');
  assert.equal(sign.id.value, 'minecraft:sign'); // A4: id survives, not hanging_sign
});

test('sign conversion is a no-op when source and target agree on encoding+shape', () => {
  const root = buildRoot({
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
                value: [{ id: { type: 'string', value: 'minecraft:sign' }, Text1: { type: 'string', value: '{"text":"kept"}' } }],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 1631, '1.14.4'); // both json-text1-4 side

  const sign = root.Regions.value.Main.value.TileEntities.value.value[0];
  assert.equal(sign.Text1.value, '{"text":"kept"}');
});

test('A2: text survives a downgrade that stays on the front_text/back_text shape (1.21.8 -> 1.20.4)', () => {
  const root = buildRoot({
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
                    id: { type: 'string', value: 'minecraft:sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        messages: { type: 'list', value: { type: 'string', value: ['Hello', '', '', ''] } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4440, '1.20.4'); // this path used to be a total no-op (bug A2)

  const sign = root.Regions.value.Main.value.TileEntities.value.value[0];
  assert.equal(sign.front_text.value.messages.value.type, 'string');
  assert.equal(sign.front_text.value.messages.value.value[0], '"Hello"');
});

test('a coloured/bold sign round-trips its formatting into an NBT component and back', () => {
  const root = buildRoot({
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
                    id: { type: 'string', value: 'minecraft:sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        messages: {
                          type: 'list',
                          value: { type: 'string', value: ['{"text":"Hi","color":"red","bold":true}', '', '', ''] },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4189, '1.21.8'); // upgrade past the 4325 encoding boundary

  const up = root.Regions.value.Main.value.TileEntities.value.value[0];
  const upMessages = up.front_text.value.messages.value;
  assert.equal(upMessages.type, 'compound');
  assert.equal(upMessages.value[0].color.value, 'red');
  assert.equal(upMessages.value[0].bold.value, 1);

  convertSchematic(root, 4440, '1.20.1'); // and back down, staying on the front_text shape

  const down = root.Regions.value.Main.value.TileEntities.value.value[0];
  const downMessages = down.front_text.value.messages.value.value;
  const decoded = JSON.parse(downMessages[0]);
  assert.equal(decoded.color, 'red');
  assert.equal(decoded.bold, true);
});

test('A4: a hanging sign keeps its tile entity on a pre-1.20 target, id remapped to sign', () => {
  const root = buildRoot({
    Regions: {
      type: 'compound',
      value: {
        Main: {
          type: 'compound',
          value: {
            BlockStatePalette: {
              type: 'list',
              value: { type: 'compound', value: [{ Name: { type: 'string', value: 'minecraft:oak_hanging_sign' } }] },
            },
            TileEntities: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  {
                    id: { type: 'string', value: 'minecraft:hanging_sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        messages: { type: 'list', value: { type: 'string', value: ['Hi', '', '', ''] } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4440, '1.16.5');

  const sign = root.Regions.value.Main.value.TileEntities.value.value[0];
  assert.equal(sign.id.value, 'minecraft:sign');
  assert.equal(sign.Text1.value, '"Hi"');
});

test('A5: a dropped back side is named in the report', () => {
  const root = buildRoot({
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
                    id: { type: 'string', value: 'minecraft:sign' },
                    front_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        messages: { type: 'list', value: { type: 'string', value: ['Hi', '', '', ''] } },
                      },
                    },
                    back_text: {
                      type: 'compound',
                      value: {
                        has_glowing_text: { type: 'byte', value: 0 },
                        color: { type: 'string', value: 'black' },
                        messages: { type: 'list', value: { type: 'string', value: ['Back side', '', '', ''] } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  const report = convertSchematic(root, 4189, '1.13.2');
  assert.ok(report.toLines().some(line => line.includes('back text dropped')));
});

test('count tags convert count -> Count when downgrading past 1.20.5', () => {
  const root = buildRoot({
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
                    Items: {
                      type: 'list',
                      value: {
                        type: 'compound',
                        value: [{ id: { type: 'string', value: 'minecraft:stone' }, count: { type: 'int', value: 5 } }],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });

  convertSchematic(root, 4189, '1.13.2');

  const item = root.Regions.value.Main.value.TileEntities.value.value[0].Items.value.value[0];
  assert.equal(item.Count.value, 5);
  assert.equal(item.count, undefined);
});

// Test-only encoder matching LitematicaBitArray.setAt (see test/blockstates.test.js
// for the full version with cross-long-boundary support) - only single-long
// packing is needed for this fixture's tiny palette.
function encodeBlockStates(values, bits) {
  const maxEntryValue = (1n << BigInt(bits)) - 1n;
  const longs = [0n];
  values.forEach((value, index) => {
    longs[0] |= (BigInt(value) & maxEntryValue) << BigInt(index * bits);
  });
  return longs.map(l => BigInt.asIntN(64, l));
}

test('1.12.2 target: note/skull/banner/bed per-position values are correlated via BlockStates decode', () => {
  // 2x1x2 region. index = y*sizeLayer + z*sizeX + x, sizeLayer = sizeX*sizeZ = 4.
  // (0,0,0)->air, (1,0,0)->note_block, (0,0,1)->red_banner, (1,0,1)->blue_bed
  const values = [0, 1, 2, 3];
  const longArray = encodeBlockStates(values, 2);

  const root = {
    Version: { type: 'int', value: 7 },
    MinecraftDataVersion: { type: 'int', value: 4189 },
    Regions: {
      type: 'compound',
      value: {
        Main: {
          type: 'compound',
          value: {
            Size: { type: 'compound', value: { x: { type: 'int', value: 2 }, y: { type: 'int', value: 1 }, z: { type: 'int', value: 2 } } },
            BlockStates: { type: 'longArray', value: longArray },
            BlockStatePalette: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  { Name: { type: 'string', value: 'minecraft:air' } },
                  {
                    Name: { type: 'string', value: 'minecraft:note_block' },
                    Properties: { type: 'compound', value: { note: { type: 'string', value: '13' }, instrument: { type: 'string', value: 'harp' }, powered: { type: 'string', value: 'false' } } },
                  },
                  {
                    Name: { type: 'string', value: 'minecraft:red_banner' },
                    Properties: { type: 'compound', value: { rotation: { type: 'string', value: '3' } } },
                  },
                  {
                    Name: { type: 'string', value: 'minecraft:blue_bed' },
                    Properties: { type: 'compound', value: { facing: { type: 'string', value: 'north' }, occupied: { type: 'string', value: 'false' }, part: { type: 'string', value: 'foot' } } },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };

  convertSchematic(root, 4189, '1.12.2');

  const tileEntities = root.Regions.value.Main.value.TileEntities.value.value;
  const byId = Object.fromEntries(tileEntities.map(te => [te.id.value, te]));

  assert.equal(byId['minecraft:noteblock'].x.value, 1);
  assert.equal(byId['minecraft:noteblock'].z.value, 0);
  assert.equal(byId['minecraft:noteblock'].note.value, 13);

  assert.equal(byId['minecraft:banner'].x.value, 0);
  assert.equal(byId['minecraft:banner'].z.value, 1);
  assert.equal(byId['minecraft:banner'].Base.value, 1); // red

  assert.equal(byId['minecraft:bed'].x.value, 1);
  assert.equal(byId['minecraft:bed'].z.value, 1);
  assert.equal(byId['minecraft:bed'].color.value, 11); // blue

  const palette = root.Regions.value.Main.value.BlockStatePalette.value.value;
  assert.equal(palette[2].Name.value, 'minecraft:standing_banner');
  assert.equal(palette[3].Name.value, 'minecraft:bed');
});

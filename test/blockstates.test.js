const test = require('node:test');
const assert = require('node:assert/strict');
const { bitsForPaletteSize, decodeBlockStates, indexToPos } = require('../lib/blockstates');

// Test-only encoder, a direct translation of LitematicaBitArray.setAt - used
// to build known-good fixtures, and to cross-check decodeBlockStates by
// round-tripping. Deliberately NOT shared with lib/blockstates.js: this repo
// never needs to write BlockStates (palette length is invariant across every
// conversion here), so production code has no encoder.
function encodeBlockStates(values, bits) {
  const maxEntryValue = (1n << BigInt(bits)) - 1n;
  const longCount = Math.ceil((values.length * bits) / 64);
  const longs = new Array(longCount).fill(0n);

  values.forEach((value, index) => {
    const v = BigInt(value) & maxEntryValue;
    const startOffset = index * bits;
    const startArrIndex = Math.floor(startOffset / 64);
    const endArrIndex = Math.floor(((index + 1) * bits - 1) / 64);
    const startBitOffset = BigInt(startOffset % 64);

    longs[startArrIndex] = BigInt.asUintN(64, longs[startArrIndex] | (v << startBitOffset));
    if (startArrIndex !== endArrIndex) {
      const endOffset = 64n - startBitOffset;
      longs[endArrIndex] = BigInt.asUintN(64, longs[endArrIndex] | (v >> endOffset));
    }
  });

  return longs.map(l => BigInt.asIntN(64, l));
}

test('bitsForPaletteSize matches known values', () => {
  assert.equal(bitsForPaletteSize(1), 2);
  assert.equal(bitsForPaletteSize(2), 2);
  assert.equal(bitsForPaletteSize(4), 2);
  assert.equal(bitsForPaletteSize(5), 3);
  assert.equal(bitsForPaletteSize(8), 3);
  assert.equal(bitsForPaletteSize(9), 4);
  assert.equal(bitsForPaletteSize(256), 8);
  assert.equal(bitsForPaletteSize(257), 9);
});

test('hand-computed single-long case: 4 entries, 2 bits each', () => {
  // ids [3,2,1,0] packed low-to-high: 3 | (2<<2) | (1<<4) | (0<<6) = 27
  const longArray = [27n];
  const decoded = decodeBlockStates(longArray, 2, 4);
  assert.deepEqual(Array.from(decoded), [3, 2, 1, 0]);
});

test('round-trip: entries crossing a 64-bit long boundary decode correctly', () => {
  const bits = 5; // palette size up to 32; 5*13=65 bits, entry 12 spans two longs
  const values = Array.from({ length: 40 }, (_, i) => (i * 7) % 32);
  const longArray = encodeBlockStates(values, bits);
  const decoded = decodeBlockStates(longArray, bits, values.length);
  assert.deepEqual(Array.from(decoded), values);
});

test('round-trip: a variety of palette sizes and volumes', () => {
  for (const paletteSize of [2, 3, 5, 17, 100, 300]) {
    const bits = bitsForPaletteSize(paletteSize);
    const volume = 137; // deliberately not a multiple of anything convenient
    const values = Array.from({ length: volume }, (_, i) => i % paletteSize);
    const longArray = encodeBlockStates(values, bits);
    const decoded = decodeBlockStates(longArray, bits, volume);
    assert.deepEqual(Array.from(decoded), values, `paletteSize=${paletteSize}`);
  }
});

test('indexToPos inverts Litematica\'s y*sizeLayer + z*sizeX + x formula', () => {
  const sizeX = 3;
  const sizeZ = 4;
  for (let y = 0; y < 2; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const index = y * (sizeX * sizeZ) + z * sizeX + x;
        assert.deepEqual(indexToPos(index, sizeX, sizeZ), { x, y, z });
      }
    }
  }
});

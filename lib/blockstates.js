// Decodes Litematica's packed BlockStates long array back into a per-position
// palette index. This is a direct translation of the encode/decode algorithm
// in Litematica's own LitematicaBitArray.java and
// LitematicaBlockStateContainerFull.java (commit 8b2d0cab, see PLAN.md Phase 6
// for the source references) - not reverse-engineered, copied from the
// source that writes these files, since getting bit offsets wrong silently
// misreads every block's position.
//
// Litematica's packing is the "modern" style: an entry CAN span two 64-bit
// longs (no padding), unlike vanilla's pre-1.16 chunk format. Reading requires
// real 64-bit unsigned arithmetic, which is why this uses BigInt throughout.
//
// Used only for the narrow case of correlating a handful of "kind B" palette
// entries (note_block, skulls, banners, beds - see lib/tile-entity-1-12.js)
// with their actual positions when downgrading to 1.12; see the caller in
// lib/convert.js for why this is worth decoding despite the position-based
// bit-decode ceiling documented elsewhere as out of scope for TileEntities
// filtering in general - here it's a bounded, opt-in decode, not blanket
// per-position bookkeeping for the whole schematic.

// Matches Java's `Math.max(2, Integer.SIZE - Integer.numberOfLeadingZeros(paletteSize - 1))`.
function bitsForPaletteSize(paletteSize) {
  const n = Math.max(paletteSize - 1, 0);
  const leadingZeros = n === 0 ? 32 : Math.clz32(n);
  return Math.max(2, 32 - leadingZeros);
}

// longArray: array of BigInt-coercible values (prismarine-nbt's parsed
// longArray entries, or plain BigInt/number for tests).
// Returns a Uint32Array of length `volume`, one palette index per position.
function decodeBlockStates(longArray, bits, volume) {
  const longs = longArray.map(v => BigInt.asUintN(64, BigInt(v)));
  const maxEntryValue = (1n << BigInt(bits)) - 1n;
  const out = new Uint32Array(volume);

  for (let index = 0; index < volume; index++) {
    const startOffset = index * bits;
    const startArrIndex = Math.floor(startOffset / 64);
    const endArrIndex = Math.floor(((index + 1) * bits - 1) / 64);
    const startBitOffset = BigInt(startOffset % 64);

    let value;
    if (startArrIndex === endArrIndex) {
      value = (longs[startArrIndex] >> startBitOffset) & maxEntryValue;
    } else {
      const endOffset = 64n - startBitOffset;
      value = ((longs[startArrIndex] >> startBitOffset) | (longs[endArrIndex] << endOffset)) & maxEntryValue;
    }
    out[index] = Number(value);
  }

  return out;
}

// Litematica's own index formula: index = y*sizeLayer + z*sizeX + x, where
// sizeLayer = sizeX*sizeZ. Region Size components can be negative (they
// encode placement direction); the container itself is always sized with
// their absolute values - see LitematicaSchematic.java's regionSize handling.
function indexToPos(index, sizeX, sizeZ) {
  const sizeLayer = sizeX * sizeZ;
  const y = Math.floor(index / sizeLayer);
  const rem = index % sizeLayer;
  const z = Math.floor(rem / sizeX);
  const x = rem % sizeX;
  return { x, y, z };
}

module.exports = { bitsForPaletteSize, decodeBlockStates, indexToPos };

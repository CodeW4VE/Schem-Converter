// Item-id resolution: does an item id exist in the target version's item
// list, and if not, what should it become? NBT-free like lib/palette.js,
// which this reuses directly - see PLAN.md "B1": every block-shaped
// substitution rule (renames, material rules, prefix strips, shape chains)
// is equally valid to try on an item id, existence-checked the same way
// before being accepted, so a wrong candidate (e.g. a block-only rename)
// is harmless rather than wrong.

const { findSubstitute } = require('./palette');
const substitutions = require('../data/substitutions.json');

// targetItemsIndex: an object keyed by short item name (truthy values),
// e.g. built from a data/blocks-<version>.json's `items` array, or
// data/items-1.12.2.json's flat list.
// Returns {name, substitutedFrom} - substitutedFrom is only set when the id
// changed, for the report.
function resolveItemName(shortName, targetItemsIndex) {
  if (targetItemsIndex[shortName]) return { name: shortName };
  const substitute = findSubstitute(shortName, targetItemsIndex, substitutions.itemRules);
  return { name: substitute, substitutedFrom: shortName };
}

module.exports = { resolveItemName, ITEM_MARKER: substitutions.marker };

// Converts Minecraft chat/text components between the three shapes a sign
// (or an item's custom name/lore, see B1a/B3) can carry them in, keyed on
// MinecraftDataVersion the same way the rest of this repo keys tag shapes:
//
//   < 4325 (pre-1.21.5): a JSON-encoded string, e.g. '{"text":"Hi"}'.
//   >= 4325 (1.21.5+):   a real NBT value - TAG_String for plain text, or a
//                        TAG_Compound with text/color/bold/... fields.
//
// A component's canonical in-memory form here is just its JSON shape as a
// plain JS value: a bare string (shorthand for {text: string}, valid on both
// sides), a {text|translate, color, bold, ..., extra:[...]} object, or an
// array (top-level [base, ...extra] shorthand). That shape IS the JSON
// encoding, so JSON string <-> canonical is a straight JSON.parse/stringify;
// only the NBT-component side needs real conversion.
//
// NBT-free like lib/palette.js and lib/flattening.js in spirit - the *output*
// for the >=4325 side is necessarily a small NBT tag (that's the format), but
// this module never touches a TileEntities tree; lib/convert.js wires that up.

const FORMATTING_KEYS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];

// Anything that fails to parse as JSON is legacy plain text (pre-JSON-component
// signs, or just malformed input) - not a component to reject, since losing
// formatting beats losing the sign. A bare string is already a valid
// canonical value (see header), so no wrapping is needed.
function jsonStringToCanonical(jsonString) {
  if (typeof jsonString !== 'string' || jsonString === '') return '';
  try {
    return JSON.parse(jsonString);
  } catch {
    return jsonString;
  }
}

function canonicalToJsonString(canonical) {
  return JSON.stringify(canonical ?? '');
}

// tag: an NBT tag object ({type, value}) for one component - TAG_String or
// TAG_Compound. Lists (an 'extra' array) are handled by recursing here per
// element, wrapped in the same tag shape by the caller.
function nbtComponentToCanonical(tag) {
  if (!tag) return '';
  if (tag.type === 'string') return tag.value;
  if (tag.type !== 'compound') return '';

  const value = tag.value;
  const canonical = {};
  if (value.text) canonical.text = value.text.value;
  if (value.translate) canonical.translate = value.translate.value;
  if (value.color) canonical.color = value.color.value;
  for (const key of FORMATTING_KEYS) {
    if (value[key]) canonical[key] = !!value[key].value;
  }
  if (value.extra && value.extra.value && value.extra.value.value) {
    const elementType = value.extra.value.type;
    canonical.extra = value.extra.value.value.map(raw =>
      nbtComponentToCanonical(elementType === 'string' ? { type: 'string', value: raw } : { type: 'compound', value: raw })
    );
  }
  return canonical;
}

// Returns an NBT tag object. A plain string (or an object with only `text`
// and no formatting/extra) becomes TAG_String - matching how vanilla itself
// stores an unformatted line. Anything with formatting becomes TAG_Compound.
function canonicalToNbtComponent(canonical) {
  if (typeof canonical === 'string') return { type: 'string', value: canonical };
  if (Array.isArray(canonical)) {
    // Top-level [base, ...extra] shorthand: fold into {..base, extra}.
    const [base, ...rest] = canonical;
    return canonicalToNbtComponent(rest.length ? { ...toObject(base), extra: rest } : base);
  }

  const obj = toObject(canonical);
  const value = {};
  if (obj.text !== undefined) value.text = { type: 'string', value: obj.text };
  if (obj.translate !== undefined) value.translate = { type: 'string', value: obj.translate };
  if (obj.color !== undefined) value.color = { type: 'string', value: obj.color };
  for (const key of FORMATTING_KEYS) {
    if (obj[key] !== undefined) value[key] = { type: 'byte', value: obj[key] ? 1 : 0 };
  }
  if (Array.isArray(obj.extra) && obj.extra.length > 0) {
    value.extra = { type: 'list', value: extraListTag(obj.extra) };
  }

  if (Object.keys(value).length === 1 && value.text) return { type: 'string', value: value.text.value };
  return { type: 'compound', value };
}

function toObject(canonical) {
  if (typeof canonical === 'string') return { text: canonical };
  return canonical && typeof canonical === 'object' ? canonical : { text: '' };
}

// ponytail: a real NBT list must be one element type. If every element turns
// out plain-string, keep the list TAG_String; otherwise normalize every
// element to a compound (wrapping bare strings as {text: ...}) rather than
// modelling Minecraft's per-version list-merging rules.
function extraListTag(elements) {
  const tags = elements.map(canonicalToNbtComponent);
  if (tags.every(t => t.type === 'string')) {
    return { type: 'string', value: tags.map(t => t.value) };
  }
  return {
    type: 'compound',
    value: tags.map(t => (t.type === 'compound' ? t.value : { text: { type: 'string', value: t.value } })),
  };
}

function canonicalToPlainText(canonical) {
  if (typeof canonical === 'string') return canonical;
  if (Array.isArray(canonical)) return canonical.map(canonicalToPlainText).join('');
  if (canonical && typeof canonical === 'object') {
    const own = canonical.text ?? canonical.translate ?? '';
    const extra = Array.isArray(canonical.extra) ? canonical.extra.map(canonicalToPlainText).join('') : '';
    return own + extra;
  }
  return '';
}

module.exports = {
  jsonStringToCanonical,
  canonicalToJsonString,
  nbtComponentToCanonical,
  canonicalToNbtComponent,
  canonicalToPlainText,
};

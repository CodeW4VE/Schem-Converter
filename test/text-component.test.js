const test = require('node:test');
const assert = require('node:assert/strict');
const {
  jsonStringToCanonical,
  canonicalToJsonString,
  nbtComponentToCanonical,
  canonicalToNbtComponent,
  canonicalToPlainText,
} = require('../lib/text-component');

test('plain JSON string round-trips', () => {
  const canonical = jsonStringToCanonical('{"text":"Hello"}');
  assert.deepEqual(canonical, { text: 'Hello' });
  assert.equal(canonicalToJsonString(canonical), '{"text":"Hello"}');
});

test('unparseable input degrades to a plain canonical string, not a throw', () => {
  const canonical = jsonStringToCanonical('Hello');
  assert.equal(canonical, 'Hello');
  assert.equal(canonicalToJsonString(canonical), '"Hello"'); // still valid component shorthand
});

test('empty string decodes to empty canonical', () => {
  assert.equal(jsonStringToCanonical(''), '');
  assert.equal(canonicalToJsonString(''), '""');
});

test('plain string canonical encodes as TAG_String, not a compound', () => {
  const tag = canonicalToNbtComponent('Hello');
  assert.deepEqual(tag, { type: 'string', value: 'Hello' });
});

test('a component with only text also encodes as TAG_String', () => {
  const tag = canonicalToNbtComponent({ text: 'Hello' });
  assert.deepEqual(tag, { type: 'string', value: 'Hello' });
});

test('formatting forces a TAG_Compound, round-trips through nbtComponentToCanonical', () => {
  const canonical = { text: 'Hello', color: 'red', bold: true };
  const tag = canonicalToNbtComponent(canonical);
  assert.equal(tag.type, 'compound');
  assert.deepEqual(nbtComponentToCanonical(tag), canonical);
});

test('TAG_String decodes straight to a plain canonical string', () => {
  assert.equal(nbtComponentToCanonical({ type: 'string', value: 'Hi' }), 'Hi');
});

test('extra list of all-plain parts stays a TAG_String list', () => {
  const tag = canonicalToNbtComponent({ text: 'a', extra: ['b', 'c'] });
  assert.equal(tag.value.extra.value.type, 'string');
  assert.deepEqual(tag.value.extra.value.value, ['b', 'c']);
});

test('extra list with one formatted part normalizes every element to compound', () => {
  const tag = canonicalToNbtComponent({ text: 'a', extra: ['b', { text: 'c', color: 'blue' }] });
  assert.equal(tag.value.extra.value.type, 'compound');
  assert.deepEqual(tag.value.extra.value.value[0], { text: { type: 'string', value: 'b' } });
  assert.equal(tag.value.extra.value.value[1].color.value, 'blue');
});

test('top-level array shorthand folds into base + extra', () => {
  const tag = canonicalToNbtComponent(['a', 'b', 'c']);
  assert.equal(tag.type, 'compound');
  assert.equal(tag.value.text.value, 'a');
  assert.deepEqual(tag.value.extra.value.value, ['b', 'c']);
});

test('canonicalToPlainText flattens text + extra, ignoring formatting', () => {
  const canonical = { text: 'Hello, ', color: 'red', extra: ['world', { text: '!', bold: true }] };
  assert.equal(canonicalToPlainText(canonical), 'Hello, world!');
});

test('canonicalToPlainText on a bare string is the string itself', () => {
  assert.equal(canonicalToPlainText('Hello'), 'Hello');
});

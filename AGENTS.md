# AGENTS.md

Context file for AI agents working in this repo.

## What this is

Discord bot. Converts `.litematic` schematic files between Minecraft versions (1.12.2, and
1.13.2 through 1.21.8), rewriting the block palette so blocks the target version doesn't have
get substituted instead of silently disappearing. Node.js, discord.js v14, prismarine-nbt.

## Structure

- `index.js` — bot entry. Loads commands/ and events/ dynamically, logs in with `TOKEN`.
- `deploy_commands.js` — registers slash commands to Discord API via `CLIENT_ID`/`TOKEN`. Run manually after command changes (`npm run deploy`).
- `commands/schem-convert.js` — Discord-only concerns: attachment handling, the version dropdown, caching per-user in-flight conversions, sending the result and the substitution report.
- `lib/convert.js` — the conversion entry point (`convertSchematic`). Rewrites each region's `BlockStatePalette`, filters mob `Entities`, re-keys the sign/`Count` tag transforms on `MinecraftDataVersion`, and updates `Version`/`MinecraftDataVersion`.
- `lib/palette.js` — per-entry substitution: `findSubstitute` is a breadth-first search over the tables in `data/substitutions.json` (renames — applied in both directions, splits with property carry-over, explicit map, chains, material-name rules, prefix strip/chains, shape-generic fallback), falling back to the `command_block` marker only once every path is exhausted. A single tier's candidate can itself be missing from the target (e.g. `exposed_copper` → `copper`, also not real → `orange_terracotta`), which is why this chains instead of trying each tier once. Plus property fixup (drop what the target doesn't have, default what's missing). Operates on plain `{name, properties}` objects, no NBT.
- `lib/flattening.js` — 1.13+ → 1.12.2 only. Translates a normalized 1.13.2 state to its pre-Flattening `{Name, Properties}` form using `data/vendor/block_state_map.json`.
- `lib/blockstates.js` — decodes Litematica's packed `BlockStates` long array back into a per-position palette index. A direct translation of `LitematicaBitArray`'s algorithm (see the file header for the exact source commit); only ever reads, never re-encodes, because palette length is invariant here.
- `lib/tile-entity-1-12.js` — pure derivation of the 1.12 tile-entity field (`note`, `SkullType`+`Rot`, `Base`, `color`) a note block / skull / banner / bed needs to carry its real per-instance value, since 1.12 can't express it in the blockstate the way 1.13+ does.
- `lib/text-component.js` — converts a Minecraft chat/text component between a JSON-encoded string (pre-1.21.5) and a real NBT value (1.21.5+, data version 4325). NBT-free: the canonical in-memory form is just the component's JSON shape as a plain JS value. Used by sign text and by item custom name/lore in `lib/convert.js`.
- `lib/items.js` — `resolveItemName` generalizes `lib/palette.js`'s `findSubstitute` to item ids via a second optional candidate table (`data/substitutions.json`'s `itemRules`), since every block-shaped rule (renames, material rules, prefix strips, shape chains) is equally valid — and equally existence-checked — for an item id.
- `lib/legacy-items.js` — 1.13+ → 1.12.2 only, item-id sibling of `lib/flattening.js`. Inverts `data/legacy-items.json` (minecraft-data's `pc/common/legacy.json` `items` table, 644 id:meta → modern-name entries) to resolve a modern item to its 1.12.2 `{name, Damage}` form, plus a numeric enchantment-id table from `data/items-1.12.2.json`.
- `lib/versions.js` — the supported-version table, `dataVersion`/NBT-version lookups, lazy loading of `data/blocks-<version>.json`.
- `scripts/build-blockdata.js` — regenerates `data/blocks-<version>.json` from PrismarineJS/minecraft-data (pinned commit, see the file header). Also emits `data/items-1.12.2.json` (id+name items and enchantments, since 1.12.2 has no blocks file) and `data/legacy-items.json` (the vendored-by-generation `pc/common/legacy.json` item table — Apache/CC-licensed, no LGPL question unlike `data/vendor/`). Run `npm run build-data` after adding a version to `lib/versions.js`'s `SUPPORTED` table; commit the output.
- `data/substitutions.json` — the tables `lib/palette.js`'s resolver reads (`renames`, `splits`, `explicit`, `chains`, `materialRules`, `prefixStrip`, `prefixChains`, `shapeSuffixChains`, `itemRules`). `lib/flattening.js` also reads `shapeSuffixChains` directly for its own shape-generic alias tier, and `lib/items.js` reads `itemRules` as `findSubstitute`'s second candidate table — keep both in sync if this file's shape changes.
- `data/vendor/` — `block_state_map.json` vendored **unmodified** from the Litematica mod (LGPL-3.0, see `NOTICE.md` there) plus its `LICENSE.txt`. **Not covered by this repo's MIT license** — it's a separate file used as-is per LGPL's "used as a library" terms.
- `test/*.test.js` — `node --test`, no framework. `npm test`.
- `events/interactionCreate.js` — routes chat input commands to `client.commands`, catches execution errors.
- `events/ready.js` — login log line, event name is `clientReady`.

## How conversion works

`commands/schem-convert.js` gunzips the uploaded file, parses NBT, caches the parsed data per
Discord user id, shows a dropdown of Minecraft versions (not NBT versions — NBT 5 alone spans
1.13–1.16.5, too coarse to know which blocks exist), then calls
`lib/convert.js#convertSchematic(root, fromDataVersion, toMcVersion)` on selection.

Per `Regions[*]`:

- `BlockStatePalette` is rewritten entry-by-entry, **1:1, never changing palette length** —
  Litematica packs `BlockStates` indices at `ceil(log2(paletteSize))` bits, so changing the
  count would require repacking that bit array, which nothing here does. See
  `lib/palette.js#convertPalette`'s length-invariant test.
- Targeting 1.12.2 additionally routes each already-normalized 1.13.2 entry through
  `lib/flattening.js#flattenState`. **Ordering matters**: the palette normalization must run
  first, because several 1.12-incompatible properties (`waterlogged`, `powered`, leaf
  `distance`/`persistent`, chest `type`) only have a mapped 1.12 state at their default value —
  querying the flattening map before they're normalized misses most of the block list. See the
  header comment in `lib/flattening.js`.
- Note pitch, skull type, banner colour and bed colour live in **1.12 tile-entity data**, not
  the blockstate, so `lib/flattening.js` alone can only produce that family's default 1.12 state.
  `lib/convert.js#applyPreFlatteningTileEntityValues` restores the true value separately: it
  decodes the packed `BlockStates` bit array (`lib/blockstates.js`) to find every position using
  one of these palette entries, then writes the real value into that position's `TileEntities`
  entry (creating one if none exists — e.g. 1.13+ note blocks have no tile entity at all).
  Position identity is reliable here specifically because palette length never changes; this is
  the one place in the codebase that decodes `BlockStates`, and only runs when the palette
  actually contains one of these four block families.
- `Entities` (mobs) are filtered against the target version's real entity list.
  `TileEntities` (signs, chests, beacons, ...) are **left alone** — minecraft-data has no
  per-version block-entity id list, and an earlier version of this code filtered them against
  the mob list by mistake, which silently deleted every sign and chest. Don't reintroduce that.
- **Sign text** goes through one normalize/emit pass (`signSideKey` in `lib/convert.js`) keyed on
  two independent `MinecraftDataVersion` thresholds: 3463 (1.20, `Text1-4` ↔
  `front_text`/`back_text` shape) and 4325 (1.21.5, JSON-string ↔ real-NBT text component
  encoding — see `lib/text-component.js`). Both must be checked; a boundary crossing only one
  (e.g. 1.21.8 → 1.20.4, same shape, different encoding) still needs the pass to run, or the
  newer encoding passes through unconverted and renders blank on the older client.
- **Item stacks** (any compound with `id` + `Count`/`count` — covers chests, shulkers, item
  frames, minecarts, etc. without enumerating container types, and reaches nested stacks like a
  shulker box's own `Items` for free since `walk` recurses into everything) go through
  `convertItemStack` in `lib/convert.js`: id resolution via `lib/items.js`, a `command_block`
  marker labelled with the original item's name when nothing resolves (reuses
  `lib/text-component.js`'s encoding rules — plain string on 1.12.2, JSON string 1.13–1.20.4, NBT
  component 1.21.5+), `Count`/`count` (byte pre-1.20.5, not the int the old code wrote), and a
  five-field `tag`↔`components` subset (`custom_name`, `lore`, `enchantments`,
  `minecraft:damage`) across the 1.20.5 boundary. `minecraft:container` (nested shulker contents)
  is deliberately left in place rather than translated *or* deleted — translating it is real work
  for a rare case, and deleting the wrapper would orphan the items nested inside it before `walk`
  reaches them.
- A 1.12.2 target additionally routes each item id through `lib/legacy-items.js` first (the
  item-id sibling of `lib/flattening.js`'s block table) for an exact `{name, Damage}` match,
  falling back to `lib/items.js`'s generic resolver only when the item postdates 1.12.2 entirely.
  Only write the legacy Damage when it's nonzero *and* the item doesn't already carry a real
  durability value — modern items reuse the same top-level `Damage` field for a colour/variant
  meta (pre-1.13) and tool durability (always), and applying the legacy lookup unconditionally
  would silently zero out a damaged tool's actual wear.
- Both signs and items are **downgrade-only against 1.12.2** — same limitation as
  `lib/flattening.js`'s block conversion. Nothing in this codebase un-flattens a 1.12.2 source;
  uploading an actual 1.12.2 schematic and converting it *up* is unsupported for blocks, signs,
  and items alike.
- `Count` ↔ `count` shape is keyed on the same 3837 threshold as `tag`/`components`, since both
  landed in the 1.20.5 item-stack rewrite — not on the NBT version boundary, which is too coarse
  (see the sign note above for why that class of bug looks like a silent no-op).

`conversionCache` in `commands/schem-convert.js` is process memory, keyed by user id, no TTL
cleanup beyond the 60s component collector — restarting the bot or running multiple processes
loses/mixes state.

## Conventions

- CommonJS (`require`/`module.exports`), no build step, no TypeScript.
- `npm test` runs `node --test test/*.test.js`. Add a test for any new substitution rule or
  ordering-sensitive behavior — the ordering constraint above was found by a test failing, twice.
- No `.env` committed (see `.gitignore`); required vars: `TOKEN`, `CLIENT_ID`.
- Commands and events are auto-discovered by filename in their folders — adding a file is enough, no manual registration in `index.js`.
- `lib/palette.js` and `lib/flattening.js` are intentionally NBT-free (plain `{name, properties}`
  objects) so they're testable without building fake NBT trees. Keep new conversion logic there,
  not in `lib/convert.js`'s NBT plumbing.

## Working conventions for AI agents

- Read [CLAUDE.md](CLAUDE.md) — it points here and to `PLAN.md`.
- Before editing `lib/palette.js`'s substitution tiers or `lib/flattening.js`'s alias tables,
  run the sweep that found the current gaps: for every block in a `data/blocks-*.json`, run it
  through `fixProperties` at its default state then `flattenState`/`findSubstitute`, and check
  what falls through to the `command_block` marker. It catches silent regressions fast.
- Don't add dependencies for what discord.js/prismarine-nbt/node stdlib already cover.
- No secrets in code or commits — `TOKEN`/`CLIENT_ID` come from `.env` only.
- `data/vendor/block_state_map.json` is LGPL-3.0, not MIT. Don't modify it in place — if it
  needs a fix, add the fix as a fallback in `lib/flattening.js` instead, so the vendored file
  stays an unmodified, separately-licensed unit.
- No unneeded comments. Only comment non-obvious WHY (hidden constraint, workaround, surprising
  behavior) — never restate WHAT code does. Costs tokens for no reader value.

# AGENTS.md

Context file for AI agents working in this repo.

## What this is

Discord bot. Converts `.litematic` schematic files between NBT versions (4-7). Node.js, discord.js v14, prismarine-nbt.

## Structure

- `index.js` — bot entry. Loads commands/ and events/ dynamically, logs in with `TOKEN`.
- `deploy_commands.js` — registers slash commands to Discord API via `CLIENT_ID`/`TOKEN`. Run manually after command changes (`npm run deploy`).
- `commands/schem-convert.js` — the whole feature: slash command handler + NBT conversion logic (upgrade/downgrade transforms) all in one file.
- `events/interactionCreate.js` — routes chat input commands to `client.commands`, catches execution errors.
- `events/ready.js` — login log line, event name is `clientReady`.

## How conversion works

`schem-convert.js` gunzips the uploaded file, parses NBT, caches parsed data per Discord user id in an in-memory `Map` (`conversionCache`), shows a dropdown for target version, then on selection:

- `fromVersion < 7 && toVersion === 7` → `upgradeToV7`: `Count`→`count` rename, sign tag restructure (`Text1-4`→`front_text`/`back_text`), adds `PendingFluidTicks`.
- `fromVersion === 7 && toVersion < 7` → `downgradeFromV7`: reverse of the above.
- Same-version jumps (e.g. 6→5) are NOT handled by `applyConversion` beyond setting `Version.value` — only round-trips through v7 boundary actually transform tags. Know this before assuming arbitrary version pairs convert correctly.

`conversionCache` is process memory, keyed by user id, no TTL cleanup beyond the 60s component collector — restarting the bot or concurrent runs on multiple processes loses/mixes state.

## Conventions

- CommonJS (`require`/`module.exports`), no build step, no TypeScript.
- No test suite exists.
- No `.env` committed (see `.gitignore`); required vars: `TOKEN`, `CLIENT_ID`.
- Commands and events are auto-discovered by filename in their folders — adding a file is enough, no manual registration in `index.js`.

## Working conventions for AI agents

- Read this file for project context and `PLAN.md` for current tasks.
- Before editing NBT transform functions, trace all callers (`upgradeToV7`/`downgradeFromV7` are recursive tree walkers — a change in one nested helper affects every schematic region).
- Don't add dependencies for what discord.js/prismarine-nbt/node stdlib already cover.
- No secrets in code or commits — `TOKEN`/`CLIENT_ID` come from `.env` only.

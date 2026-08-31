# AGENTS.md

Context file for AI agents working in this repo.

## What this is

Discord bot. Accepts a `.litematic` schematic file, lets the user pick a target Minecraft
version, and converts it. Node.js, discord.js v14. All conversion logic (block/item palette
rewriting, sign text, NBT plumbing) lives in the
[`@froyln/schem-convert-lib`](https://github.com/froyln/schem-convert-lib) npm dependency — see
that repo's AGENTS.md for how conversion actually works. This repo only owns the Discord
interaction.

## Structure

- `index.js` — bot entry. Loads commands/ and events/ dynamically, logs in with `TOKEN`.
- `deploy_commands.js` — registers slash commands to Discord API via `CLIENT_ID`/`TOKEN`. Run manually after command changes (`npm run deploy`).
- `commands/schem-convert.js` — the whole bot feature: attachment handling, the version
  dropdown, caching per-user in-flight conversions, calling `inspectFile`/`convertFile` from
  `@froyln/schem-convert-lib`, sending the result and the substitution report.
- `events/interactionCreate.js` — routes chat input commands to `client.commands`, catches execution errors.
- `events/ready.js` — login log line, event name is `clientReady`.

## How it works

`commands/schem-convert.js` downloads the uploaded attachment, calls `inspectFile(buffer)` to
label its detected source version, shows a dropdown of Minecraft versions (not NBT versions —
NBT 5 alone spans 1.13–1.16.5, too coarse to know which blocks exist), then on selection calls
`convertFile(buffer, targetMcVersion)` and sends back the resulting buffer plus
`report.blockLines()` / `itemLines()` / `noteLines()`.

`conversionCache` in `commands/schem-convert.js` is process memory, keyed by user id, holding
the raw input buffer and filename — no TTL cleanup beyond the 60s component collector —
restarting the bot or running multiple processes loses/mixes state.

Discord limits relevant here: at most 25 options in a select menu (`versionMenuOptions` is 14),
and a 2000-character message content limit — the substitution report falls back to a
`substitutions.txt` attachment when it would exceed that.

## Conventions

- CommonJS (`require`/`module.exports`), no build step, no TypeScript.
- No `.env` committed (see `.gitignore`); required vars: `TOKEN`, `CLIENT_ID`.
- Commands and events are auto-discovered by filename in their folders — adding a file is enough, no manual registration in `index.js`.
- No unneeded comments. Only comment non-obvious WHY (hidden constraint, workaround, surprising
  behavior) — never restate WHAT code does. Costs tokens for no reader value.
- No `Co-Authored-By: Claude ...` or `Claude-Session: ...` trailers in commit messages.

## Working conventions for AI agents

- Read [CLAUDE.md](CLAUDE.md) — it points here and to `PLAN.md`.
- Don't add dependencies for what discord.js/node stdlib already cover.
- No secrets in code or commits — `TOKEN`/`CLIENT_ID` come from `.env` only.
- Conversion bugs (wrong substitution, dropped property, bad sign/item translation) belong in
  `@froyln/schem-convert-lib`, not here — this repo has no conversion logic and no conversion
  tests to fix them against.

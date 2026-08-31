<div align="center">

# Schem-Converter

**Convert `.litematic` files between NBT versions directly in Discord with a simple slash command.**

[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img width="480" height="270" alt="Schem-Converter" src="https://github.com/user-attachments/assets/dc1b6511-4c97-46d8-a9b9-757930fda7da" />

</div>

---

## What is it?

A Discord bot that takes a `.litematic` schematic file and converts it to a different Minecraft
version — including rewriting the block palette, so blocks the target version doesn't have get
substituted with something sensible instead of silently disappearing.  
Perfect when you need to open a modern schematic in an older version of Litematica, or vice‑versa.

## Features

- Accepts `.litematic` files via Discord's `/schem-convert` command.
- Detects the schematic's current source version.
- Provides a dropdown menu to select the target **Minecraft version** (1.12.2 through 1.21.8) —
  not just an NBT version, which is too coarse to know which blocks actually exist.
- Rewrites the block palette: blocks missing from the target are substituted (same material
  family and shape where possible) instead of vanishing, and every substitution is reported back.
- Converting to 1.12.2 additionally translates the modern per-name block IDs back to the
  pre-Flattening `id:meta` blockstate model.
- Returns the converted `.litematic` file directly in the ephemeral reply.

## Requirements

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot application (see [Discord Developer Portal](https://discord.com/developers/applications))

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/litematic-converter-bot.git
   cd litematic-converter-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a .env file in the root directory with the following contents:
   ```bash
   TOKEN=your_bot_token_here
   CLIENT_ID=your_application_id_here
   ```

## Registering Slash Commands

Run the deployment script once (or whenever you modify the command):
   ```bash
   npm run deploy
   ```
## Starting the Bot
   ```bash
   npm run start
   ```
## Usage
1. In any text channel, use the slash command:
   ```bash
   /schem-convert
   ```
2. Attach a .litematic file when prompted.
3. The bot will reply with a dropdown menu showing the current NBT version.
4. Select the target NBT version from the dropdown.
5. The bot will process the file and send back the converted .litematic file.
All messages are ephemeral (visible only to you).

## Dependencies

[discord.js](https://discord.js.org/) v14.

[@froyln/schem-convert-lib](https://github.com/froyln/schem-convert-lib) — the conversion
engine (block/item palette rewriting, sign text, NBT plumbing). See that repo for supported
versions and conversion details.

## License

[MIT](LICENSE) © froyln / CodeW4VE.

# Litematic NBT Version Converter Bot

A Discord bot that converts `.litematic` files between different NBT versions (4, 5, 6, and 7).

## Features

- Accepts `.litematic` files via Discord's `/convert` command.
- Detects the current NBT version of the file.
- Provides a dropdown menu to select the target NBT version:
  - **NBT 7** (1.20.5 – 1.21+)
  - **NBT 6** (1.17 – 1.20.4)
  - **NBT 5** (1.13 – 1.16.5)
  - **NBT 4** (Legacy, pre-1.13)
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
   /convert
   ```
2. Attach a .litematic file when prompted.
3. The bot will reply with a dropdown menu showing the current NBT version.
4. Select the target NBT version from the dropdown.
5. The bot will process the file and send back the converted .litematic file.
All messages are ephemeral (visible only to you).

## Dependencies
[discord.js](https://discord.js.org/) versions 14.14.1. 
[prismarine-nbt](https://github.com/PrismarineJS/prismarine-nbt) versions 2.5.0. 
[dotenv](https://www.npmjs.com/package/dotenv) versions 16.3.1.
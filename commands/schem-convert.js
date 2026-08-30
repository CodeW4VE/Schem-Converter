const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const { SUPPORTED, PRE_FLATTENING_MC_VERSION, describeSource } = require('../lib/versions');
const { convertSchematic } = require('../lib/convert');

const conversionCache = new Map();

// Discord allows at most 25 options in a select menu; this is 14.
const versionMenuOptions = [...Object.keys(SUPPORTED), PRE_FLATTENING_MC_VERSION].map(mcVersion => ({
  label: mcVersion,
  value: mcVersion,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schem-convert')
    .setDescription('Convert a .litematic file to a different NBT version')
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('The .litematic file to convert')
        .setRequired(true)
    ),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('file');
    if (!attachment.name.endsWith('.litematic')) {
      return interaction.reply({
        content: 'Please attach a valid .litematic file.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
        if (err.code === 10062) {
            console.error('Interaction expired before defer.');
            return; // stops execution, no further attempt to reply
        }
        if (err.code === 40060) {
            console.error('Interaction already replied to or deferred.');
            // Continue execution, but don't attempt to defer again
        } else {
            throw err;
        }
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error('Failed to download file');
      const arrayBuffer = await response.arrayBuffer();
      const inputBuffer = Buffer.from(arrayBuffer);

      const inflatedBuffer = zlib.gunzipSync(inputBuffer);
      const data = await nbt.parse(inflatedBuffer);
      const root = data.parsed.value;

      const nbtVersion = root.Version ? root.Version.value : 0;
      const dataVersion = root.MinecraftDataVersion ? root.MinecraftDataVersion.value : 0;
      const originalFilename = attachment.name;
      const sourceLabel = describeSource(nbtVersion, dataVersion);

      conversionCache.set(interaction.user.id, {
        data,
        root,
        dataVersion,
        originalFilename,
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('nbt_version_select')
        .setPlaceholder('Select target Minecraft version')
        .addOptions(versionMenuOptions);

      const row = new ActionRowBuilder().addComponents(menu);

      const reply = await interaction.editReply({
        content: `Loaded **${originalFilename}** (detected source: ${sourceLabel}). Choose the target Minecraft version:`,
        components: [row],
      });

      const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 60_000,
        max: 1,
      });

      collector.on('collect', async selectInteraction => {
        if (selectInteraction.customId !== 'nbt_version_select') return;
        await selectInteraction.deferUpdate();

        const targetMcVersion = selectInteraction.values[0];
        const cache = conversionCache.get(interaction.user.id);
        if (!cache) {
          return selectInteraction.followUp({
            content: 'Session expired. Please run the command again.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const { data: cachedData, root: cachedRoot, dataVersion: fromDataVersion, originalFilename: filename } = cache;

        let report;
        try {
          report = convertSchematic(cachedRoot, fromDataVersion, targetMcVersion);
        } catch (err) {
          console.error(err);
          return selectInteraction.editReply({
            content: 'Conversion error. Check the logs.',
            components: [],
          });
        }

        const outputUncompressed = nbt.writeUncompressed(cachedData.parsed);
        const outputCompressed = zlib.gzipSync(outputUncompressed);

        const newAttachment = new AttachmentBuilder(Buffer.from(outputCompressed), {
          name: filename,
        });

        const files = [newAttachment];
        const lines = report.toLines();
        let content = `**${filename}** converted to **${targetMcVersion}**.`;

        if (lines.length > 0) {
          const summary = `\n\nBlock substitutions:\n${lines.join('\n')}`;
          if ((content + summary).length <= 2000) {
            content += summary;
          } else {
            content += `\n\n${lines.length} block substitutions were made (see attached file).`;
            files.push(new AttachmentBuilder(Buffer.from(lines.join('\n')), { name: 'substitutions.txt' }));
          }
        }

        await selectInteraction.editReply({
          content,
          files,
          components: [],
        });

        conversionCache.delete(interaction.user.id);
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction
            .editReply({
              content: 'Time expired. Please use the command again.',
              components: [],
            })
            .catch(() => {});
          conversionCache.delete(interaction.user.id);
        }
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        content: 'Could not process the file. Make sure it is a valid .litematic.',
      });
      conversionCache.delete(interaction.user.id);
    }
  },
};

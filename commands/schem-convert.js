const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');

const conversionCache = new Map();

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

      const currentVersion = root.Version ? root.Version.value : 0;
      const originalFilename = attachment.name;

      conversionCache.set(interaction.user.id, {
        data,
        root,
        currentVersion,
        originalFilename,
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('nbt_version_select')
        .setPlaceholder('Select target NBT version')
        .addOptions([
          {
            label: 'NBT 7',
            value: '7',
            description: '1.20.5-1.21+',
          },
          {
            label: 'NBT 6',
            value: '6',
            description: '1.17–1.20.4',
          },
          {
            label: 'NBT 5',
            value: '5',
            description: '1.13–1.16.5',
          },
          {
            label: 'NBT 4',
            value: '4',
            description: 'Legacy (pre-1.13)',
          },
        ]);

      const row = new ActionRowBuilder().addComponents(menu);

      const reply = await interaction.editReply({
        content: `Loaded **${originalFilename}** (current NBT version: ${currentVersion}). Choose the target version:`,
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

        const targetVersion = parseInt(selectInteraction.values[0]);
        const cache = conversionCache.get(interaction.user.id);
        if (!cache) {
          return selectInteraction.followUp({
            content: 'Session expired. Please run the command again.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const { data, root, currentVersion, originalFilename } = cache;

        if (targetVersion === currentVersion) {
          await selectInteraction.editReply({
            content: `The file is already NBT version ${currentVersion}. No conversion needed.`,
            components: [],
          });
          conversionCache.delete(interaction.user.id);
          return;
        }

        try {
          applyConversion(root, currentVersion, targetVersion);
        } catch (err) {
          console.error(err);
          return selectInteraction.editReply({
            content: 'Conversion error. Check the logs.',
            components: [],
          });
        }

        updateMinecraftDataVersion(root, targetVersion);

        const outputUncompressed = nbt.writeUncompressed(data.parsed);
        const outputCompressed = zlib.gzipSync(outputUncompressed);

        const newAttachment = new AttachmentBuilder(Buffer.from(outputCompressed), {
          name: originalFilename,
        });

        await selectInteraction.editReply({
          content: `**${originalFilename}** Converted to NBT version **${targetVersion}**.${
            targetVersion < 7
              ? '\n__*Downgrading may not preserve all modern tags perfectly.* __'
              : ''
          }`,
          files: [newAttachment],
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

// --- Conversion functions ---
function updateMinecraftDataVersion(root, targetNbtVersion) {
  const versionMap = {
    7: 3953,
    6: 3465,
    5: 2860,
    4: 1631,
  };
  const dv = versionMap[targetNbtVersion];
  if (dv && root.MinecraftDataVersion) {
    root.MinecraftDataVersion.value = dv;
  }
  if (root.Version) {
    root.Version.value = targetNbtVersion;
  }
}

function applyConversion(root, fromVersion, toVersion) {
  if (fromVersion < 7 && toVersion === 7) {
    upgradeToV7(root);
  } else if (fromVersion === 7 && toVersion < 7) {
    downgradeFromV7(root);
  }
  root.Version.value = toVersion;
}

function upgradeToV7(obj) {
  renameCountToLowercase(obj);
  convertSignTagsToV7(obj);
  addFluidTicks(obj);
}

function downgradeFromV7(obj) {
  revertCountToCapital(obj);
  revertSignTagsFromV7(obj);
  removeFluidTicks(obj);
}

function renameCountToLowercase(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key in obj) {
    if (key === 'Count' && obj[key]?.value !== undefined) {
      obj.count = { type: 'int', value: obj.Count.value };
      delete obj.Count;
    } else if (key === 'BlockEntityTag' && obj[key]?.value?.Items) {
      renameCountToLowercase(obj[key].value.Items);
    } else {
      renameCountToLowercase(obj[key]);
    }
  }
}

function convertSignTagsToV7(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key in obj) {
    if (['Text1', 'Text2', 'Text3', 'Text4'].includes(key)) {
      const messages = ['Text1', 'Text2', 'Text3', 'Text4'].map(tk =>
        obj[tk] ? obj[tk].value : '{"text":""}'
      );
      const glowing = obj.GlowingText ? obj.GlowingText.value : 0;
      const color = obj.Color ? obj.Color.value : 'black';

      obj.front_text = {
        type: 'compound',
        value: {
          has_glowing_text: { type: 'byte', value: glowing },
          color: { type: 'string', value: color },
          messages: {
            type: 'list',
            value: { type: 'string', value: messages },
          },
        },
      };
      obj.back_text = {
        type: 'compound',
        value: {
          has_glowing_text: { type: 'byte', value: 0 },
          color: { type: 'string', value: 'black' },
          messages: {
            type: 'list',
            value: {
              type: 'string',
              value: ['{"text":""}', '{"text":""}', '{"text":""}', '{"text":""}'],
            },
          },
        },
      };

      delete obj.Text1;
      delete obj.Text2;
      delete obj.Text3;
      delete obj.Text4;
      delete obj.GlowingText;
      delete obj.Color;
    } else {
      convertSignTagsToV7(obj[key]);
    }
  }
}

function addFluidTicks(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.Regions) {
    for (const regionKey in obj.Regions.value) {
      addFluidTicks(obj.Regions.value[regionKey].value);
    }
  } else if (!obj.PendingFluidTicks) {
    obj.PendingFluidTicks = {
      type: 'list',
      value: { type: 'end', value: [] },
    };
  }
}

function revertCountToCapital(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key in obj) {
    if (key === 'count' && obj[key]?.type === 'int') {
      obj.Count = { type: 'int', value: obj.count.value };
      delete obj.count;
    } else if (key === 'BlockEntityTag' && obj[key]?.value?.Items) {
      revertCountToCapital(obj[key].value.Items);
    } else {
      revertCountToCapital(obj[key]);
    }
  }
}

function revertSignTagsFromV7(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.front_text) {
    const front = obj.front_text.value;
    const messages = front.messages?.value?.value || [
      '{"text":""}',
      '{"text":""}',
      '{"text":""}',
      '{"text":""}',
    ];
    obj.Text1 = { type: 'string', value: messages[0] || '{"text":""}' };
    obj.Text2 = { type: 'string', value: messages[1] || '{"text":""}' };
    obj.Text3 = { type: 'string', value: messages[2] || '{"text":""}' };
    obj.Text4 = { type: 'string', value: messages[3] || '{"text":""}' };
    obj.GlowingText = { type: 'byte', value: front.has_glowing_text?.value ?? 0 };
    obj.Color = { type: 'string', value: front.color?.value ?? 'black' };

    delete obj.front_text;
    delete obj.back_text;
  } else {
    for (const key in obj) revertSignTagsFromV7(obj[key]);
  }
}

function removeFluidTicks(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.PendingFluidTicks) delete obj.PendingFluidTicks;
  if (obj.Regions) {
    for (const regionKey in obj.Regions.value) {
      removeFluidTicks(obj.Regions.value[regionKey].value);
    }
  } else {
    for (const key in obj) removeFluidTicks(obj[key]);
  }
}
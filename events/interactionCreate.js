module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error('Command execution error:', error);
        // Try to send an error message, but don't crash if the interaction is already gone
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
              content: 'An error occurred while executing the command.',
              flags: 64,
            });
          } else {
            await interaction.reply({
              content: 'An error occurred while executing the command.',
              flags: 64,
            });
          }
        } catch (replyError) {
          console.error('Could not send error message:', replyError.message);
        }
      }
    }
  },
};
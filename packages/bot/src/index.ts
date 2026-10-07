// FIRST: import config (runs validation before anything else)
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { client } from './client';
import { startBotHttpServer } from './http/server';
import { logger } from './utils/logger';
import { commands } from './commands';
import { REST, Routes } from 'discord.js';

// Import events to register them
import './events/ready';
import './events/guildMemberRemove';
import './events/guildBanAdd';
import './events/guildMemberUpdate';

// Start internal HTTP server
startBotHttpServer();

// Register slash commands
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(discordGateConfig.DISCORD_BOT_TOKEN);
  const commandData = commands.map(cmd => cmd.data.toJSON());

  try {
    logger.info('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(discordGateConfig.DISCORD_CLIENT_ID, discordGateConfig.TARGET_GUILD_ID),
      { body: commandData }
    );
    logger.info('Slash commands registered successfully', { count: commands.length });
  } catch (error) {
    logger.error('Failed to register slash commands', { error });
  }
}

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.find(cmd => cmd.data.name === interaction.commandName);
  if (!command) {
    logger.warn('Unknown command received', { commandName: interaction.commandName });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error('Command execution error', {
      command: interaction.commandName,
      user: interaction.user.tag,
      error,
    });

    // Try to respond if not already replied
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ An error occurred while executing this command.',
        ephemeral: true,
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ An error occurred while executing this command.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

// Login to Discord
client.login(discordGateConfig.DISCORD_BOT_TOKEN).catch((error) => {
  logger.error('Failed to login to Discord', { error });
  process.exit(1);
});

// Wait for client ready, then register commands
client.once('ready', async () => {
  await registerCommands();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

logger.info('Bot process started', {
  port: discordGateConfig.BOT_PORT,
  targetGuild: discordGateConfig.TARGET_GUILD_ID,
});
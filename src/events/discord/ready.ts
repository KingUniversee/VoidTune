import { ActivityType, Events } from 'discord.js';
import { BotEvent } from '../types';
import { Container } from '../../app/Container';

export const readyEvent: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  async execute(container: Container, client) {
    const { logger, config, commands } = container;

    logger.info(`🤖 Logged in as ${client.user.tag} (ID: ${client.user.id})`);
    logger.info(`📡 Serving ${client.guilds.cache.size} guilds across ${client.channels.cache.size} channels`);

    // Start dynamic rotating presence
    if (container.hasService('presenceManager')) {
      const presenceManager = container.getService<any>('presenceManager');
      presenceManager.start();
    } else {
      client.user.setPresence({
        activities: [
          {
            name: `${config.DEFAULT_PREFIX}play | /play`,
            type: ActivityType.Listening,
          },
        ],
        status: 'online',
      });
    }

    // Deploy slash commands on startup if configured
    try {
      logger.info('🚀 Deploying application slash commands to Discord API...');
      const clientId = client.user.id || config.DISCORD_CLIENT_ID;
      await commands.deploySlashCommands(config.DISCORD_TOKEN, clientId);
      logger.info(`✅ Successfully deployed ${commands.getAll().length} slash commands`);
    } catch (error) {
      logger.error({ err: error }, '❌ Failed to deploy application slash commands');
    }
  },
};

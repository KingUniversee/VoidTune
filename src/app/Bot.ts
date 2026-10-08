import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { Container } from './Container';
import { CommandRegistry } from './CommandRegistry';
import { EventLoader } from '../events/EventLoader';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// Services & Managers
import { SourceManager } from '../sources/SourceManager';
import { TrackResolver } from '../music/TrackResolver';
import { MusicManager } from '../music/MusicManager';
import { MusicService } from '../services/MusicService';
import { PresenceManager } from './PresenceManager';
import { InternalServer } from '../api/InternalServer';

// Core Commands
import { pingCommand } from '../commands/utility/ping';
import { helpCommand } from '../commands/utility/help';

// Music Commands
import { joinCommand } from '../commands/music/join';
import { leaveCommand } from '../commands/music/leave';
import { playCommand } from '../commands/music/play';
import { pauseCommand } from '../commands/music/pause';
import { resumeCommand } from '../commands/music/resume';
import { skipCommand } from '../commands/music/skip';
import { previousCommand } from '../commands/music/previous';
import { stopCommand } from '../commands/music/stop';
import { queueCommand } from '../commands/music/queue';
import { nowplayingCommand } from '../commands/music/nowplaying';
import { volumeCommand } from '../commands/music/volume';
import { twentyFourSevenCommand } from '../commands/music/twentyFourSeven';
import { channelStatusCommand } from '../commands/music/channelStatus';
import { autoplayCommand } from '../commands/music/autoplay';

// Events
import { readyEvent } from '../events/discord/ready';
import { interactionCreateEvent } from '../events/discord/interactionCreate';
import { messageCreateEvent } from '../events/discord/messageCreate';
import { voiceStateUpdateEvent } from '../events/discord/voiceStateUpdate';

export class Bot {
  public readonly container: Container;
  private isShuttingDown = false;

  constructor() {
    this.container = new Container();
    this.container.config = config;
    this.container.logger = logger;
    this.container.commands = new CommandRegistry();

    this.container.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
      allowedMentions: { repliedUser: false },
    });

    // Initialize Domain Managers & Services
    const sourceManager = new SourceManager(this.container.config);
    const musicManager = new MusicManager(this.container.client, this.container.config, this.container.logger);
    const trackResolver = new TrackResolver(sourceManager, musicManager.shoukaku, this.container.logger);
    const musicService = new MusicService(musicManager, trackResolver, this.container.logger);
    const presenceManager = new PresenceManager(this.container.client, this.container, this.container.logger);
    const internalServer = new InternalServer(this.container);

    this.container.registerService('sourceManager', sourceManager);
    this.container.registerService('musicManager', musicManager);
    this.container.registerService('trackResolver', trackResolver);
    this.container.registerService('musicService', musicService);
    this.container.registerService('presenceManager', presenceManager);
    this.container.registerService('internalServer', internalServer);
  }

  public async start(): Promise<void> {
    const { client, logger } = this.container;

    logger.info('🔧 Initializing VoidTune v2 application core...');

    // 1. Register Commands
    this.registerCommands();

    // 2. Register Discord Events
    this.registerEvents();

    // 3. Register Process Signal Listeners for Graceful Shutdown
    this.registerProcessHandlers();

    // 4. Authenticate & Connect with Discord Gateway
    logger.info('🔐 Connecting to Discord Gateway...');
    await client.login(this.container.config.DISCORD_TOKEN);

    // 5. Start internal management API
    const internalServer = this.container.getService<InternalServer>('internalServer');
    await internalServer.start();
  }

  public async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.container.logger.info('🛑 Initiating graceful shutdown...');

    try {
      // Stop internal management API
      if (this.container.hasService('internalServer')) {
        const internalServer = this.container.getService<InternalServer>('internalServer');
        internalServer.stop();
      }

      // Stop dynamic presence rotator
      if (this.container.hasService('presenceManager')) {
        const presenceManager = this.container.getService<PresenceManager>('presenceManager');
        presenceManager.stop();
      }

      // Destroy active music players and stop keepalive
      if (this.container.hasService('musicManager')) {
        const musicManager = this.container.getService<MusicManager>('musicManager');
        musicManager.stop();
        for (const player of musicManager.getAllPlayers()) {
          await player.destroy().catch(() => {});
        }
      }

      if (this.container.client) {
        this.container.client.destroy();
        this.container.logger.info('🔌 Disconnected from Discord Gateway');
      }
    } catch (err) {
      this.container.logger.error({ err }, 'Error during Discord disconnect');
    }

    this.container.logger.info('👋 Graceful shutdown complete. Exiting.');
    process.exit(0);
  }

  private registerCommands(): void {
    const { commands, logger } = this.container;

    // Utility
    commands.register(pingCommand);
    commands.register(helpCommand);

    // Music
    commands.register(joinCommand);
    commands.register(leaveCommand);
    commands.register(playCommand);
    commands.register(pauseCommand);
    commands.register(resumeCommand);
    commands.register(skipCommand);
    commands.register(previousCommand);
    commands.register(stopCommand);
    commands.register(queueCommand);
    commands.register(nowplayingCommand);
    commands.register(volumeCommand);
    commands.register(twentyFourSevenCommand);
    commands.register(channelStatusCommand);
    commands.register(autoplayCommand);

    logger.info(`📋 Loaded ${commands.getAll().length} core commands into registry`);
  }

  private registerEvents(): void {
    const eventLoader = new EventLoader();

    eventLoader.register(readyEvent);
    eventLoader.register(interactionCreateEvent);
    eventLoader.register(messageCreateEvent);
    eventLoader.register(voiceStateUpdateEvent);

    eventLoader.bindAll(this.container);
  }

  private registerProcessHandlers(): void {
    const { logger } = this.container;

    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal');
      this.stop();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal');
      this.stop();
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error({ err: reason }, '💥 Unhandled Promise Rejection captured');
    });

    process.on('uncaughtException', (error: Error) => {
      logger.fatal({ err: error }, '💥 Uncaught Exception captured');
      this.stop();
    });
  }
}

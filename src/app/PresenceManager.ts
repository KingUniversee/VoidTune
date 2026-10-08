import { ActivityType, Client } from 'discord.js';
import { Logger } from 'pino';
import { Container } from './Container';
import { MusicService } from '../services/MusicService';

export interface PresenceEntry {
  name: (ctx: PresenceContext) => string;
  type: ActivityType;
}

export interface PresenceContext {
  guildCount: number;
  userCount: number;
  activePlayerCount: number;
  currentPlayingTitle?: string;
  defaultPrefix: string;
}

export class PresenceManager {
  private readonly client: Client;
  private readonly container: Container;
  private readonly logger: Logger;
  private intervalTimer: NodeJS.Timeout | null = null;
  private currentIndex = 0;
  private readonly ROTATION_INTERVAL_MS = 12 * 1000; // 12 seconds

  private readonly entries: PresenceEntry[] = [
    {
      name: (ctx) => `${ctx.defaultPrefix}play <song> • Lossless Audio`,
      type: ActivityType.Listening,
    },
    {
      name: (ctx) => `${ctx.guildCount} servers • VoidTune v2`,
      type: ActivityType.Watching,
    },
    {
      name: (ctx) =>
        ctx.currentPlayingTitle
          ? `${ctx.currentPlayingTitle.slice(0, 48)}`
          : '24/7 Studio Sound • Ultra-HD',
      type: ActivityType.Listening,
    },
    {
      name: (ctx) => `${ctx.userCount.toLocaleString()} listeners online`,
      type: ActivityType.Listening,
    },
    {
      name: (ctx) => `${ctx.defaultPrefix}help • VoidTune Studio`,
      type: ActivityType.Watching,
    },
    {
      name: (ctx) =>
        ctx.activePlayerCount > 0
          ? `Streaming audio in ${ctx.activePlayerCount} voice rooms`
          : 'Hi-Res 320kbps Audio Engine',
      type: ActivityType.Playing,
    },
  ];

  constructor(client: Client, container: Container, logger: Logger) {
    this.client = client;
    this.container = container;
    this.logger = logger.child({ module: 'PresenceManager' });
  }

  public start(): void {
    if (this.intervalTimer) return;

    this.logger.info('Starting dynamic presence rotator');
    this.updatePresence();

    this.intervalTimer = setInterval(() => {
      this.updatePresence();
    }, this.ROTATION_INTERVAL_MS);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      this.logger.info('Stopped dynamic presence rotator');
    }
  }

  public updatePresence(): void {
    if (!this.client.user) return;

    try {
      const context = this.gatherContext();
      const entry = this.entries[this.currentIndex % this.entries.length] ?? this.entries[0]!;
      const activityName = entry.name(context);

      this.client.user.setPresence({
        activities: [
          {
            name: activityName,
            type: entry.type,
          },
        ],
        status: 'online',
      });

      this.currentIndex = (this.currentIndex + 1) % this.entries.length;
    } catch (err) {
      this.logger.warn({ err }, 'Failed to update bot presence status');
    }
  }

  private gatherContext(): PresenceContext {
    const guildCount = this.client.guilds.cache.size;
    let userCount = 0;
    for (const guild of this.client.guilds.cache.values()) {
      userCount += guild.memberCount || 0;
    }

    let activePlayerCount = 0;
    let currentPlayingTitle: string | undefined;

    if (this.container.hasService('musicService')) {
      const musicService = this.container.getService<MusicService>('musicService');
      const playerStates = musicService.getAllPlayers();
      activePlayerCount = playerStates.filter((p) => p.isPlaying).length;

      for (const p of playerStates) {
        if (p.currentTrack) {
          currentPlayingTitle = p.currentTrack.title;
          break;
        }
      }
    }

    return {
      guildCount,
      userCount: Math.max(userCount, guildCount * 5),
      activePlayerCount,
      currentPlayingTitle,
      defaultPrefix: this.container.config?.DEFAULT_PREFIX || '/',
    };
  }
}

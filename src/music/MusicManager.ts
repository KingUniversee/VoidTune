import { Client, User } from 'discord.js';
import { Shoukaku, Connectors, NodeOption, ShoukakuOptions, Constants } from 'shoukaku';
import { GuildPlayer } from './GuildPlayer';
import { EnvConfig } from '../config/env';
import { Logger } from 'pino';
import { VoidTuneError, VoiceError } from '../utils/errors';
import { createNowPlayingV2, createActionV2, Theme, VTEmojis } from '../utils/theme';
import { Track } from './types/track';

export class MusicManager {
  public readonly shoukaku: Shoukaku;
  private readonly client: Client;
  private readonly players = new Map<string, GuildPlayer>();
  private readonly logger: Logger;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private readonly configuredNodes: NodeOption[];

  constructor(client: Client, config: EnvConfig, logger: Logger) {
    this.client = client;
    this.logger = logger.child({ module: 'MusicManager' });

    // 1. Primary Node (MilloHost v4)
    const primaryNode: NodeOption = {
      name: 'MilloHost-V4',
      url: `${config.LAVALINK_HOST || 'lava-v4.millohost.my.id'}:${config.LAVALINK_PORT || 443}`,
      auth: config.LAVALINK_PASSWORD || 'https://discord.gg/mjS5J2K3ep',
      secure: config.LAVALINK_SECURE ?? true,
    };

    // 2. High-Availability Fallback Nodes Pool
    const triniumNode: NodeOption = {
      name: 'Trinium-V4',
      url: 'lavalink-v4.triniumhost.com:443',
      auth: 'free',
      secure: true,
    };

    const nazhaNode: NodeOption = {
      name: 'Nazha-Main',
      url: 'lavalink.nazha.online:443',
      auth: 'nazhafreelava',
      secure: true,
    };

    this.configuredNodes = [primaryNode, triniumNode, nazhaNode];

    this.logger.info(
      `Configured Lavalink cluster: [Primary: ${primaryNode.name}] | [Failover Pool: Trinium-V4, Nazha-Main]`
    );

    const options: ShoukakuOptions = {
      resume: true,
      resumeByLibrary: true,
      moveOnDisconnect: true,
      resumeTimeout: 60,
      reconnectTries: 200,
      reconnectInterval: 10,
      restTimeout: 10,
      nodeResolver: (nodes) => {
        const connected = Array.from(nodes.values()).filter(
          (n) => n.state === Constants.State.CONNECTED && n.sessionId
        );
        if (connected.length === 0) return undefined;
        // Balance across connected nodes by penalty/load
        connected.sort((a, b) => (a.penalties || 0) - (b.penalties || 0));
        return connected[0];
      },
    };

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), this.configuredNodes, options);
    this.bindShoukakuEvents();
    this.startLavalinkKeepalive();
  }

  public getPlayer(guildId: string): GuildPlayer | undefined {
    return this.players.get(guildId);
  }

  public hasPlayer(guildId: string): boolean {
    return this.players.has(guildId);
  }

  public getAllPlayers(): GuildPlayer[] {
    return Array.from(this.players.values());
  }

  public async getOrCreatePlayer(options: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    shardId?: number;
  }): Promise<GuildPlayer> {
    const guild = this.client.guilds.cache.get(options.guildId);
    const botVoiceState = guild?.members.me?.voice;
    const botVoiceChannelId = botVoiceState?.channelId;

    const existing = this.players.get(options.guildId);
    if (existing && !existing.isDestroyed) {
      // Check if the bot is actively connected to a Discord voice channel
      if (botVoiceChannelId) {
        // If bot is already in the requested channel, simply update text channel and reuse
        if (botVoiceChannelId === options.voiceChannelId) {
          existing.textChannelId = options.textChannelId;
          return existing;
        }

        // If bot is in a different voice channel, move the bot to the requested channel
        try {
          this.logger.info(
            { guildId: options.guildId, from: botVoiceChannelId, to: options.voiceChannelId },
            'Moving bot to requested voice channel'
          );
          await botVoiceState.setChannel(options.voiceChannelId);
          existing.voiceChannelId = options.voiceChannelId;
          existing.textChannelId = options.textChannelId;
          return existing;
        } catch (moveErr) {
          this.logger.warn({ moveErr, guildId: options.guildId }, 'Failed to switch voice channels, recreating player');
        }
      }

      // If the bot is NOT physically in a voice channel (or move failed), this is a stale zombie player!
      this.logger.warn(
        { guildId: options.guildId, botVoiceChannelId },
        'Player exists in memory but bot is disconnected from voice. Purging stale session...'
      );
      await this.destroyPlayer(options.guildId);
    } else if (existing) {
      await this.destroyPlayer(options.guildId);
    }

    // Ensure Shoukaku's internal connection & player maps are clean before rejoining
    if (this.shoukaku.connections.has(options.guildId)) {
      try {
        await this.shoukaku.leaveVoiceChannel(options.guildId);
      } catch (leaveErr) {
        this.logger.debug({ leaveErr, guildId: options.guildId }, 'Cleaned up lingering Shoukaku connection before join');
      }
      this.shoukaku.connections.delete(options.guildId);
    }
    if (this.shoukaku.players.has(options.guildId)) {
      const lingeringPlayer = this.shoukaku.players.get(options.guildId);
      try { await lingeringPlayer?.destroy(); } catch {}
      this.shoukaku.players.delete(options.guildId);
    }

    const idealNode = this.shoukaku.getIdealNode();
    if (!idealNode) {
      throw new VoidTuneError({
        code: 'LAVALINK_UNAVAILABLE',
        message: 'No Lavalink audio nodes are currently available',
        userMessage: 'Audio processing node is currently unavailable. Please try again shortly.',
      });
    }

    try {
      this.logger.info(
        { guildId: options.guildId, voiceChannel: options.voiceChannelId, node: idealNode.name },
        'Connecting to Discord voice channel via Shoukaku'
      );

      const shardId = options.shardId ?? this.client.guilds.cache.get(options.guildId)?.shardId ?? 0;

      let shoukakuPlayer: any;
      try {
        shoukakuPlayer = await this.shoukaku.joinVoiceChannel({
          guildId: options.guildId,
          channelId: options.voiceChannelId,
          shardId,
          deaf: true,
        });
      } catch (firstJoinErr: any) {
        const isSessionDead =
          firstJoinErr?.status === 404 ||
          (firstJoinErr?.name === 'RestError' && String(firstJoinErr?.message || firstJoinErr?.error || '').includes('404')) ||
          String(firstJoinErr?.path || '').includes('/players/');

        if (isSessionDead) {
          this.logger.warn(
            { guildId: options.guildId, node: idealNode.name, err: firstJoinErr },
            'Lavalink session returned 404 during voice join. Refreshing node & retrying...'
          );

          // Invalidate and disconnect dead node so it reconnects with a fresh session
          try {
            idealNode.disconnect(4004, 'Session Not Found (404)');
          } catch {}

          // Clean lingering connection map
          if (this.shoukaku.connections.has(options.guildId)) {
            try {
              await this.shoukaku.leaveVoiceChannel(options.guildId);
            } catch {}
            this.shoukaku.connections.delete(options.guildId);
          }

          // Wait briefly for node failover or reconnection
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Retry joinVoiceChannel with fresh session
          shoukakuPlayer = await this.shoukaku.joinVoiceChannel({
            guildId: options.guildId,
            channelId: options.voiceChannelId,
            shardId,
            deaf: true,
          });
        } else {
          throw firstJoinErr;
        }
      }

      const player = new GuildPlayer({
        guildId: options.guildId,
        voiceChannelId: options.voiceChannelId,
        textChannelId: options.textChannelId,
        shoukakuPlayer,
        logger: this.logger,
      });

      player.on('playerDestroyed', () => {
        this.players.delete(options.guildId);
      });

      player.on('trackStart', async (track) => {
        try {
          // 1. Update Voice Channel Status with track title, author, and source emoji
          await this.setVoiceChannelStatus(player.voiceChannelId, track);

          if (!player.textChannelId) return;
          const channel = await this.client.channels.fetch(player.textChannelId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            // Deduplication: If the exact same track ID was already announced and the message is still active, don't send a duplicate!
            if (player.lastAnnouncedTrackId === track.id && player.lastNowPlayingMessage) {
              return;
            }

            // Delete previous Now Playing UI card if one exists
            if (player.lastNowPlayingMessage) {
              await player.lastNowPlayingMessage.delete().catch(() => {});
              player.lastNowPlayingMessage = null;
            }

            let requesterUser: User | undefined;
            const reqId = track.requesterId || (track as any).requestedBy;
            if (reqId) {
              requesterUser =
                this.client.users.cache.get(reqId) ||
                (await this.client.users.fetch(reqId).catch(() => undefined));
            }
            const voiceChannel = this.client.channels.cache.get(player.voiceChannelId);
            const voiceName = voiceChannel && 'name' in voiceChannel ? (voiceChannel as any).name : 'Voice Channel';
            const status = player.getStatus();
            const npMessage = createNowPlayingV2(track, status, voiceName, requesterUser, player.is247);
            const sent = await (channel as any).send(npMessage);
            player.lastNowPlayingMessage = sent;
            player.lastAnnouncedTrackId = track.id;
          }
        } catch (err) {
          this.logger.warn({ err, guildId: options.guildId }, 'Failed to send automatic Now Playing notification');
        }
      });

      player.on('queueEnd', async () => {
        // Clear voice channel status when queue finishes
        await this.setVoiceChannelStatus(player.voiceChannelId, null);
      });

      player.on('inactivityTimeout', async (reason: string) => {
        this.logger.info({ guildId: options.guildId, reason }, 'Inactivity timeout reached (5 minutes), leaving voice channel');
        try {
          if (player.textChannelId) {
            const channel = await this.client.channels.fetch(player.textChannelId).catch(() => null);
            if (channel && channel.isTextBased() && 'send' in channel) {
              const notice = createActionV2(
                `${VTEmojis.stop} Disconnected Due to Inactivity`,
                `VoidTune left the voice channel after **5 minutes of inactivity**.\nTo keep VoidTune in voice 24/7, enable **24/7 Mode** with \`/247\`!`,
                Theme.Colors.paused
              );
              await (channel as any).send(notice).catch(() => {});
            }
          }
        } catch (err) {
          this.logger.warn({ err }, 'Failed to send inactivity notice');
        }

        await this.destroyPlayer(options.guildId);
      });

      this.players.set(options.guildId, player);
      return player;
    } catch (err) {
      this.logger.error({ err, guildId: options.guildId }, 'Failed to join voice channel');
      throw new VoiceError(
        'VOICE_CONNECTION_FAILED',
        `Failed to establish voice connection: ${err instanceof Error ? err.message : String(err)}`,
        'Could not connect to your voice channel. Check bot permissions (Connect, Speak).'
      );
    }
  }

  public async setVoiceChannelStatus(voiceChannelId: string, track: Track | null): Promise<void> {
    try {
      if (!this.client.token) return;

      let statusText = '';
      if (track) {
        let sourceEmoji = VTEmojis.music;
        if (track.source === 'spotify') sourceEmoji = VTEmojis.spotify;
        else if (track.source === 'youtube') sourceEmoji = VTEmojis.youtube;
        else if (track.source === 'soundcloud') sourceEmoji = VTEmojis.soundcloud;

        const title = track.title || 'Music';
        const artist = track.author ? ` - ${track.author}` : '';
        statusText = `${sourceEmoji} ${title}${artist}`.slice(0, 500);
      }

      await fetch(`https://discord.com/api/v10/channels/${voiceChannelId}/voice-status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${this.client.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: statusText }),
      });
      this.logger.debug({ voiceChannelId, statusText }, 'Voice channel status updated');
    } catch (err) {
      this.logger.warn({ err, voiceChannelId }, 'Failed to set voice channel status');
    }
  }

  public async destroyPlayer(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player) {
      const voiceChannelId = player.voiceChannelId;
      await this.setVoiceChannelStatus(voiceChannelId, null).catch(() => {});
      await player.destroy().catch(() => {});
      this.players.delete(guildId);
    }

    try {
      await this.shoukaku.leaveVoiceChannel(guildId);
    } catch (err) {
      this.logger.warn({ err, guildId }, 'Error leaving voice channel in Shoukaku');
    }

    if (this.shoukaku.connections.has(guildId)) {
      const conn = this.shoukaku.connections.get(guildId);
      try { conn?.disconnect(); } catch {}
      this.shoukaku.connections.delete(guildId);
    }
    if (this.shoukaku.players.has(guildId)) {
      this.shoukaku.players.delete(guildId);
    }
  }

  public stop(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  private startLavalinkKeepalive(): void {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);

    this.keepaliveInterval = setInterval(async () => {
      // 0. Cluster Auto-Healing: Ensure all configured nodes exist in shoukaku.nodes
      for (const nodeOpt of this.configuredNodes) {
        if (!this.shoukaku.nodes.has(nodeOpt.name)) {
          this.logger.warn(
            { node: nodeOpt.name },
            'Keepalive detected missing Lavalink node in cluster! Auto-healing by re-adding node...'
          );
          try {
            this.shoukaku.addNode(nodeOpt);
          } catch (err) {
            this.logger.error({ err, node: nodeOpt.name }, 'Error re-adding node in keepalive');
          }
        }
      }

      for (const node of this.shoukaku.nodes.values()) {
        // If node is disconnected, attempt to reconnect
        if (node.state === Constants.State.DISCONNECTED) {
          this.logger.info({ node: node.name }, 'Detected disconnected Lavalink node in keepalive. Forcing reconnect...');
          try {
            node.connect();
          } catch (connErr) {
            this.logger.debug({ node: node.name, connErr }, 'Failed to reconnect Lavalink node');
          }
          continue;
        }

        if (node.state !== Constants.State.CONNECTED) continue;

        // 1. WebSocket Ping to maintain TCP connection through reverse proxies
        try {
          if (node.ws && (node.ws as any).readyState === 1 /* WebSocket.OPEN */) {
            (node.ws as any).ping();
          }
        } catch (pingErr) {
          this.logger.debug({ node: node.name, pingErr }, 'Keepalive WS ping error');
        }

        // 2. Validate session liveness on Lavalink server
        if (node.sessionId) {
          try {
            await node.rest.updateSession(true, 60);
          } catch (sessionErr: any) {
            if (sessionErr?.status === 404 || String(sessionErr?.message || '').includes('404')) {
              this.logger.warn(
                { node: node.name, sessionId: node.sessionId },
                'Lavalink session reported 404 on server! Forcing immediate node reconnect to acquire fresh session...'
              );
              try {
                node.disconnect(4004, 'Session 404 on server');
              } catch {}
            }
          }
        }
      }
    }, 20_000);
  }

  private bindShoukakuEvents(): void {
    const reportedFailedNodes = new Set<string>();

    this.shoukaku.on('ready', async (name, resumed) => {
      reportedFailedNodes.delete(name);
      this.logger.info(`🎵 Lavalink node [${name}] is ready! (Resumed: ${resumed})`);
      if (!resumed) {
        for (const [guildId, player] of Array.from(this.players.entries())) {
          // If the player's underlying node was the one that crashed and couldn't resume:
          if (player.shoukakuPlayer?.node?.name === name) {
            this.logger.warn({ guildId, node: name }, 'Node reconnected without resume; attempting state-preserving auto-recovery...');
            const currentTrack = player.currentTrack;
            const remainingTracks = [...player.queue.tracks];
            const voiceChannelId = player.voiceChannelId;
            const textChannelId = player.textChannelId;
            const is247 = player.is247;
            const autoplay = player.autoplay;

            await this.destroyPlayer(guildId).catch(() => {});

            if ((currentTrack || remainingTracks.length > 0 || is247) && voiceChannelId) {
              try {
                const newPlayer = await this.getOrCreatePlayer({
                  guildId,
                  voiceChannelId,
                  textChannelId,
                });
                newPlayer.is247 = is247;
                newPlayer.autoplay = autoplay;
                if (currentTrack) {
                  await newPlayer.play(currentTrack);
                  for (const t of remainingTracks) {
                    newPlayer.queue.add(t);
                  }
                  this.logger.info({ guildId, track: currentTrack.title }, 'Successfully auto-recovered playback on cluster');
                }
              } catch (recErr) {
                this.logger.warn({ recErr, guildId }, 'Auto-recovery failed after node reset');
              }
            }
          }
        }
      }
    });

    this.shoukaku.on('error', (name, error) => {
      // Log initial error once to prevent repetitive console spam every 10s
      if (!reportedFailedNodes.has(name)) {
        reportedFailedNodes.add(name);
        this.logger.warn({ node: name, message: (error as any)?.message || error }, `⚠️ Lavalink node [${name}] connection issue`);
      }
    });

    this.shoukaku.on('close', (name, code, reason) => {
      if (!reportedFailedNodes.has(name)) {
        this.logger.warn(`🔌 Lavalink node [${name}] closed (Code: ${code}, Reason: ${reason})`);
      }
    });

    this.shoukaku.on('disconnect', (name, count) => {
      if (!reportedFailedNodes.has(name)) {
        this.logger.warn(`⚠️ Lavalink node [${name}] disconnected (Count: ${count})`);
      }
      setTimeout(() => {
        const nodeOpt = this.configuredNodes.find((n) => n.name === name);
        if (nodeOpt && !this.shoukaku.nodes.has(name)) {
          try {
            this.shoukaku.addNode(nodeOpt);
          } catch {}
        }
      }, 10_000);
    });

    this.shoukaku.on('reconnecting', (name, left) => {
      // Only log reconnect notice every 30 tries (approx every 5 minutes) instead of every 10 seconds
      if (left % 30 === 0) {
        this.logger.info(`🔄 Lavalink node [${name}] reconnect attempt (${left} attempts left)`);
      }
    });
  }
}

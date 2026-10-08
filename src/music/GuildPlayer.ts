import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Player } from 'shoukaku';
import { QueueManager } from './QueueManager';
import { PlaybackController } from './PlaybackController';
import { Track, RepeatMode } from './types/track';
import { PlaybackStatus } from './types/playback';
import { Logger } from 'pino';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

export interface GuildPlayerOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  shoukakuPlayer: Player;
  logger: Logger;
}

export class GuildPlayer extends EventEmitter {
  public readonly guildId: string;
  public voiceChannelId: string;
  public textChannelId: string;
  public readonly shoukakuPlayer: Player;
  public readonly queue: QueueManager;
  public readonly playback: PlaybackController;
  public autoplay = false;
  public is247 = false;
  public lastAnnouncedTrackId: string | null = null;
  public lastNowPlayingMessage: any = null;

  private _volume = 100;
  private readonly _logger: Logger;
  private _isDestroyed = false;
  private inactivityTimeout: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  private trackStartedAt = 0;

  constructor(options: GuildPlayerOptions) {
    super();
    this.guildId = options.guildId;
    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId;
    this.shoukakuPlayer = options.shoukakuPlayer;
    this._logger = options.logger.child({ module: 'GuildPlayer', guildId: this.guildId });

    this.queue = new QueueManager();
    this.playback = new PlaybackController(this._logger);

    this.bindPlayerEvents();
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  get volume(): number {
    return this._volume;
  }

  get position(): number {
    const rawPos = this.shoukakuPlayer.position || 0;
    if (rawPos > 0) return rawPos;
    if (this.isPlaying && this.trackStartedAt > 0) {
      return Date.now() - this.trackStartedAt;
    }
    return 0;
  }

  get currentTrack(): Track | null {
    return this.queue.current;
  }

  get isPlaying(): boolean {
    return this.playback.state === 'PLAYING' || this.playback.state === 'BUFFERING';
  }

  get isPaused(): boolean {
    return this.playback.state === 'PAUSED';
  }

  public getStatus(): PlaybackStatus {
    return {
      state: this.playback.state,
      currentTrack: this.currentTrack,
      position: this.position,
      volume: this._volume,
      paused: this.isPaused,
      repeatMode: this.queue.repeatMode,
      shuffle: false,
      autoplay: this.autoplay,
    };
  }

  public set247(enabled: boolean): void {
    this.is247 = enabled;
    this._logger.info({ enabled }, '24/7 mode toggled');
    if (enabled) {
      this.clearInactivityTimer();
    } else {
      if (!this.isPlaying && !this.isPaused) {
        this.startInactivityTimer('24/7 disabled and player idle');
      }
    }
    this.emit('247Change', enabled);
  }

  public startInactivityTimer(reason = 'inactivity'): void {
    if (this.is247) {
      this._logger.debug('24/7 mode is active, suppressing inactivity timer');
      return;
    }

    this.clearInactivityTimer();
    this._logger.info({ reason, durationMs: this.INACTIVITY_DURATION_MS }, 'Started 5-minute inactivity timer');

    this.inactivityTimeout = setTimeout(() => {
      this._logger.info('Inactivity timeout reached, triggering disconnect');
      this.emit('inactivityTimeout', reason);
    }, this.INACTIVITY_DURATION_MS);
  }

  public clearInactivityTimer(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
      this._logger.debug('Cleared inactivity timer');
    }
  }

  public async play(track?: Track): Promise<boolean> {
    return this.playback.withLock(async () => {
      if (this._isDestroyed) return false;

      let targetTrack = track;
      if (!targetTrack) {
        targetTrack = this.queue.next() || undefined;
      } else {
        this.queue.setCurrent(targetTrack);
      }

      if (!targetTrack) {
        this.playback.transition('IDLE', 'Queue is empty');
        this.emit('queueEnd');
        if (!this.is247) {
          this.startInactivityTimer('Queue empty');
        }
        return false;
      }

      this.clearInactivityTimer();
      this.playback.transition('BUFFERING', `Starting track: ${targetTrack.title}`);

      // Ensure Spotify tracks have a direct verified original audio stream
      await this.preResolvePlayableAudio(targetTrack);

      try {
        await this.shoukakuPlayer.playTrack({
          track: {
            encoded: targetTrack.encodedTrack,
          },
        });
        this.trackStartedAt = Date.now();

        // Buffering Watchdog: If Lavalink's WebSocket delays TrackStartEvent,
        // force state to PLAYING and emit trackStart so the Now Playing UI is never lost!
        setTimeout(() => {
          if (this.playback.state === 'BUFFERING' && this.queue.current?.id === targetTrack.id && !this._isDestroyed) {
            this._logger.info({ track: targetTrack.title }, 'Buffering watchdog fired: transitioning to PLAYING and emitting trackStart');
            this.playback.transition('PLAYING', `Buffering watchdog unblocked: ${targetTrack.title}`);
            this.emit('trackStart', targetTrack);
          }
        }, 3500);

        return true;
      } catch (err: any) {
        this._logger.error({ err, track: targetTrack.title }, 'Error calling playTrack in Shoukaku');

        // Failover recovery: If Lavalink returned 404 (session dropped) or node disconnected
        const isSessionError = err?.status === 404 || err?.message?.includes('Not Found') || err?.message?.includes('closed');
        if (isSessionError) {
          try {
            this._logger.warn({ track: targetTrack.title }, 'Attempting player node failover after playTrack failure');
            const moved = await this.shoukakuPlayer.move();
            if (moved) {
              this._logger.info({ track: targetTrack.title }, 'Successfully moved player to healthy node, retrying track');
              await this.shoukakuPlayer.playTrack({
                track: {
                  encoded: targetTrack.encodedTrack,
                },
              });
              return true;
            }
          } catch (moveErr) {
            this._logger.warn({ moveErr }, 'Player node failover failed');
          }
        }

        this.playback.transition('ERROR', 'playTrack exception');
        this.emit('trackException', targetTrack, err instanceof Error ? err : new Error(String(err)));
        // Auto-advance to next
        await this.playNext();
        return false;
      }
    });
  }

  public async playNext(): Promise<boolean> {
    if (this._isDestroyed) return false;

    let nextTrack = this.queue.next();

    // If queue is empty and autoplay is ON: automatically recommend and play a similar track
    if (!nextTrack && this.autoplay) {
      nextTrack = (await this.fetchAutoplayRecommendation()) || null;
    }

    if (!nextTrack) {
      this.playback.transition('IDLE', 'No further tracks');
      this.emit('queueEnd');
      if (!this.is247) {
        this.startInactivityTimer('Queue ended');
      }
      return false;
    }

    return this.play(nextTrack);
  }

  /**
   * Pre-resolves an official, high-quality audio stream for Spotify tracks,
   * strictly filtering out slowed, reverb, sped-up, amateur covers, and foreign recitations.
   */
  private async preResolvePlayableAudio(targetTrack: Track): Promise<void> {
    if (targetTrack.source !== 'spotify' || targetTrack.metadata?.playableResolved) {
      return;
    }

    try {
      const cleanTitle = targetTrack.title
        .replace(/\s*[([{\-].*$/, '')
        .replace(/\b(lyrics|official|hd|video|4k|remastered|audio|mix)\b/gi, '')
        .trim();
      const cleanArtist = targetTrack.author && targetTrack.author !== 'Unknown Artist'
        ? targetTrack.author.split(',')[0]?.split('&')[0]?.trim() || ''
        : '';
      const targetDuration = targetTrack.duration || 0;

      const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      const targetHasArabic = ARABIC_SCRIPT_REGEX.test(targetTrack.title) || ARABIC_SCRIPT_REGEX.test(targetTrack.author || '');

      const SPEED_MOD_REGEX = /\b(slowed|reverb|slowed\s*\+\s*reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|pitch\s*shift|bass\s*boosted|8d\s*audio|jhankar)\b/i;
      const NON_ORIGINAL_REGEX = /\b(karaoke|instrumental|piano\s*cover|guitar\s*cover|acoustic\s*cover|reaction|review|tutorial|parody)\b/i;
      const NON_MUSIC_REGEX = /\b(surah|bayan|recitation|tilawat|khutbah|naat|nasheed|lecture|sermon|quran|podcast|audiobook|reaction|interview|vlog|news|review|tutorial|drama|serial|episode|tarjuma|tafseer)\b/i;

      const allowCover = /\bcover\b/i.test(targetTrack.title);
      const allowRemix = /\bremix\b/i.test(targetTrack.title);
      const allowSpeed = SPEED_MOD_REGEX.test(targetTrack.title);

      const allNodes = [
        this.shoukakuPlayer.node,
        ...Array.from(this.shoukakuPlayer.node.manager.nodes.values()).filter(
          (n) => n.name !== this.shoukakuPlayer.node.name
        ),
      ].filter((n) => n && n.state === 1 && n.rest);

      if (allNodes.length === 0) return;

      // Resolve using YouTube Music (ytmsearch:) for pure original studio master audio,
      // falling back to official YouTube audio searches and lastly SoundCloud.
      const queries = [
        `ytmsearch:${cleanTitle} ${cleanArtist}`.trim(),
        `ytmsearch:${cleanTitle}`.trim(),
        `ytsearch:${cleanTitle} ${cleanArtist} official audio`.trim(),
        `scsearch:${cleanTitle} ${cleanArtist}`.trim(),
      ];

      const candidates: any[] = [];

      for (const query of queries) {
        for (const node of allNodes) {
          try {
            const res = await lavalinkGatekeeper.resolve(node, query, 5000);
            const data = res?.data as any;
            const list = (Array.isArray(data) ? data : data?.tracks || []) as any[];
            if (list.length > 0) {
              candidates.push(...list);
              break;
            }
          } catch {}
        }
        if (candidates.length >= 6) break;
      }

      const titleWords = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['the', 'and', 'for', 'from', 'with', 'hai', 'yeh', 'mein', 'hum', 'aur', 'part', 'vol'].includes(w));

      const scoreCandidate = (cand: any): number => {
        const title = (cand.info?.title || '').toLowerCase();
        const author = (cand.info?.author || '').toLowerCase();
        const length = cand.info?.length || 0;
        const sourceName = cand.info?.sourceName || '';

        // 1. REJECT SHORT PREVIEWS / SNIPPETS!
        // SoundCloud free previews and snippet tracks are <= 35 seconds. Real tracks are > 60s.
        if (targetDuration > 60000 && length <= 35000) return -999;

        // 2. Reject speed modifications (slowed/reverb/sped-up) unless explicit in target title
        if (!allowSpeed && SPEED_MOD_REGEX.test(title)) return -999;

        // 3. Reject non-music, news, religious bayans, lectures, podcasts in both title and author
        if (NON_MUSIC_REGEX.test(title) || NON_MUSIC_REGEX.test(author)) return -999;

        // 4. Reject foreign scripts if original song does not have them
        if (!targetHasArabic && ARABIC_SCRIPT_REGEX.test(title)) return -999;

        // 5. Reject amateur covers unless requested
        if (!allowCover && NON_ORIGINAL_REGEX.test(title)) return -999;
        if (!allowRemix && /\bremix\b/i.test(title) && !/\bremix\b/i.test(targetTrack.title)) return -400;

        // 6. Strict Duration Lock: difference cannot exceed 50 seconds
        if (targetDuration > 30000 && length > 0) {
          const diffMs = Math.abs(length - targetDuration);
          if (diffMs > 50000) return -999;
        }

        // 7. MANDATORY TITLE KEYWORD MATCH: Candidate must match at least one significant word from the target song
        let matchedWords = 0;
        for (const word of titleWords) {
          if (title.includes(word)) matchedWords++;
        }
        if (titleWords.length > 0 && matchedWords === 0) return -999;

        let score = 0;

        // Title match score (up to +70)
        if (titleWords.length > 0) {
          score += Math.round((matchedWords / titleWords.length) * 70);
        } else {
          score += 40;
        }

        // Artist match bonus (+50)
        const artistLower = cleanArtist.toLowerCase();
        if (artistLower && (author.includes(artistLower) || title.includes(artistLower))) {
          score += 50;
        }

        // YouTube Music Official Release & Topic Bonus (+40)
        if (author.includes('topic') || author.includes('records') || author.includes('vevo') || author.includes('sony') || author.includes('t-series') || author.includes('zee') || author.includes('yrf')) {
          score += 40;
        }
        if (sourceName === 'youtube') {
          score += 25; // Strongly prefer official YouTube Music / YouTube streams
        }

        // Duration accuracy bonus (up to +30)
        if (targetDuration > 30000 && length > 0) {
          const diffSec = Math.abs(length - targetDuration) / 1000;
          score += Math.max(0, 30 - Math.round(diffSec));
        }

        return score;
      };

      let bestCand: any = null;
      let bestScore = 39; // Must score at least 40 to be accepted

      for (const cand of candidates) {
        const score = scoreCandidate(cand);
        if (score > bestScore) {
          bestScore = score;
          bestCand = cand;
        }
      }

      if (bestCand?.encoded) {
        this._logger.info(
          {
            spotifyTrack: targetTrack.title,
            resolved: bestCand.info?.title,
            author: bestCand.info?.author,
            sourceName: bestCand.info?.sourceName,
            score: bestScore,
            targetDuration,
            candDuration: bestCand.info?.length,
          },
          'Pre-resolved verified original studio audio for track'
        );
        targetTrack.encodedTrack = bestCand.encoded;
        targetTrack.metadata = {
          ...targetTrack.metadata,
          playableResolved: true,
        };
      }
    } catch (resolveErr) {
      this._logger.warn({ resolveErr, track: targetTrack.title }, 'Pre-resolving playable audio encountered error');
    }
  }

  /**
   * Fetches an artist-aligned and genre-matched recommendation when the queue completes.
   * Eliminates random non-music audio, foreign recitations, and slowed/sped-up tracks.
   */
  public async fetchAutoplayRecommendation(): Promise<Track | null> {
    const seedTrack = this.queue.current || this.queue.history[this.queue.history.length - 1];
    if (!seedTrack) return null;

    try {
      const allNodes = Array.from(this.shoukakuPlayer.node.manager.nodes.values()).filter(
        (n) => n && n.state === 1 && n.rest
      );

      const candidateNodes = allNodes.sort((a, b) => {
        if (a.name === 'Millo-Node') return -1;
        if (b.name === 'Millo-Node') return 1;
        return 0;
      });

      if (candidateNodes.length === 0) return null;

      const rawAuthor = seedTrack.author?.trim();
      const cleanArtist = rawAuthor && rawAuthor !== 'Unknown Artist'
        ? rawAuthor.split(',')[0]?.split('&')[0]?.trim() || ''
        : '';
      const cleanSeedTitle = seedTrack.title
        .toLowerCase()
        .replace(/\s*[([{\-].*$/, '')
        .replace(/\b(lyrics|official|hd|video|4k|remastered|audio|mix)\b/gi, '')
        .trim();

      const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      const seedHasArabic = ARABIC_SCRIPT_REGEX.test(seedTrack.title) || ARABIC_SCRIPT_REGEX.test(seedTrack.author || '');

      const NON_MUSIC_TERMS = /\b(surah|bayan|recitation|tilawat|khutbah|naat|nasheed|lecture|sermon|quran|podcast|audiobook|reaction|interview|vlog|news|alert|alerts|review|tutorial|drama|serial|episode|tarjuma|tafseer|making\s*of|the\s*making|intro\s*by|introduction\s*by|commentary|dialogue|speech|award|behind\s*the\s*scenes|teaser|trailer|promo)\b/i;
      const SPEED_TERMS = /\b(slowed|reverb|slowed\s*\+\s*reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|pitch\s*shift|bass\s*boosted|8d\s*audio|karaoke|instrumental|lofi|lo-fi)\b/i;
      const COVER_TERMS = /\b(cover|mashup|parody|acoustic\s*cover|guitar\s*cover|piano\s*cover)\b/i;

      const seedHasCover = COVER_TERMS.test(seedTrack.title);

      // We use YouTube Music Automix Radio (RDAMVM) just like Hydra & Minton for genuine genre matching across diverse artists
      let videoId = '';
      const ytMatch = seedTrack.uri?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (ytMatch && ytMatch[1]) {
        videoId = ytMatch[1];
      } else {
        const searchQ = `ytmsearch:${cleanSeedTitle} ${cleanArtist}`.trim();
        for (const node of candidateNodes) {
          try {
            const sRes = await lavalinkGatekeeper.resolve(node, searchQ, 5000);
            const sList = (sRes?.data as any) || [];
            if (sList.length > 0 && sList[0]?.info?.identifier) {
              videoId = sList[0].info.identifier;
              break;
            }
          } catch {}
        }
      }

      const queries: string[] = [];

      if (videoId) {
        // Industry-standard YouTube Music Automix: curated 25-song playlist matching tempo, mood, and era
        queries.push(`https://www.youtube.com/watch?v=${videoId}&list=RDAMVM${videoId}`);
        queries.push(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`);
      }

      if (cleanSeedTitle && cleanArtist) {
        queries.push(`ytmsearch:${cleanSeedTitle} ${cleanArtist} radio`);
      }
      if (cleanSeedTitle) {
        queries.push(`ytmsearch:${cleanSeedTitle} radio`);
      }
      if (cleanArtist) {
        queries.push(`ytmsearch:${cleanArtist} hits radio`);
        queries.push(`ytmsearch:${cleanArtist} songs`);
      }

      const recentHistory = this.queue.history.slice(-40);
      const historyTitles = recentHistory.map((h) => h.title.toLowerCase());
      const seedLower = seedTrack.title.toLowerCase();

      // Count consecutive plays of the same artist to prevent looping
      let consecutiveArtistCount = 0;
      for (let i = this.queue.history.length - 1; i >= 0; i--) {
        const h = this.queue.history[i];
        if (h && cleanArtist && h.author && h.author.toLowerCase().includes(cleanArtist.toLowerCase())) {
          consecutiveArtistCount++;
        } else {
          break;
        }
      }

      for (const query of queries) {
        this._logger.info({ query, seedTrack: seedTrack.title, videoId }, 'Searching for genre-matched smart autoplay recommendation');
        try {
          let tracks: any[] = [];
          for (const node of candidateNodes) {
            try {
              const res = await lavalinkGatekeeper.resolve(node, query, 5000);
              const data = res?.data as any;
              const list = (Array.isArray(data) ? data : data?.tracks || []) as any[];
              if (list.length > 0) {
                tracks = list;
                break;
              }
            } catch (err: any) {
              // Handled by lavalinkGatekeeper
            }
          }

          if (!tracks || tracks.length === 0) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }

        // Filter candidates strictly
        const candidates = tracks.filter((t) => {
          const title = (t.info?.title || '').toLowerCase();
          const author = (t.info?.author || '').toLowerCase();
          const length = t.info?.length || 0;
          if (!title) return false;

          // Exclude the seed song itself and variations (including minor spelling differences like dastan / dastaan, ajeeb / ajib)
          if (title.includes(cleanSeedTitle) || (cleanSeedTitle.length > 4 && cleanSeedTitle.includes(title))) return false;
          if (title.includes(seedLower) || seedLower.includes(title)) return false;

          const normalizePhonetic = (str: string) =>
            str
              .toLowerCase()
              .replace(/ee/g, 'i')
              .replace(/oo/g, 'u')
              .replace(/aa/g, 'a')
              .replace(/ou/g, 'u')
              .replace(/y/g, 'i')
              .replace(/[^a-z0-9]/g, '');

          const seedNorm = normalizePhonetic(cleanSeedTitle);
          const candNorm = normalizePhonetic(title);
          if (seedNorm.length >= 6) {
            const seedCore = seedNorm.slice(0, 7);
            if (candNorm.includes(seedCore)) return false;
          }

          const seedWords = cleanSeedTitle.split(/\s+/).filter((w: string) => w.length > 2 && !['hai', 'yeh', 'mein', 'the', 'and'].includes(w));
          const candWords = title.split(/\s+/).filter((w: string) => w.length > 2 && !['hai', 'yeh', 'mein', 'the', 'and'].includes(w));
          if (seedWords.length > 0 && candWords.length > 0) {
            if (seedWords[0] === candWords[0] && (seedWords.length === 1 || title.includes(seedWords[1]) || (seedWords[1] && candWords[1] && (seedWords[1].startsWith(candWords[1].slice(0, 4)) || candWords[1].startsWith(seedWords[1].slice(0, 4)))))) {
              return false;
            }
          }

          // Exclude tracks already played in recent history
          if (historyTitles.some((ht) => ht.includes(title) || (title.length > 5 && title.includes(ht)))) return false;

          // Reject script mismatch (prevent Arabic/Persian recitations on Bollywood/Punjabi/English songs)
          if (!seedHasArabic && ARABIC_SCRIPT_REGEX.test(title)) return false;

          // Reject religious talks, bayans, podcasts, news, making-of commentary in both title and author
          if (NON_MUSIC_TERMS.test(title) || NON_MUSIC_TERMS.test(author)) return false;

          // Reject altered speed tracks (slowed/reverb, nightcore)
          if (SPEED_TERMS.test(title)) return false;

          // Reject covers unless original was a cover
          if (!seedHasCover && COVER_TERMS.test(title)) return false;

          // Reject invalid durations: Songs must be between 75s (1m15s) and 480s (8 mins)
          if (length < 75000 || length > 480000) return false;

          return true;
        });

        if (candidates.length > 0) {
          // Rank candidates for optimal genre alignment and healthy artist diversity
            const scored = candidates.map((cand) => {
              const title = (cand.info?.title || '').toLowerCase();
              const author = (cand.info?.author || '').toLowerCase();
              let score = 50;

              // Official release / Topic channel bonus (+25)
              if (author.includes('topic') || author.includes('records') || author.includes('vevo')) {
                score += 25;
              }
              if (title.includes('official')) {
                score += 10;
              }

              // Artist Variety: Award points to diverse complementary artists in the same genre mix
              if (cleanArtist) {
                const artistLower = cleanArtist.toLowerCase();
                const isSameArtist = author.includes(artistLower) || title.includes(artistLower);
                if (consecutiveArtistCount >= 2 && isSameArtist) {
                  score -= 60; // Throttle artist if already played twice consecutively!
                } else if (!isSameArtist) {
                  score += 35; // Healthy artist diversity in the same genre!
                } else {
                  score += 15;
                }
              }

              return { cand, score };
            });

            scored.sort((a, b) => b.score - a.score);

            // Pick from the top scoring slice (up to top 6) so the queue has great dynamic variety
            const topSlice = scored.slice(0, Math.min(6, scored.length));
            const chosenEntry = topSlice[Math.floor(Math.random() * topSlice.length)];
            const chosen = chosenEntry?.cand;
            if (!chosen) continue;
            const info = chosen.info || {};

            const recommendedTrack: Track = {
              id: randomUUID(),
              encodedTrack: chosen.encoded,
              title: info.title || 'Unknown Title',
              author: info.author || cleanArtist || 'Unknown Artist',
              duration: info.length || 0,
              uri: info.uri || '',
              source: 'youtube', // Play official audio directly without re-routing
              thumbnail: info.artworkUrl || seedTrack.thumbnail,
              requesterId: 'Autoplay',
              isStream: info.isStream || false,
              metadata: {
                playableResolved: true,
              },
            };

            this._logger.info(
              {
                original: seedTrack.title,
                recommended: recommendedTrack.title,
                by: recommendedTrack.author,
                queryUsed: query,
              },
              'Selected genre-matched smart autoplay recommendation'
            );
            return recommendedTrack;
          }
        } catch (queryErr) {
          this._logger.debug({ queryErr, query }, 'Autoplay candidate query failed or timed out');
        }
      }
    } catch (err) {
      this._logger.warn({ err, seedTrack: seedTrack.title }, 'Error fetching autoplay recommendation');
    }

    return null;
  }

  public async pause(): Promise<void> {
    await this.playback.withLock(async () => {
      if (this.playback.state !== 'PLAYING') return;
      await this.shoukakuPlayer.setPaused(true);
      this.playback.transition('PAUSED', 'User paused playback');
      this.emit('stateChange', 'PLAYING', 'PAUSED');
    });
  }

  public async resume(): Promise<void> {
    await this.playback.withLock(async () => {
      if (this.playback.state !== 'PAUSED') return;
      await this.shoukakuPlayer.setPaused(false);
      this.playback.transition('PLAYING', 'User resumed playback');
      this.emit('stateChange', 'PAUSED', 'PLAYING');
    });
  }

  private async internalStop(reason = 'User stopped playback'): Promise<void> {
    this.trackStartedAt = 0;
    this.queue.clearAll();
    await this.shoukakuPlayer.stopTrack().catch(() => {});
    this.playback.transition('IDLE', reason);
    this.lastAnnouncedTrackId = null;
    if (this.lastNowPlayingMessage) {
      await this.lastNowPlayingMessage.delete().catch(() => {});
      this.lastNowPlayingMessage = null;
    }
    if (!this.is247) {
      this.startInactivityTimer(reason);
    }
    this.emit('queueEnd');
  }

  public async skip(): Promise<Track | null> {
    return this.playback.withLock(async () => {
      const skipped = this.queue.current;

      // If loop mode is currently 'track', bypass it when user explicitly skips
      if (this.queue.repeatMode === 'track') {
        this.queue.setRepeatMode('off');
      }

      // If queue is empty and autoplay is OFF: stop immediately and do not play anything
      if (this.queue.isEmpty && !this.autoplay) {
        await this.internalStop('User skipped with empty queue and autoplay off');
        return skipped;
      }

      await this.playNext();
      return skipped;
    });
  }

  public async previous(): Promise<Track | null> {
    return this.playback.withLock(async () => {
      if (this._isDestroyed) return null;

      const prevTrack = this.queue.previous();
      if (!prevTrack) {
        if (this.currentTrack) {
          await this.seek(0);
        }
        return null;
      }

      await this.play(prevTrack);
      return prevTrack;
    });
  }

  public async stop(): Promise<void> {
    await this.playback.withLock(async () => {
      await this.internalStop('User stopped playback');
    });
  }

  public async seek(positionMs: number): Promise<void> {
    await this.playback.withLock(async () => {
      if (!this.currentTrack) return;
      const targetPos = Math.max(0, Math.min(positionMs, this.currentTrack.duration));
      this.trackStartedAt = Date.now() - targetPos;
      await this.shoukakuPlayer.seekTo(targetPos);
    });
  }

  public async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, volume));
    this._volume = clamped;
    // Shoukaku volume expects integer (0-100 or higher, 100 is 100%)
    await this.shoukakuPlayer.setGlobalVolume(clamped);
  }

  public setRepeatMode(mode: RepeatMode): void {
    this.queue.setRepeatMode(mode);
  }

  public async destroy(): Promise<void> {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    this.clearInactivityTimer();
    this._logger.info('Destroying GuildPlayer session');
    this.queue.clearAll();
    this.playback.transition('IDLE', 'Player destroyed');

    if (this.lastNowPlayingMessage) {
      await this.lastNowPlayingMessage.delete().catch(() => {});
      this.lastNowPlayingMessage = null;
    }

    try {
      await this.shoukakuPlayer.destroy();
    } catch (err) {
      this._logger.warn({ err }, 'Error destroying Shoukaku player');
    }

    this.emit('playerDestroyed');
    this.removeAllListeners();
  }

  private bindPlayerEvents(): void {
    this.shoukakuPlayer.on('start', () => {
      this.trackStartedAt = Date.now();
      const track = this.queue.current;
      if (track) {
        this.playback.transition('PLAYING', `Track started: ${track.title}`);
        this.emit('trackStart', track);
      }
    });

    this.shoukakuPlayer.on('end', async (reason) => {
      this.trackStartedAt = 0;
      const track = this.queue.current;
      const endReason = typeof reason === 'string' ? reason : (reason as any)?.reason || 'finished';
      this.playback.transition('ENDED', `Track ended: reason ${JSON.stringify(reason)}`);
      if (track) {
        this.emit('trackEnd', track, endReason);
      }

      // ONLY advance naturally when the song cleanly finished playing.
      // 'loadFailed' is handled by on('exception')
      // 'replaced', 'stopped', 'cleanup' must NOT trigger playNext
      if (endReason === 'finished') {
        await this.playNext();
      }
    });

    this.shoukakuPlayer.on('exception', async (error) => {
      this.trackStartedAt = 0;
      const track = this.queue.current;
      this._logger.error({ err: error, track: track?.title }, 'Shoukaku player exception encountered');
      this.playback.transition('ERROR', 'Track exception');
      if (track) {
        this.emit('trackException', track, error instanceof Error ? error : new Error(String(error)));
      }

      // If a track failed (e.g. YouTube stream restriction or cipher error), attempt seamless SoundCloud recovery
      if (track && track.source !== 'soundcloud') {
        try {
          const allNodes = [
            this.shoukakuPlayer.node,
            ...Array.from(this.shoukakuPlayer.node.manager.nodes.values()).filter(
              (n) => n.name !== this.shoukakuPlayer.node.name
            ),
          ].filter((n) => n && n.state === 1 && n.rest);

          const cleanTitle = track.title
            .replace(/\s*[([{\-].*$/, '')
            .replace(/\b(lyrics|official|hd|video|4k|remastered|audio|mix)\b/gi, '')
            .trim();
          const cleanArtist = track.author && track.author !== 'Unknown Artist'
            ? track.author.split(',')[0]?.trim() || ''
            : '';
          const recoveryQueries = [
            `ytmsearch:${cleanTitle} ${cleanArtist}`.trim(),
            `ytsearch:${cleanTitle} ${cleanArtist} official audio`.trim(),
            `scsearch:${cleanTitle} ${cleanArtist}`.trim(),
          ];
          this._logger.info({ recoveryQueries }, 'Attempting automated stream recovery for failed track');

          let recoveredTrackCandidate: any = null;
          for (const query of recoveryQueries) {
            for (const node of allNodes) {
              try {
                const res = await lavalinkGatekeeper.resolve(node, query, 5000);
                const data = res?.data as any;
                const list = (Array.isArray(data) ? data : data?.tracks || []) as any[];
                const targetDuration = track.duration || 0;
                const allowRemix = /\bremix\b/i.test(track.title);
                const allowSpeed = /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore)\b/i.test(track.title);

                const valid = list.filter((cand: any) => {
                  const title = (cand.info?.title || '').toLowerCase();
                  const length = cand.info?.length || 0;
                  if (targetDuration > 60000 && length <= 35000) return false;
                  if (!allowSpeed && /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|pitch|jhankar)\b/i.test(title)) return false;
                  if (!allowRemix && /\bremix\b/i.test(title) && !/\bremix\b/i.test(track.title)) return false;
                  if (targetDuration > 30000 && length > 0) {
                    if (Math.abs(length - targetDuration) > 45000) return false;
                  }
                  return true;
                });
                recoveredTrackCandidate = valid[0] || null;
                if (recoveredTrackCandidate) break;
              } catch {}
            }
            if (recoveredTrackCandidate) break;
          }

          if (recoveredTrackCandidate) {
            this._logger.info(
              { original: track.title, recovered: recoveredTrackCandidate.info.title },
              'Successfully recovered track stream'
            );
            const recoveredTrack: Track = {
              ...track,
              encodedTrack: recoveredTrackCandidate.encoded,
              source: recoveredTrackCandidate.info?.sourceName || track.source,
              uri: track.uri,
              metadata: {
                ...track.metadata,
                playableResolved: true,
              },
            };
            this.playback.transition('IDLE', 'Recovery transition');
            await this.play(recoveredTrack);
            return;
          }
        } catch (recoverErr) {
          this._logger.warn({ recoverErr }, 'Stream recovery attempt failed');
        }
      }

      // Fallback: advance to next queued track
      this.playNext().catch((err) => {
        this._logger.error({ err }, 'Failed to advance to next track after exception');
      });
    });

    this.shoukakuPlayer.on('stuck', (thresholdMs) => {
      const track = this.queue.current;
      this._logger.warn({ track: track?.title, thresholdMs }, 'Track got stuck in Lavalink player');
      if (track) {
        this.emit('trackStuck', track, thresholdMs);
      }
      // Force advance
      this.playNext().catch((err) => {
        this._logger.error({ err }, 'Failed to advance to next track after stuck event');
      });
    });

    this.shoukakuPlayer.on('closed', (reason) => {
      this._logger.warn({ reason }, 'Lavalink WebSocket connection closed for player');
    });
  }
}

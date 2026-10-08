/**
 * LavalinkGatekeeper
 *
 * Centralized request gatekeeper and rate limiter for Lavalink REST requests.
 * Ensures all track resolutions across YouTube, SoundCloud, Spotify, and Autoplay
 * are strictly paced and automatically retry with exponential backoff on 429 rate limits.
 */

export class LavalinkGatekeeper {
  private static instance: LavalinkGatekeeper;
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private minIntervalMs = 200; // minimum ms between outgoing requests
  private cooldownUntil = 0; // timestamp until 429 cooldown expires

  private constructor() {}

  public static getInstance(): LavalinkGatekeeper {
    if (!LavalinkGatekeeper.instance) {
      LavalinkGatekeeper.instance = new LavalinkGatekeeper();
    }
    return LavalinkGatekeeper.instance;
  }

  /**
   * Resiliently resolve a track or query through the specified Lavalink node.
   * Paces requests, respects active 429 cooldowns, and retries automatically.
   */
  public async resolve(node: any, identifier: string, timeoutMs: number = 8000): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          attempts++;

          // 1. Wait for any active 429 cooldown to expire
          const now = Date.now();
          if (this.cooldownUntil > now) {
            const waitMs = this.cooldownUntil - now;
            await new Promise((r) => setTimeout(r, waitMs));
          }

          // 2. Enforce minimum pacing between requests
          const timeSinceLast = Date.now() - this.lastRequestTime;
          if (timeSinceLast < this.minIntervalMs) {
            await new Promise((r) => setTimeout(r, this.minIntervalMs - timeSinceLast));
          }

          this.lastRequestTime = Date.now();

          try {
            const result = await Promise.race([
              node.rest.resolve(identifier),
              new Promise<any>((_, rej) =>
                setTimeout(() => rej(new Error(`Lavalink resolve timeout after ${timeoutMs}ms`)), timeoutMs)
              ),
            ]);

            resolve(result);
            return;
          } catch (err: any) {
            const is429 =
              err?.status === 429 ||
              String(err?.message || '').includes('429') ||
              String(err?.error || '').toLowerCase().includes('too many') ||
              String(err?.message || '').toLowerCase().includes('too many');

            if (is429 && attempts < maxAttempts) {
              // Enforce 2.5s cooldown for 429 burst reset
              this.cooldownUntil = Date.now() + 2500;
              continue;
            }

            // If not 429 or attempts exhausted, reject
            reject(err);
            return;
          }
        }
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch (_) {
          // Task rejection handled inside promise executor
        }
      }
    }

    this.processing = false;
  }
}

export const lavalinkGatekeeper = LavalinkGatekeeper.getInstance();

import { ClientEvents } from 'discord.js';
import { Container } from '../app/Container';
import { BotEvent } from './types';

export class EventLoader {
  private readonly events: BotEvent<any>[] = [];

  public register<K extends keyof ClientEvents>(event: BotEvent<K>): void {
    this.events.push(event as BotEvent<any>);
  }

  public bindAll(container: Container): void {
    const { client, logger } = container;

    for (const event of this.events) {
      const handler = async (...args: any[]) => {
        try {
          await event.execute(container, ...args);
        } catch (error) {
          logger.error({ event: event.name, err: error }, `Unhandled error in event ${String(event.name)}`);
        }
      };

      if (event.once) {
        client.once(event.name, handler);
      } else {
        client.on(event.name, handler);
      }

      logger.debug(`Registered event listener for '${String(event.name)}' (once: ${Boolean(event.once)})`);
    }
  }
}

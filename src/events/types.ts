import { ClientEvents } from 'discord.js';
import { Container } from '../app/Container';

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  readonly name: K;
  readonly once?: boolean;
  execute(container: Container, ...args: ClientEvents[K]): Promise<void>;
}

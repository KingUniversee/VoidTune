import { Client } from 'discord.js';
import { Logger } from 'pino';
import { EnvConfig } from '../config/env';
import { CommandRegistry } from './CommandRegistry';

export class Container {
  public client!: Client;
  public config!: EnvConfig;
  public logger!: Logger;
  public commands!: CommandRegistry;
  
  // Future services will be registered here (MusicManager, Prisma, Redis, etc.)
  private readonly services = new Map<string, unknown>();

  public registerService<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  public getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' is not registered in the Container.`);
    }
    return service as T;
  }

  public hasService(name: string): boolean {
    return this.services.has(name);
  }
}

import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '@/app/CommandRegistry';
import { Command } from '@/commands/types';

describe('CommandRegistry', () => {
  it('should register and retrieve commands by primary name and alias', () => {
    const registry = new CommandRegistry();

    const mockCmd: Command = {
      name: 'test',
      description: 'Test command',
      category: 'utility',
      aliases: ['t', 'testing'],
      async execute() {},
    };

    registry.register(mockCmd);

    expect(registry.get('test')).toBe(mockCmd);
    expect(registry.get('t')).toBe(mockCmd);
    expect(registry.get('testing')).toBe(mockCmd);
    expect(registry.get('TEST')).toBe(mockCmd); // case insensitive
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should disallow duplicate command names', () => {
    const registry = new CommandRegistry();

    const cmd1: Command = {
      name: 'play',
      description: 'Play command',
      category: 'music',
      async execute() {},
    };

    registry.register(cmd1);

    expect(() => registry.register(cmd1)).toThrowError(/already registered/);
  });

  it('should disallow duplicate aliases', () => {
    const registry = new CommandRegistry();

    const cmd1: Command = {
      name: 'play',
      description: 'Play command',
      category: 'music',
      aliases: ['p'],
      async execute() {},
    };

    const cmd2: Command = {
      name: 'pause',
      description: 'Pause command',
      category: 'music',
      aliases: ['p'], // conflict
      async execute() {},
    };

    registry.register(cmd1);
    expect(() => registry.register(cmd2)).toThrowError(/conflicts with an existing/);
  });

  it('should generate slash command schemas for all registered commands', () => {
    const registry = new CommandRegistry();

    const cmd: Command = {
      name: 'ping',
      description: 'Ping latency',
      category: 'utility',
      slashData: {
        name: 'ping',
        description: 'Ping latency',
      },
      async execute() {},
    };

    registry.register(cmd);
    const slash = registry.getSlashCommands();

    expect(slash).toHaveLength(1);
    expect(slash[0]?.name).toBe('ping');
    expect(slash[0]?.description).toBe('Ping latency');
  });
});

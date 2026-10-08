import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { createPingV2 } from '../../utils/theme';

export const pingCommand: Command = {
  name: 'ping',
  description: 'Check VoidTune response latency and operational status',
  category: 'utility',
  aliases: ['latency', 'status'],
  slashData: {
    name: 'ping',
    description: 'Check VoidTune response latency and operational status',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    const startTime = Date.now();
    await ctx.deferReply();

    const roundtripMs = Date.now() - startTime;
    const wsPing = container.client.ws.ping;
    const memoryUsedMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptime = `${hours}h ${minutes}m ${seconds}s`;

    const v2Card = createPingV2({
      wsPing,
      roundtripMs,
      memoryUsedMb,
      uptime,
      audioNode: 'Main-Node (Lavalink v4)',
    });

    await ctx.reply(v2Card);
  },
};


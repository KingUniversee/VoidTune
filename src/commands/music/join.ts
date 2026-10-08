import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const joinCommand: Command = {
  name: 'join',
  description: 'Connects VoidTune to your current voice channel',
  category: 'music',
  aliases: ['connect', 'j'],
  permissions: {
    voiceChannelOnly: true,
  },
  slashData: {
    name: 'join',
    description: 'Connects VoidTune to your current voice channel',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const voiceChannel = ctx.voiceChannel!;
    await musicService.join(ctx.guildId, voiceChannel.id, ctx.channel?.id || '');

    const v2Card = createActionV2(
      `${VTEmojis.twentyfour_seven} Connected to Voice`,
      `Successfully joined **${voiceChannel.name}**!\nReady to stream high-definition music. Use \`/play <song>\` to start.`,
      Theme.Colors.success
    );

    await ctx.reply(v2Card);
  },
};


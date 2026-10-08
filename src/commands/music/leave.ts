import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const leaveCommand: Command = {
  name: 'leave',
  description: 'Disconnects VoidTune from the voice channel and clears the queue',
  category: 'music',
  aliases: ['disconnect', 'dc'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'leave',
    description: 'Disconnects VoidTune from the voice channel and clears the queue',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    await musicService.leave(ctx.guildId);

    const v2Card = createActionV2(
      `${VTEmojis.stop} Disconnected`,
      'Left the voice channel and cleaned up the active session.\nSee you next time!',
      Theme.Colors.neutral
    );

    await ctx.reply(v2Card);
  },
};


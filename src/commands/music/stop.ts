import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createStoppedV2 } from '../../utils/theme';

export const stopCommand: Command = {
  name: 'stop',
  description: 'Stops music playback and clears the entire queue',
  category: 'music',
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'stop',
    description: 'Stops music playback and clears the entire queue',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const stoppedTrack = await musicService.stop(ctx.guildId);

    const v2Card = createStoppedV2(stoppedTrack, ctx.user);
    await ctx.reply(v2Card);
  },
};


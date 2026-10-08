import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const resumeCommand: Command = {
  name: 'resume',
  description: 'Resumes paused playback',
  category: 'music',
  aliases: ['unpause'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'resume',
    description: 'Resumes paused playback',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    await musicService.resume(ctx.guildId);

    const v2Card = createActionV2(
      `${VTEmojis.play} Playback Resumed`,
      'Music playback is back on! Enjoy your lossless stream.',
      Theme.Colors.playing
    );

    await ctx.reply(v2Card);
  },
};


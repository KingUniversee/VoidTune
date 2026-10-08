import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const pauseCommand: Command = {
  name: 'pause',
  description: 'Pauses the currently playing track',
  category: 'music',
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'pause',
    description: 'Pauses the currently playing track',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    await musicService.pause(ctx.guildId);

    const v2Card = createActionV2(
      `${VTEmojis.pause} Playback Paused`,
      'Playback has been paused.\nUse `/resume` or click **Resume** on the player to continue listening.',
      Theme.Colors.paused
    );

    await ctx.reply(v2Card);
  },
};


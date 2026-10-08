import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const twentyFourSevenCommand: Command = {
  name: '247',
  description: 'Toggles 24/7 mode to keep VoidTune in the voice channel indefinitely',
  category: 'music',
  aliases: ['stay', 'alwayson'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: '247',
    description: 'Toggles 24/7 mode to keep VoidTune in voice channel indefinitely',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');
    const player = musicService.getPlayer(ctx.guildId);

    if (!player) {
      const v2Card = createActionV2(
        `${VTEmojis.settings} 24/7 Mode`,
        'VoidTune is not currently active in a voice channel. Use `/join` or `/play` first!',
        Theme.Colors.error
      );
      await ctx.reply(v2Card);
      return;
    }

    const newState = !player.is247;
    player.set247(newState);

    const v2Card = createActionV2(
      `${VTEmojis.twentyfour_seven} 24/7 Mode ${newState ? 'Enabled' : 'Disabled'}`,
      newState
        ? 'VoidTune will now stay in this voice channel **24/7** without disconnecting when playback stops or the channel is empty.'
        : 'VoidTune will now automatically disconnect after **5 minutes of inactivity**.',
      newState ? Theme.Colors.success : Theme.Colors.paused
    );

    await ctx.reply(v2Card);
  },
};

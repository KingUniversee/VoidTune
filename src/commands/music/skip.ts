import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis, cleanTrackTitle } from '../../utils/theme';

export const skipCommand: Command = {
  name: 'skip',
  description: 'Skips the currently playing track',
  category: 'music',
  aliases: ['s', 'next'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'skip',
    description: 'Skips the currently playing track',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const skippedTrack = await musicService.skip(ctx.guildId);

    const v2Card = createActionV2(
      `${VTEmojis.skip} Track Skipped`,
      skippedTrack
        ? `Skipped **[${cleanTrackTitle(skippedTrack.title, 32)}](${skippedTrack.uri})**`
        : 'Skipped current track.',
      Theme.Colors.primary
    );

    await ctx.reply(v2Card);
  },
};


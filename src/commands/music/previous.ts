import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis, cleanTrackTitle } from '../../utils/theme';

export const previousCommand: Command = {
  name: 'previous',
  description: 'Plays the previous track from history',
  category: 'music',
  aliases: ['prev', 'back'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'previous',
    description: 'Plays the previous track from history',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const prevTrack = await musicService.previous(ctx.guildId);

    const v2Card = createActionV2(
      `${VTEmojis.previous} Previous Track`,
      prevTrack
        ? `Now playing previous track: **[${cleanTrackTitle(prevTrack.title, 32)}](${prevTrack.uri})**`
        : 'No previous track in history. Restarted current track from beginning.',
      Theme.Colors.primary
    );

    await ctx.reply(v2Card);
  },
};

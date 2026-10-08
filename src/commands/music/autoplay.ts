import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const autoplayCommand: Command = {
  name: 'autoplay',
  description: 'Toggles Spotify-style smart autoplay when the queue ends',
  category: 'music',
  aliases: ['ap', 'auto'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'autoplay',
    description: 'Toggles Spotify-style smart autoplay when the queue ends',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');
    const player = musicService.getPlayer(ctx.guildId);

    if (!player) {
      const v2Card = createActionV2(
        `${VTEmojis.settings} Autoplay`,
        'VoidTune is not currently active in a voice channel. Use `/play` first!',
        Theme.Colors.error
      );
      await ctx.reply(v2Card);
      return;
    }

    const newState = !player.autoplay;
    player.autoplay = newState;

    const v2Card = createActionV2(
      `${VTEmojis.autoplay} Autoplay ${newState ? 'Enabled' : 'Disabled'}`,
      newState
        ? 'VoidTune will now **automatically recommend and play related songs** whenever the queue ends!'
        : 'Autoplay has been **disabled**. Playback will stop when the queue finishes.',
      newState ? Theme.Colors.success : Theme.Colors.paused
    );

    await ctx.reply(v2Card);
  },
};

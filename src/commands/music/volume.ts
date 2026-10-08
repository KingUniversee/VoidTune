import { ApplicationCommandOptionType } from 'discord.js';
import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const volumeCommand: Command = {
  name: 'volume',
  description: 'Checks or changes playback volume (0-100)',
  category: 'music',
  aliases: ['vol', 'v'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'volume',
    description: 'Checks or changes playback volume (0-100)',
    options: [
      {
        name: 'level',
        description: 'Volume level between 0 and 100',
        type: ApplicationCommandOptionType.Integer,
        required: false,
        minValue: 0,
        maxValue: 100,
      },
    ],
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');
    const player = musicService.getPlayer(ctx.guildId);

    const level = ctx.getInteger('level', 0);

    const volBar = (pct: number) => {
      const filled = Math.round(pct / 10);
      return '━'.repeat(filled) + '🔘' + '━'.repeat(Math.max(0, 10 - filled));
    };

    if (level === null) {
      const currentVol = player ? player.volume : 100;
      const v2Card = createActionV2(
        `${VTEmojis.volume} Playback Volume`,
        `Current volume: **${currentVol}%**\n\`${volBar(currentVol)}\`\n\n*Use \`/volume <0-100>\` to adjust.*`,
        Theme.Colors.primary
      );

      await ctx.reply(v2Card);
      return;
    }

    const updatedVol = await musicService.setVolume(ctx.guildId, level);
    const v2Card = createActionV2(
      `${VTEmojis.volume} Volume Changed`,
      `Output volume set to **${updatedVol}%**\n\`${volBar(updatedVol)}\``,
      Theme.Colors.success
    );

    await ctx.reply(v2Card);
  },
};


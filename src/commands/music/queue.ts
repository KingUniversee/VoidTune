import { ApplicationCommandOptionType } from 'discord.js';
import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { createQueueV2, createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const queueCommand: Command = {
  name: 'queue',
  description: 'Displays the list of upcoming tracks in the music queue',
  category: 'music',
  aliases: ['q'],
  slashData: {
    name: 'queue',
    description: 'Displays the list of upcoming tracks in the music queue',
    options: [
      {
        name: 'page',
        description: 'Queue page number to view',
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const pageArg = ctx.getInteger('page', 0) || 1;
    const paginated = musicService.getQueue(ctx.guildId, pageArg, 10);
    const player = musicService.getPlayer(ctx.guildId);

    if (!paginated || (paginated.totalTracks === 0 && !player?.currentTrack)) {
      const response = createActionV2(
        `${VTEmojis.queue} Queue is Empty`,
        'No tracks are currently waiting in the queue.\nUse `/play <song>` to queue your favorite music!',
        Theme.Colors.info
      );
      await ctx.reply(response);
      return;
    }

    const currentTrack = player?.currentTrack || null;
    const voiceChannel = ctx.guild?.channels.cache.get(player?.voiceChannelId || '');
    const voiceName = voiceChannel ? voiceChannel.name : 'Voice Channel';
    const repeatMode = player?.queue.repeatMode || 'off';

    const response = createQueueV2(paginated, currentTrack, voiceName, repeatMode);
    await ctx.reply(response);
  },
};

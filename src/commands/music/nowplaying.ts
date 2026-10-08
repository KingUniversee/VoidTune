import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import {
  createNowPlayingV2,
  createActionV2,
  Theme,
  VTEmojis,
} from '../../utils/theme';

export const nowplayingCommand: Command = {
  name: 'nowplaying',
  description: 'Displays detailed Spotify-style information for the currently playing track',
  category: 'music',
  aliases: ['np', 'current'],
  slashData: {
    name: 'nowplaying',
    description: 'Displays detailed Spotify-style information for the currently playing track',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');

    const status = musicService.getNowPlaying(ctx.guildId);
    const player = musicService.getPlayer(ctx.guildId);

    if (!status || !status.currentTrack || !player) {
      const response = createActionV2(
        `${VTEmojis.music} Nothing Playing`,
        'There is no active music session currently playing in this server.\nUse `/play <song>` to start streaming!',
        Theme.Colors.info
      );
      await ctx.reply(response);
      return;
    }

    const track = status.currentTrack;
    const voiceChannel = ctx.guild?.channels.cache.get(player.voiceChannelId);
    const voiceName = voiceChannel ? voiceChannel.name : 'Voice Channel';

    const response = createNowPlayingV2(track, status, voiceName, ctx.user, player.is247);
    await ctx.reply(response);
  },
};

import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { VoidTuneError } from '../../utils/errors';
import {
  createTrackAddedV2,
  createPlaylistAddedV2,
  disableContainerButtons,
} from '../../utils/theme';

export const playCommand: Command = {
  name: 'play',
  description: 'Plays a track, playlist, or searches Spotify/YouTube/SoundCloud',
  category: 'music',
  aliases: ['p'],
  permissions: {
    voiceChannelOnly: true,
  },
  slashData: {
    name: 'play',
    description: 'Plays a track, playlist, or searches Spotify/YouTube/SoundCloud',
    options: [
      {
        name: 'query',
        description: 'Song name, Spotify/YouTube URL, or playlist link',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    const query = ctx.getString('query', 0);
    if (!query) {
      throw new VoidTuneError({
        code: 'INVALID_QUERY',
        message: 'No query provided to play command',
        userMessage: 'Please provide a song name or URL to play! (e.g. `/play Bohemian Rhapsody`)',
      });
    }

    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');
    const voiceChannel = ctx.voiceChannel!;

    const result = await musicService.play({
      guildId: ctx.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: ctx.channel?.id || '',
      query,
      requesterId: ctx.userId,
    });

    const showButtons = !result.startedImmediately;

    if (result.type === 'playlist') {
      const response = createPlaylistAddedV2(
        result.playlistName || 'Custom Playlist',
        result.tracks,
        result.enqueuedPosition,
        ctx.user,
        showButtons,
        false
      );
      const replyMsg = await ctx.reply(response);
      if (showButtons && replyMsg) {
        setTimeout(async () => {
          try {
            // Only disable if the message is still a queue card and hasn't been transformed into Now Playing
            const isStillQueueCard = replyMsg.components?.some((c: any) =>
              JSON.stringify(c).includes('btn_queue_')
            );
            if (!isStillQueueCard) return;

            if (replyMsg.components && replyMsg.components.length > 0) {
              await replyMsg.edit({
                components: disableContainerButtons(replyMsg.components),
                flags: MessageFlags.IsComponentsV2,
              });
            } else {
              const disabledCard = createPlaylistAddedV2(
                result.playlistName || 'Custom Playlist',
                result.tracks,
                result.enqueuedPosition,
                ctx.user,
                true,
                true
              );
              await replyMsg.edit({
                components: disabledCard.components,
                flags: MessageFlags.IsComponentsV2,
              });
            }
          } catch {
            // Ignored if already edited, deleted, or dismissed
          }
        }, 15000);
      }
    } else {
      const track = result.tracks[0];
      if (!track) return;
      const response = createTrackAddedV2(
        track,
        result.enqueuedPosition,
        ctx.user,
        showButtons,
        false
      );
      const replyMsg = await ctx.reply(response);
      if (showButtons && replyMsg) {
        setTimeout(async () => {
          try {
            // Only disable if the message is still a queue card and hasn't been transformed into Now Playing
            const isStillQueueCard = replyMsg.components?.some((c: any) =>
              JSON.stringify(c).includes('btn_queue_')
            );
            if (!isStillQueueCard) return;

            if (replyMsg.components && replyMsg.components.length > 0) {
              await replyMsg.edit({
                components: disableContainerButtons(replyMsg.components),
                flags: MessageFlags.IsComponentsV2,
              });
            } else {
              const disabledCard = createTrackAddedV2(
                track,
                result.enqueuedPosition,
                ctx.user,
                true,
                true
              );
              await replyMsg.edit({
                components: disabledCard.components,
                flags: MessageFlags.IsComponentsV2,
              });
            }
          } catch {
            // Ignored if already edited, deleted, or dismissed
          }
        }, 15000);
      }
    }
  },
};

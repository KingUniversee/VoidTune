import { ApplicationCommandOptionType } from 'discord.js';
import { Command } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';
import { MusicManager } from '../../music/MusicManager';
import { createActionV2, Theme, VTEmojis } from '../../utils/theme';

export const channelStatusCommand: Command = {
  name: 'channelstatus',
  description: 'Sets, resets, or clears the Discord voice channel status text',
  category: 'music',
  aliases: ['vstatus', 'vcstatus', 'cstatus'],
  permissions: {
    voiceChannelOnly: true,
    sameVoiceOnly: true,
  },
  slashData: {
    name: 'channelstatus',
    description: 'Sets, resets, or clears the Discord voice channel status text',
    options: [
      {
        name: 'text',
        description: 'Status message to set (leave blank or type "clear" to clear)',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    await ctx.deferReply();
    const musicService = container.getService<MusicService>('musicService');
    const musicManager = container.getService<MusicManager>('musicManager');
    const player = musicService.getPlayer(ctx.guildId);

    if (!player) {
      const v2Card = createActionV2(
        `${VTEmojis.settings} Voice Channel Status`,
        'VoidTune is not currently active in a voice channel. Use `/join` or `/play` first!',
        Theme.Colors.error
      );
      await ctx.reply(v2Card);
      return;
    }

    const text = ctx.getString('text')?.trim();

    if (!text || text.toLowerCase() === 'clear') {
      if (!text && player.currentTrack) {
        // Reset to track status
        await musicManager.setVoiceChannelStatus(player.voiceChannelId, player.currentTrack);
        const card = createActionV2(
          `${VTEmojis.settings} Channel Status Reset`,
          `Voice channel status restored to active track info.`,
          Theme.Colors.success
        );
        await ctx.reply(card);
      } else {
        // Clear status completely
        await musicManager.setVoiceChannelStatus(player.voiceChannelId, null);
        const card = createActionV2(
          `${VTEmojis.settings} Channel Status Cleared`,
          `Voice channel status has been cleared.`,
          Theme.Colors.neutral
        );
        await ctx.reply(card);
      }
      return;
    }

    // Set custom voice channel status
    try {
      await fetch(`https://discord.com/api/v10/channels/${player.voiceChannelId}/voice-status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${container.client.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: text.slice(0, 500) }),
      });

      const card = createActionV2(
        `${VTEmojis.settings} Channel Status Updated`,
        `Voice channel status has been updated to:\n> **${text.slice(0, 500)}**`,
        Theme.Colors.success
      );
      await ctx.reply(card);
    } catch (err) {
      const card = createActionV2(
        `${VTEmojis.settings} Update Failed`,
        `Could not update voice channel status: ${err instanceof Error ? err.message : String(err)}`,
        Theme.Colors.error
      );
      await ctx.reply(card);
    }
  },
};

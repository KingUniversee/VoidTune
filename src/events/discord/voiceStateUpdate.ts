import { Events } from 'discord.js';
import { BotEvent } from '../types';
import { Container } from '../../app/Container';
import { MusicService } from '../../services/MusicService';

export const voiceStateUpdateEvent: BotEvent<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  async execute(container: Container, oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const musicService = container.getService<MusicService>('musicService');
    const player = musicService.getPlayer(guild.id);

    // 1. Check if this voice update is for the BOT itself
    if (newState.id === container.client.user?.id) {
      // If the bot was disconnected from voice
      if (!newState.channelId) {
        if (player && !player.isDestroyed) {
          container.logger.info(
            { guildId: guild.id },
            'Bot was disconnected from voice channel in Discord. Cleaning up music player.'
          );
          await musicService.leave(guild.id).catch(() => {});
        }
        return;
      }

      // If the bot was moved to a different voice channel
      if (player && newState.channelId !== player.voiceChannelId) {
        container.logger.info(
          { guildId: guild.id, from: player.voiceChannelId, to: newState.channelId },
          'Bot voice channel changed'
        );
        player.voiceChannelId = newState.channelId;
        if (player.currentTrack) {
          const musicManager = (musicService as any).musicManager;
          await musicManager?.setVoiceChannelStatus(newState.channelId, player.currentTrack).catch(() => {});
        }
      }
      return;
    }

    // 2. Member voice state updates (other users joining / leaving / deafening)
    if (!player || player.isDestroyed) return;

    const botVoiceId = player.voiceChannelId;
    if (oldState.channelId !== botVoiceId && newState.channelId !== botVoiceId) return;

    // If 24/7 mode is active, the bot remains in VC indefinitely
    if (player.is247) return;

    const channel = guild.channels.cache.get(botVoiceId);
    if (!channel || !('members' in channel)) return;

    const humanMembers = (channel.members as any).filter((m: any) => !m.user.bot);

    if (humanMembers.size === 0) {
      // Voice channel is empty of humans: start 5-minute inactivity countdown
      player.startInactivityTimer('Voice channel empty');
    } else {
      // At least one human is present: if player is playing or paused, clear the timer
      if (player.isPlaying || player.isPaused) {
        player.clearInactivityTimer();
      }
    }
  },
};

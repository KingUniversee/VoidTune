import { Events, GuildMember, MessageFlags } from 'discord.js';
import { BotEvent } from '../types';
import { Container } from '../../app/Container';
import { CommandContext } from '../../commands/CommandContext';
import { MusicService } from '../../services/MusicService';
import { VTEmojis, createNowPlayingV2, cleanTrackTitle, createStoppedV2, disableContainerButtons } from '../../utils/theme';

export const interactionCreateEvent: BotEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(container: Container, interaction) {
    // 1. Handle Slash Commands
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId || !interaction.guild) {
        await interaction.reply({
          content: `${VTEmojis.settings} VoidTune commands can only be executed within a Discord server.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      // Fast ACK: Defer immediately to eliminate DiscordAPIError[10062] Unknown interaction timeouts
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply();
        }
      } catch (deferErr) {
        container.logger.warn({ deferErr, command: interaction.commandName }, 'Failed to early-defer interaction');
      }

      const ctx = new CommandContext({ interaction });
      await container.commands.execute(ctx, container, interaction.commandName);
      return;
    }

    // 2. Handle Self-Role Toggle Buttons
    if (interaction.isButton() && interaction.customId.startsWith('role_toggle_')) {
      if (!interaction.guildId || !interaction.guild || !interaction.member) return;
      const member = interaction.member as GuildMember;

      const roleMapping: Record<string, { id: string; name: string; emoji: string }> = {
        role_toggle_announcements: { id: '1550550086776258733', name: 'Starlight Notices', emoji: '📢' },
        role_toggle_giveaways: { id: '1550550089695629312', name: 'Nebula Drops', emoji: '🎉' },
        role_toggle_events: { id: '1550550091537055928', name: 'Astral Gatherings', emoji: '✨' },
      };

      const target = roleMapping[interaction.customId];
      if (!target) return;

      const hasRole = member.roles.cache.has(target.id);
      try {
        if (hasRole) {
          await member.roles.remove(target.id);
          await interaction.reply({
            content: `${target.emoji} Removed role **${target.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await member.roles.add(target.id);
          await interaction.reply({
            content: `${target.emoji} Assigned role **${target.name}**! You will now receive notifications.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (err: any) {
        await interaction.reply({
          content: `${VTEmojis.settings} Could not update role: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // 3. Handle Interactive Media Player & Queue Buttons
    if (interaction.isButton() && (interaction.customId.startsWith('btn_player_') || interaction.customId.startsWith('btn_queue_'))) {
      if (!interaction.guildId || !interaction.guild) return;

      container.logger.info(
        { customId: interaction.customId, userId: interaction.user.id, guildId: interaction.guildId },
        'Button interaction received'
      );

      const [action, authorizedUserId] = interaction.customId.split(':');

      // OwO-style silent rejection: If any unauthorized user clicks a queue button (Track / Playlist Added),
      // acknowledge silently via deferUpdate() so Discord registers a normal click without any error or message.
      if (interaction.customId.startsWith('btn_queue_')) {
        if (authorizedUserId && interaction.user.id !== authorizedUserId) {
          await interaction.deferUpdate().catch(() => {});
          return;
        }
      }

      const member = interaction.member as GuildMember | null;
      const memberVoiceChannel = member?.voice?.channel;
      const musicService = container.getService<MusicService>('musicService');
      const player = musicService.getPlayer(interaction.guildId);

      if (!player) {
        await interaction.reply({
          content: `${VTEmojis.music} No active music session in this server.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!memberVoiceChannel || memberVoiceChannel.id !== player.voiceChannelId) {
        await interaction.reply({
          content: `${VTEmojis.settings} You must be in the same voice channel as VoidTune to use player controls.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const getUpdatedNowPlaying = () => {
        if (!player.currentTrack) return null;
        const voiceChannel = interaction.guild?.channels.cache.get(player.voiceChannelId);
        const voiceName = voiceChannel && 'name' in voiceChannel ? (voiceChannel as any).name : 'Voice Channel';
        let requesterUser = interaction.user;
        const reqId = player.currentTrack.requesterId;
        if (reqId) {
          requesterUser = interaction.client.users.cache.get(reqId) || interaction.user;
        }
        return createNowPlayingV2(player.currentTrack, player.getStatus(), voiceName, requesterUser, player.is247);
      };

      try {
        switch (action) {
          case 'btn_player_prev': {
            await interaction.deferUpdate().catch(() => {});
            await musicService.previous(interaction.guildId);
            const updated = getUpdatedNowPlaying();
            if (updated && interaction.message) {
              await interaction.message.edit({
                components: updated.components,
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_player_pause_resume': {
            await interaction.deferUpdate().catch(() => {});
            if (player.isPaused) {
              await musicService.resume(interaction.guildId);
            } else {
              await musicService.pause(interaction.guildId);
            }
            const updated = getUpdatedNowPlaying();
            if (updated && interaction.message) {
              await interaction.message.edit({
                components: updated.components,
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_player_skip': {
            await interaction.deferUpdate().catch(() => {});
            const skipped = await musicService.skip(interaction.guildId);
            if (!player.isPlaying && !player.isPaused) {
              if (interaction.channel && 'send' in interaction.channel) {
                const stoppedCard = createStoppedV2(skipped, interaction.user);
                await (interaction.channel as any).send(stoppedCard).catch(() => {});
              }
            }
            break;
          }

          case 'btn_player_stop': {
            await interaction.deferUpdate().catch(() => {});
            const stoppedTrack = await musicService.stop(interaction.guildId);
            if (interaction.channel && 'send' in interaction.channel) {
              const stoppedCard = createStoppedV2(stoppedTrack, interaction.user);
              await (interaction.channel as any).send(stoppedCard).catch(() => {});
            }
            break;
          }

          case 'btn_player_loop': {
            await interaction.deferUpdate().catch(() => {});
            const current = player.queue.repeatMode;
            const nextMode = current === 'off' ? 'track' : current === 'track' ? 'queue' : 'off';
            player.queue.setRepeatMode(nextMode);
            const updated = getUpdatedNowPlaying();
            if (updated && interaction.message) {
              await interaction.message.edit({
                components: updated.components,
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_player_autoplay': {
            await interaction.deferUpdate().catch(() => {});
            player.autoplay = !player.autoplay;
            const updated = getUpdatedNowPlaying();
            if (updated && interaction.message) {
              await interaction.message.edit({
                components: updated.components,
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_player_247': {
            await interaction.deferUpdate().catch(() => {});
            player.set247(!player.is247);
            const updated = getUpdatedNowPlaying();
            if (updated && interaction.message) {
              await interaction.message.edit({
                components: updated.components,
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_queue_play_now': {
            // Acknowledge the button click immediately so Discord knows it's being handled
            await interaction.deferUpdate().catch(() => {});
            try {
              if (player.queue.size > 1) {
                player.queue.move(player.queue.size - 1, 0);
              }

              if (!player.isPlaying && !player.isPaused) {
                await player.play();
              } else {
                await musicService.skip(interaction.guildId);
              }

              // Delete previous Now Playing UI card if one exists and is different from this message
              if (player.lastNowPlayingMessage && player.lastNowPlayingMessage.id !== interaction.message?.id) {
                await player.lastNowPlayingMessage.delete().catch(() => {});
                player.lastNowPlayingMessage = null;
              }

              // Transform the Track Added message directly into the Now Playing UI card!
              const current = player.currentTrack;
              if (current && interaction.guild && interaction.message) {
                const voiceChannel = interaction.guild.channels.cache.get(player.voiceChannelId);
                const voiceName = voiceChannel && 'name' in voiceChannel ? (voiceChannel as any).name : 'Voice Channel';
                let requesterUser = interaction.user;
                const reqId = current.requesterId;
                if (reqId) {
                  requesterUser = interaction.client.users.cache.get(reqId) || interaction.user;
                }
                const npCard = createNowPlayingV2(current, player.getStatus(), voiceName, requesterUser, player.is247);
                const edited = await interaction.message.edit({
                  components: npCard.components,
                  flags: MessageFlags.IsComponentsV2,
                }).catch((err) => {
                  container.logger.error({ err }, 'Failed to edit interaction message into Now Playing card');
                  return null;
                });

                if (edited) {
                  player.lastNowPlayingMessage = edited;
                  player.lastAnnouncedTrackId = current.id;
                  container.logger.info({ track: current.title, messageId: edited.id }, 'Transformed Track Added card into Now Playing card');
                }
              }
            } catch (err: any) {
              container.logger.error({ err }, 'Error handling btn_queue_play_now');
            }
            break;
          }

          case 'btn_queue_upcoming': {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            if (interaction.message && interaction.message.components?.length > 0) {
              interaction.message.edit({
                components: disableContainerButtons(interaction.message.components),
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            try {
              if (player.queue.size === 0) {
                await interaction.editReply({
                  content: `${VTEmojis.queue} Queue mein abhi koi doosra track nahi hai.`,
                });
                break;
              }

              const targetIndex = player.queue.size - 1;
              const targetTrack = player.queue.tracks[targetIndex];
              if (!targetTrack) {
                await interaction.editReply({
                  content: `${VTEmojis.queue} Track queue mein nahi mila.`,
                });
                break;
              }

              if (targetIndex === 0) {
                await interaction.editReply({
                  content: `${VTEmojis.skip} **${cleanTrackTitle(targetTrack.title, 32)}** already next track set hai!`,
                });
              } else {
                const moved = player.queue.move(targetIndex, 0);
                await interaction.editReply({
                  content: moved
                    ? `${VTEmojis.skip} **[${cleanTrackTitle(targetTrack.title, 32)}]** ko up next set kar diya! Current gaane ke baad direct yeh baje ga.`
                    : `${VTEmojis.settings} Track move nahi ho paya.`,
                });
              }
            } catch (err: any) {
              await interaction.editReply({
                content: `${VTEmojis.settings} Could not update queue: ${err?.message || 'Unknown error'}`,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_queue_remove': {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            if (interaction.message && interaction.message.components?.length > 0) {
              interaction.message.edit({
                components: disableContainerButtons(interaction.message.components),
                flags: MessageFlags.IsComponentsV2,
              }).catch(() => {});
            }
            try {
              if (player.queue.size > 0) {
                const removed = player.queue.remove(player.queue.size - 1);
                await interaction.editReply({
                  content: removed
                    ? `${VTEmojis.trash} Removed **${cleanTrackTitle(removed.title, 32)}** from queue.`
                    : `${VTEmojis.trash} Removed track from queue.`,
                });
              } else {
                await interaction.editReply({
                  content: `${VTEmojis.queue} Queue is already empty.`,
                });
              }
            } catch (err: any) {
              await interaction.editReply({
                content: `${VTEmojis.settings} Could not remove track: ${err?.message || 'Unknown error'}`,
              }).catch(() => {});
            }
            break;
          }

          case 'btn_player_vol_down': {
            const newVol = Math.max(0, player.volume - 10);
            await musicService.setVolume(interaction.guildId, newVol);
            await interaction.reply({
              content: `${VTEmojis.volume} Volume set to **${newVol}%**`,
              flags: MessageFlags.Ephemeral,
            });
            break;
          }

          case 'btn_player_vol_up': {
            const newVol = Math.min(100, player.volume + 10);
            await musicService.setVolume(interaction.guildId, newVol);
            await interaction.reply({
              content: `${VTEmojis.volume} Volume set to **${newVol}%**`,
              flags: MessageFlags.Ephemeral,
            });
            break;
          }

          default:
            break;
        }
      } catch (err) {
        container.logger.warn({ err, customId: interaction.customId }, 'Error handling player button interaction');
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content: `${VTEmojis.settings} Failed to process player button command.`,
          }).catch(() => {});
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `${VTEmojis.settings} Failed to process player button command.`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
    }
  },
};

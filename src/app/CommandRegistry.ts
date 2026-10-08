import {
  ChatInputApplicationCommandData,
  REST,
  Routes,
} from 'discord.js';
import { Command } from '../commands/types';
import { CommandContext } from '../commands/CommandContext';
import { Container } from './Container';
import { VoidTuneError, PermissionError, VoiceError } from '../utils/errors';
import { createActionV2, Theme, VTEmojis } from '../utils/theme';

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly aliases = new Map<string, string>();

  public register(command: Command): void {
    const name = command.name.toLowerCase();
    if (this.commands.has(name)) {
      throw new Error(`Command '${name}' is already registered.`);
    }
    this.commands.set(name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        const lowerAlias = alias.toLowerCase();
        if (this.aliases.has(lowerAlias) || this.commands.has(lowerAlias)) {
          throw new Error(`Alias '${lowerAlias}' conflicts with an existing command or alias.`);
        }
        this.aliases.set(lowerAlias, name);
      }
    }
  }

  public get(nameOrAlias: string): Command | undefined {
    const lower = nameOrAlias.toLowerCase();
    const resolvedName = this.aliases.get(lower) || lower;
    return this.commands.get(resolvedName);
  }

  public getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  public getSlashCommands(): ChatInputApplicationCommandData[] {
    return this.getSlashCommandsData();
  }

  public getSlashCommandsData(): ChatInputApplicationCommandData[] {
    return this.getAll()
      .filter((cmd) => cmd.slashData !== undefined)
      .map((cmd) => cmd.slashData as ChatInputApplicationCommandData);
  }

  public async deploySlashCommands(token: string, clientId: string, guildId?: string): Promise<void> {
    await this.registerSlashCommands(token, clientId, guildId);
  }

  public async registerSlashCommands(
    token: string,
    applicationId: string,
    guildId?: string
  ): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(token);
    const slashCommands = this.getSlashCommandsData();

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
        body: slashCommands,
      });
    } else {
      await rest.put(Routes.applicationCommands(applicationId), {
        body: slashCommands,
      });
    }
  }

  public async execute(
    ctx: CommandContext,
    container: Container,
    commandName: string
  ): Promise<void> {
    const command = this.get(commandName);
    if (!command) {
      return;
    }

    const log = container.logger.child({
      module: 'CommandRegistry',
      guildId: ctx.guildId,
      userId: ctx.userId,
      command: command.name,
      isInteraction: ctx.isInteraction,
    });

    try {
      // 1. Check Voice Permissions if required
      if (command.permissions?.voiceChannelOnly) {
        if (!ctx.voiceChannel) {
          throw new VoiceError('USER_NOT_IN_VOICE', 'User is not in a voice channel', 'You need to be in a voice channel to use this command!');
        }
      }

      if (command.permissions?.sameVoiceOnly) {
        const botChannel = ctx.botVoiceChannel;
        if (botChannel && ctx.voiceChannel?.id !== botChannel.id) {
          throw new VoiceError('BOT_NOT_IN_SAME_VOICE', 'User is not in the same voice channel', 'You must be in the same voice channel as the bot to use this command!');
        }
      }

      // 2. Check User Discord Permissions
      if (command.permissions?.userPermissions && ctx.member) {
        for (const perm of command.permissions.userPermissions) {
          if (!ctx.member.permissions.has(perm)) {
            throw new PermissionError(
              `User missing required permission: ${String(perm)}`,
              `You do not have permission to use this command.`
            );
          }
        }
      }

      // 3. Check Bot Discord Permissions in Guild/Channel
      if (command.permissions?.botPermissions && ctx.guild?.members.me) {
        const botMember = ctx.guild.members.me;
        for (const perm of command.permissions.botPermissions) {
          if (!botMember.permissions.has(perm)) {
            throw new PermissionError(
              `Bot missing permission: ${String(perm)}`,
              `VoidTune is missing required permissions to execute this command (needs: ${String(perm)}).`
            );
          }
        }
      }

      log.info(`Executing command`);
      await command.execute(ctx, container);
    } catch (err: unknown) {
      if (err instanceof VoidTuneError) {
        log.warn({ code: err.code, details: err.details }, `Command warning: ${err.message}`);
        await ctx.reply(
          createActionV2(`${VTEmojis.settings} Notice`, err.userMessage, Theme.Colors.paused)
        ).catch(() => {});
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error({ err: error }, `Unhandled error executing command: ${command.name}`);
        await ctx.reply(
          createActionV2(
            `${VTEmojis.settings} Internal Error`,
            'An unexpected error occurred while executing this command. Please try again later.',
            Theme.Colors.error
          )
        ).catch(() => {});
      }
    }
  }
}

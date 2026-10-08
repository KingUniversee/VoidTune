import {
  ChatInputApplicationCommandData,
  PermissionResolvable,
} from 'discord.js';
import { CommandContext } from './CommandContext';
import { Container } from '../app/Container';

export type CommandCategory = 'music' | 'playlist' | 'settings' | 'admin' | 'utility';

export interface CommandPermissions {
  /** Discord permissions required by the user (e.g. Administrator, ManageGuild) */
  userPermissions?: PermissionResolvable[];
  /** Discord permissions required by the bot (e.g. Connect, Speak, SendMessages) */
  botPermissions?: PermissionResolvable[];
  /** Whether the user must be in a voice channel */
  voiceChannelOnly?: boolean;
  /** Whether the user must be in the same voice channel as the bot */
  sameVoiceOnly?: boolean;
  /** Whether the user must have DJ role or be an admin/mod */
  djRoleOnly?: boolean;
  /** Rate limit window in seconds (optional) */
  cooldownSeconds?: number;
}

export interface Command {
  /** Name of the command (lowercase, no spaces) */
  readonly name: string;
  /** Description shown in help and slash command registry */
  readonly description: string;
  /** Category grouping */
  readonly category: CommandCategory;
  /** Alternative names for prefix invocation */
  readonly aliases?: string[];
  /** Permission and voice checks */
  readonly permissions?: CommandPermissions;
  /** Slash command definition payload for Discord REST API */
  readonly slashData?: ChatInputApplicationCommandData;
  /** Execution handler receiving unified context and DI container */
  execute(ctx: CommandContext, container: Container): Promise<void>;
}

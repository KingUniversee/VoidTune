import {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  Message,
  MessageCreateOptions,
  MessagePayload,
  NewsChannel,
  StageChannel,
  TextBasedChannel,
  TextChannel,
  ThreadChannel,
  User,
  VoiceBasedChannel,
  VoiceChannel,
  MessageFlags,
  MessageFlagsBitField,
} from 'discord.js';

export type SendableChannel = TextChannel | NewsChannel | ThreadChannel | VoiceChannel | StageChannel;

export type ContextReplyOptions =
  | string
  | MessagePayload
  | InteractionReplyOptions
  | MessageCreateOptions
  | {
      content?: string;
      embeds?: unknown[];
      components?: unknown[];
      ephemeral?: boolean;
      flags?: any;
    };


export class CommandContext {

  public readonly isInteraction: boolean;
  public readonly interaction?: ChatInputCommandInteraction;
  public readonly message?: Message;
  public readonly args: string[];
  public deferred = false;
  public replied = false;

  constructor(options: {
    interaction?: ChatInputCommandInteraction;
    message?: Message;
    args?: string[];
  }) {
    if (options.interaction) {
      this.isInteraction = true;
      this.interaction = options.interaction;
      this.args = [];
      this.deferred = options.interaction.deferred;
      this.replied = options.interaction.replied;
    } else if (options.message) {
      this.isInteraction = false;
      this.message = options.message;
      this.args = options.args || [];
    } else {
      throw new Error('CommandContext requires either an interaction or a message.');
    }
  }

  get guild(): Guild | null {
    return this.interaction?.guild ?? this.message?.guild ?? null;
  }

  get guildId(): string {
    const id = this.guild?.id;
    if (!id) {
      throw new Error('Command invoked outside of a guild.');
    }
    return id;
  }

  get channel(): TextBasedChannel | null {
    return (this.interaction?.channel ?? this.message?.channel ?? null) as TextBasedChannel | null;
  }

  get user(): User {
    return this.interaction?.user ?? this.message!.author;
  }

  get userId(): string {
    return this.user.id;
  }

  get member(): GuildMember | null {
    if (this.interaction?.member instanceof GuildMember) {
      return this.interaction.member;
    }
    if (this.message?.member instanceof GuildMember) {
      return this.message.member;
    }
    return null;
  }

  get voiceChannel(): VoiceBasedChannel | null {
    return this.member?.voice?.channel ?? null;
  }

  get botVoiceChannel(): VoiceBasedChannel | null {
    return this.guild?.members.me?.voice?.channel ?? null;
  }

  public async deferReply(ephemeral = false): Promise<void> {
    if (this.isInteraction && this.interaction) {
      if (this.interaction.deferred || this.interaction.replied) {
        this.deferred = true;
        return;
      }
      const flags = new MessageFlagsBitField();
      flags.add(MessageFlags.IsComponentsV2);
      if (ephemeral) {
        flags.add(MessageFlags.Ephemeral);
      }
      await this.interaction.deferReply({ flags: flags.bitfield }).catch(() => {});
      this.deferred = true;
    } else if (this.channel && 'sendTyping' in this.channel) {
      await this.channel.sendTyping().catch(() => {});
      this.deferred = true;
    }
  }

  public async reply(options: ContextReplyOptions): Promise<Message | null> {
    if (this.isInteraction && this.interaction) {
      if (this.interaction.deferred || this.interaction.replied) {
        const editPayload = typeof options === 'string' ? { content: options } : options;
        const response = await this.interaction.editReply(editPayload as string | MessagePayload | InteractionEditReplyOptions);
        this.replied = true;
        return response instanceof Message ? response : null;
      } else {
        const rawOptions = typeof options === 'string' ? { content: options } : options;
        const flags = new MessageFlagsBitField((rawOptions as any).flags || 0);
        flags.add(MessageFlags.IsComponentsV2);
        if ((rawOptions as any).ephemeral) {
          flags.add(MessageFlags.Ephemeral);
        }

        const response = await this.interaction.reply({
          ...(rawOptions as any),
          flags: flags.bitfield,
          allowedMentions: { parse: [], repliedUser: false },
          withResponse: true,
        } as InteractionReplyOptions & { withResponse: true });
        this.replied = true;
        return response instanceof Message ? response : null;
      }
    } else if (this.message) {
      const rawOptions = typeof options === 'string' ? { content: options } : options;
      const flags = new MessageFlagsBitField((rawOptions as any).flags || 0);
      flags.add(MessageFlags.IsComponentsV2);
      const sent = await this.message.reply({
        ...(rawOptions as any),
        flags: flags.bitfield,
        allowedMentions: { parse: [], repliedUser: false },
      } as MessageCreateOptions);
      this.replied = true;
      return sent;
    }
    return null;
  }

  public async followUp(options: string | InteractionReplyOptions | MessageCreateOptions): Promise<Message | null> {
    if (this.isInteraction && this.interaction) {
      const response = await this.interaction.followUp(options as InteractionReplyOptions);
      return response instanceof Message ? response : null;
    } else if (this.channel && 'send' in this.channel) {
      return (this.channel as SendableChannel).send(options as MessageCreateOptions);
    }
    return null;
  }

  public getString(name: string, argIndex = 0): string | null {
    if (this.isInteraction && this.interaction) {
      return this.interaction.options.getString(name);
    }
    if (argIndex < this.args.length) {
      // If asking for remaining text, return slice joined
      return this.args.slice(argIndex).join(' ').trim() || null;
    }
    return null;
  }

  public getInteger(name: string, argIndex = 0): number | null {
    if (this.isInteraction && this.interaction) {
      return this.interaction.options.getInteger(name);
    }
    const val = this.args[argIndex];
    if (val !== undefined) {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  public getBoolean(name: string, argIndex = 0): boolean | null {
    if (this.isInteraction && this.interaction) {
      return this.interaction.options.getBoolean(name);
    }
    const val = this.args[argIndex]?.toLowerCase();
    if (val === 'true' || val === 'yes' || val === 'on' || val === '1') return true;
    if (val === 'false' || val === 'no' || val === 'off' || val === '0') return false;
    return null;
  }
}

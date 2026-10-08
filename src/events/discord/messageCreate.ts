import { Events } from 'discord.js';
import { BotEvent } from '../types';
import { Container } from '../../app/Container';
import { CommandContext } from '../../commands/CommandContext';

export const messageCreateEvent: BotEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,
  async execute(container: Container, message) {
    // Ignore bots and webhook messages
    if (message.author.bot || message.webhookId) {
      return;
    }

    // Must be in a guild
    if (!message.guild || !message.guildId) {
      return;
    }

    const { config } = container;

    // Get prefix for guild (fallback to default prefix)
    let prefix = config.DEFAULT_PREFIX;
    if (container.hasService('settingsService')) {
      const settingsService = container.getService<{ getPrefix(guildId: string): Promise<string> }>('settingsService');
      prefix = await settingsService.getPrefix(message.guildId).catch(() => config.DEFAULT_PREFIX);
    }

    // Mention prefix support: @VoidTune command
    const botMentionPrefix = `<@${container.client.user?.id}>`;
    const botNickMentionPrefix = `<@!${container.client.user?.id}>`;

    let matchedPrefix: string | null = null;
    const content = message.content.trim();

    if (content.startsWith(prefix)) {
      matchedPrefix = prefix;
    } else if (content.startsWith(botMentionPrefix)) {
      matchedPrefix = botMentionPrefix;
    } else if (content.startsWith(botNickMentionPrefix)) {
      matchedPrefix = botNickMentionPrefix;
    }

    if (!matchedPrefix) {
      return;
    }

    const withoutPrefix = content.slice(matchedPrefix.length).trim();
    if (!withoutPrefix) {
      return;
    }

    const rawArgs = withoutPrefix.split(/\s+/);
    const commandName = rawArgs.shift()?.toLowerCase();
    if (!commandName) {
      return;
    }

    const ctx = new CommandContext({
      message,
      args: rawArgs,
    });

    await container.commands.execute(ctx, container, commandName);
  },
};

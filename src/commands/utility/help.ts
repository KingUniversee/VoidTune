import { Command, CommandCategory } from '../types';
import { CommandContext } from '../CommandContext';
import { Container } from '../../app/Container';
import { createHelpV2, VTEmojis } from '../../utils/theme';

const CATEGORY_TITLES: Record<CommandCategory, { title: string; icon: string }> = {
  music: { title: 'Music Playback', icon: VTEmojis.music },
  playlist: { title: 'Playlists', icon: VTEmojis.queue },
  settings: { title: 'Server Settings', icon: VTEmojis.settings },
  admin: { title: 'Administration', icon: VTEmojis.void_tune },
  utility: { title: 'Utilities', icon: VTEmojis.bolt },
};

export const helpCommand: Command = {
  name: 'help',
  description: 'Displays all available VoidTune commands and syntax',
  category: 'utility',
  aliases: ['commands', 'h'],
  slashData: {
    name: 'help',
    description: 'Displays all available VoidTune commands and syntax',
  },
  async execute(ctx: CommandContext, container: Container): Promise<void> {
    const allCommands = container.commands.getAll();
    const prefix = container.config.DEFAULT_PREFIX;

    // Group commands by category
    const grouped = new Map<CommandCategory, Command[]>();
    for (const cmd of allCommands) {
      const list = grouped.get(cmd.category) || [];
      list.push(cmd);
      grouped.set(cmd.category, list);
    }

    const categories: {
      title: string;
      icon: string;
      commands: { name: string; aliases?: string[]; description: string }[];
    }[] = [];

    for (const [category, cmds] of grouped.entries()) {
      const info = CATEGORY_TITLES[category] || { title: category, icon: VTEmojis.dot };
      categories.push({
        title: info.title,
        icon: info.icon,
        commands: cmds.map((c) => ({
          name: c.name,
          aliases: c.aliases,
          description: c.description,
        })),
      });
    }

    const v2Card = createHelpV2(categories, prefix);
    await ctx.reply(v2Card);
  },
};


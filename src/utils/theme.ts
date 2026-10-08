import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  User,
} from 'discord.js';
import { Track, RepeatMode } from '../music/types/track';
import { PlaybackStatus } from '../music/types/playback';
import { PaginatedQueue } from '../music/QueueManager';
import { formatDuration, formatDurationVerbose } from './format';

export const Theme = {
  Colors: {
    primary: 0x8a2be2, // Electric BlueViolet
    success: 0x00f5d4, // Neon Mint
    playing: 0x10b981, // Emerald Green
    paused: 0xf59e0b,  // Warm Amber
    error: 0xff3366,   // Crimson Rose
    info: 0x6366f1,    // Electric Indigo
    neutral: 0x2b2d31, // Discord Slate
  },
  Icons: {
    music: '<:vt_music:1550382958123425864>',
    playing: '<:vt_play:1550382975865200700>',
    paused: '<:vt_pause:1550382966847574147>',
    skip: '<:vt_skip:1550383011516649482>',
    stop: '<:vt_stop:1550383037521469481>',
    volume: '<:vt_volume:1550383063555383297>',
    repeat: '<:vt_loop:1550382938649137232>',
    queue: '<:vt_queue:1550382994500485200>',
    sparkle: '<:vt_dot:1550393041800396883>',
    channel: '<:vt_ping:1550393030568058971>',
    user: '<:vt_dot:1550393041800396883>',
    shield: '<:vt_settings:1550401238162739202>',
    bolt: '<:vt_bolt:1550393039489343608>',
  },
};

export const VTEmojis = {
  void_tune: '<:vt_void_tune:1550383054961246258>',
  music: '<:vt_music:1550382958123425864>',
  track: '<:vt_track:1550383081305669652>',
  play: '<:vt_play:1550382975865200700>',
  pause: '<:vt_pause:1550382966847574147>',
  skip: '<:vt_skip:1550383011516649482>',
  previous: '<:vt_previous:1550382984371249222>',
  stop: '<:vt_stop:1550383037521469481>',
  queue: '<:vt_queue:1550382994500485200>',
  loop: '<:vt_loop:1550382938649137232>',
  shuffle: '<:vt_shuffle:1550383002599825479>',
  volume: '<:vt_volume:1550383063555383297>',
  duration: '<:vt_duration:1550382875138859108>',
  mic: '<:vt_mic:1550382948090642522>',
  equalizer: '<:vt_equalizer:1550382911977562112>',
  filter: '<:vt_filter:1550382930025775144>',
  bass_boost: '<:vt_bass_boost:1550382892734091344>',
  autoplay: '<:vt_autoplay:1550382883665870860>',
  twentyfour_seven: '<:vt_24_7:1550382866440003665>',
  favorite: '<:vt_favorite:1550382921376858203>',
  youtube: '<:vt_youtube:1550383072661344317>',
  spotify: '<:vt_spotify:1550383028835197019>',
  soundcloud: '<:vt_soundcloud:1550383019825700936>',
  deezer: '<:vt_deezer:1550382903152746587>',
  tidal: '<:vt_tidal:1550383046438686830>',
  trash: '<:vt_trash:1550386342918098945>',
  ping: '<:vt_ping:1550393030568058971>',
  ram: '<:vt_ram:1550393032766001275>',
  settings: '<:vt_settings:1550401238162739202>',
  bolt: '<:vt_bolt:1550393039489343608>',
  dot: '<:vt_dot:1550393041800396883>',
};

export const VTButtonEmojis = {
  play: { id: '1550382975865200700', name: 'vt_play' },
  pause: { id: '1550382966847574147', name: 'vt_pause' },
  skip: { id: '1550383011516649482', name: 'vt_skip' },
  previous: { id: '1550382984371249222', name: 'vt_previous' },
  stop: { id: '1550383037521469481', name: 'vt_stop' },
  volume: { id: '1550383063555383297', name: 'vt_volume' },
  queue: { id: '1550382994500485200', name: 'vt_queue' },
  loop: { id: '1550382938649137232', name: 'vt_loop' },
  autoplay: { id: '1550382883665870860', name: 'vt_autoplay' },
  twentyfour_seven: { id: '1550382866440003665', name: 'vt_24_7' },
  trash: { id: '1550386342918098945', name: 'vt_trash' },
  settings: { id: '1550401238162739202', name: 'vt_settings' },
  ping: { id: '1550393030568058971', name: 'vt_ping' },
  bolt: { id: '1550393039489343608', name: 'vt_bolt' },
  ram: { id: '1550393032766001275', name: 'vt_ram' },
  dot: { id: '1550393041800396883', name: 'vt_dot' },
};

/**
 * Creates an ultra-clean progress bar with unicode circle
 */
export function createStyledProgressBar(currentMs: number, totalMs: number, barLength = 12): string {
  if (totalMs <= 0) {
    return `${VTEmojis.dot} Live Stream`;
  }

  const ratio = Math.max(0, Math.min(1, currentMs / totalMs));
  const progress = Math.round(barLength * ratio);
  const empty = barLength - progress;

  const filledBar = '━'.repeat(Math.max(0, progress - 1));
  const emptyBar = '━'.repeat(Math.max(0, empty));

  return `${filledBar}🔘${emptyBar}`;
}

/**
 * Creates interactive media control buttons in Components V2 ActionRows matching the hardware remote aesthetic
 */
export function createNowPlayingActionRows(
  isPaused = false,
  repeatMode: RepeatMode = 'off',
  autoplay = false,
  _is247 = false
): ActionRowBuilder<ButtonBuilder>[] {
  const prevBtn = new ButtonBuilder()
    .setCustomId('btn_player_prev')
    .setEmoji(VTButtonEmojis.previous)
    .setStyle(ButtonStyle.Secondary);

  const pauseResumeBtn = new ButtonBuilder()
    .setCustomId('btn_player_pause_resume')
    .setEmoji(isPaused ? VTButtonEmojis.play : VTButtonEmojis.pause)
    .setStyle(ButtonStyle.Secondary);

  const skipBtn = new ButtonBuilder()
    .setCustomId('btn_player_skip')
    .setEmoji(VTButtonEmojis.skip)
    .setStyle(ButtonStyle.Secondary);

  const stopBtn = new ButtonBuilder()
    .setCustomId('btn_player_stop')
    .setEmoji(VTButtonEmojis.stop)
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    prevBtn,
    pauseResumeBtn,
    skipBtn,
    stopBtn
  );

  const repeatLabel = repeatMode === 'track' ? 'Track' : repeatMode === 'queue' ? 'Queue' : 'Off';
  const loopBtn = new ButtonBuilder()
    .setCustomId('btn_player_loop')
    .setEmoji(VTButtonEmojis.loop)
    .setLabel(`Loop: ${repeatLabel}`)
    .setStyle(repeatMode !== 'off' ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const autoplayBtn = new ButtonBuilder()
    .setCustomId('btn_player_autoplay')
    .setEmoji(VTButtonEmojis.autoplay)
    .setLabel(`Autoplay: ${autoplay ? 'On' : 'Off'}`)
    .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    loopBtn,
    autoplayBtn
  );

  return [row1, row2];
}

/**
 * Shortens and cleans track title to keep UI cards compact and avoid horizontal stretching
 */
export function cleanTrackTitle(title: string, maxLength = 32): string {
  if (!title) return 'Unknown Track';

  let cleaned = title
    .replace(/\s*[([{\-]\s*(official\s*(music\s*)?video|official\s*audio|lyrics?(\s*video)?|audio|video|\d{4},?\s*video|hd|4k|hq|remaster(ed)?)\s*[)\]}]/gi, '')
    .replace(/\s*[-–|•]\s*$/g, '')
    .trim();

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength - 1).trim() + '…';
  }
  return cleaned;
}

/**
 * Creates queue control buttons matching the Track Added reference design with custom emojis.
 * Encodes requesterId into customId so that only the authorized user can trigger them.
 */
export function createTrackAddedActionRows(
  requesterId?: string,
  disabled: boolean = false
): ActionRowBuilder<ButtonBuilder>[] {
  const playNowCustomId = requesterId ? `btn_queue_play_now:${requesterId}` : 'btn_queue_play_now';
  const upcomingCustomId = requesterId ? `btn_queue_upcoming:${requesterId}` : 'btn_queue_upcoming';
  const removeCustomId = requesterId ? `btn_queue_remove:${requesterId}` : 'btn_queue_remove';

  const playNowBtn = new ButtonBuilder()
    .setCustomId(playNowCustomId)
    .setLabel('Play Now')
    .setEmoji(VTButtonEmojis.play)
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  const upcomingBtn = new ButtonBuilder()
    .setCustomId(upcomingCustomId)
    .setLabel('Upcoming')
    .setEmoji(VTButtonEmojis.skip)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(playNowBtn, upcomingBtn);

  const removeBtn = new ButtonBuilder()
    .setCustomId(removeCustomId)
    .setLabel('Remove')
    .setEmoji(VTButtonEmojis.trash)
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(removeBtn);

  return [row1, row2];
}

export interface V2CardResponse {
  components: [ContainerBuilder];
  flags: MessageFlags;
  allowedMentions?: { parse?: never[]; repliedUser?: boolean; users?: string[] };
}

/**
 * Components V2: Now Playing Card (matching media_1789710192140.png)
 */
export function createNowPlayingV2(
  track: Track,
  status?: Partial<PlaybackStatus> | null,
  _voiceChannelName?: string,
  requesterUser?: User,
  is247 = false
): V2CardResponse {
  const isPaused = Boolean(status?.paused);
  const repeatMode = (status?.repeatMode as 'off' | 'track' | 'queue') || 'off';
  const autoplay = Boolean(status?.autoplay);

  const container = new ContainerBuilder().setAccentColor(Theme.Colors.primary);

  let sourceEmoji = VTEmojis.music;
  if (track.source === 'spotify') sourceEmoji = VTEmojis.spotify;
  else if (track.source === 'youtube') sourceEmoji = VTEmojis.youtube;
  else if (track.source === 'soundcloud') sourceEmoji = VTEmojis.soundcloud;

  const durationStr = formatDurationVerbose(track.duration);
  const requesterId = requesterUser?.id || track.requesterId;
  const isAutoplay = requesterId === 'Autoplay' || (track as any).isAutoplay;
  const requesterName = isAutoplay
    ? 'Autoplay'
    : requesterUser?.username || (requesterUser as any)?.globalName || 'User';

  const cleanedTitle = cleanTrackTitle(track.title, 28);
  let artistSuffix = '';
  if (track.author && !track.title.toLowerCase().includes(track.author.toLowerCase())) {
    const cleanAuthor = cleanTrackTitle(track.author, 16);
    artistSuffix = ` - ${cleanAuthor}`;
  }

  const textContent =
    `### ${VTEmojis.music} Now Playing\n` +
    `${sourceEmoji} **[${cleanedTitle}](${track.uri || ''})**${artistSuffix}\n` +
    `Duration: \`${durationStr}\`\n` +
    `Requested by: \`${requesterName}\``;

  const textDisplay = new TextDisplayBuilder().setContent(textContent);

  if (track.thumbnail && track.thumbnail.startsWith('http')) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(textDisplay)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(textDisplay);
  }

  const actionRows = createNowPlayingActionRows(isPaused, repeatMode, autoplay, is247);
  for (const row of actionRows) {
    container.addActionRowComponents(row);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

/**
 * Components V2: Track Added Card (matching media_1789710207844.png)
 */
export function createTrackAddedV2(
  track: Track,
  position: number,
  requesterUser: User,
  showButtons: boolean = true,
  disabledButtons: boolean = false
): V2CardResponse {
  const container = new ContainerBuilder().setAccentColor(0x2ecc71);

  const cleanedTitle = cleanTrackTitle(track.title, 30);
  const cleanedAuthor = track.author ? cleanTrackTitle(track.author, 18) : 'Unknown';
  const titleMarkdown = track.uri ? `[${cleanedTitle}](${track.uri})` : cleanedTitle;
  const durationStr = formatDurationVerbose(track.duration);

  const textContent =
    `## ${VTEmojis.track} Track Added\n\n` +
    `**${titleMarkdown}** by \`${cleanedAuthor}\` added to queue.\n` +
    `Position \`#${position}\` • Duration: \`${durationStr}\` • By: \`${requesterUser.username}\``;

  const textDisplay = new TextDisplayBuilder().setContent(textContent);

  if (track.thumbnail && track.thumbnail.startsWith('http')) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(textDisplay)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(textDisplay);
  }

  if (showButtons) {
    const trackRows = createTrackAddedActionRows(requesterUser?.id, disabledButtons);
    for (const row of trackRows) {
      container.addActionRowComponents(row);
    }
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

/**
 * Components V2: Playlist Added Card (matching clean reference aesthetic)
 */
export function createPlaylistAddedV2(
  playlistName: string,
  tracks: Track[],
  _enqueuedPosition?: number,
  requesterUser?: User,
  showButtons: boolean = true,
  disabledButtons: boolean = false
): V2CardResponse {
  const totalDurationMs = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const container = new ContainerBuilder().setAccentColor(0x2ecc71);

  const cleanPlaylist = cleanTrackTitle(playlistName, 32);
  const durationStr = formatDurationVerbose(totalDurationMs);
  const userName = requesterUser?.username || 'User';
  const textContent =
    `## ${VTEmojis.queue} Playlist Added\n\n` +
    `**${cleanPlaylist}** added to queue.\n` +
    `Tracks: \`${tracks.length}\` • Total Duration: \`${durationStr}\` • By: \`${userName}\``;

  const textDisplay = new TextDisplayBuilder().setContent(textContent);

  const firstThumbnail = tracks[0]?.thumbnail;
  if (firstThumbnail && firstThumbnail.startsWith('http')) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(textDisplay)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(firstThumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(textDisplay);
  }

  if (showButtons) {
    const playlistRows = createTrackAddedActionRows(requesterUser?.id, disabledButtons);
    for (const row of playlistRows) {
      container.addActionRowComponents(row);
    }
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

/**
 * Recursively disables all buttons inside Components V2 container component trees
 */
export function disableContainerButtons(components: any[]): any[] {
  if (!components || !Array.isArray(components)) return [];
  return components.map((c) => {
    const raw = typeof c?.toJSON === 'function' ? c.toJSON() : JSON.parse(JSON.stringify(c));
    if (raw.components && Array.isArray(raw.components)) {
      raw.components = raw.components.map((sub: any) => {
        if (sub.type === 1 && Array.isArray(sub.components)) {
          // ActionRow
          sub.components = sub.components.map((btn: any) => ({
            ...btn,
            disabled: true,
          }));
        }
        return sub;
      });
    }
    return {
      ...raw,
      toJSON() {
        return raw;
      },
    };
  });
}

/**
 * Components V2: Playback Stopped Card (matching theme, displays current song info, no buttons)
 */
export function createStoppedV2(
  trackOrUser?: Track | User | string | null,
  stoppedByUser?: User | string
): V2CardResponse {
  let track: Track | null = null;
  let user: User | string | undefined = stoppedByUser;

  if (trackOrUser && typeof trackOrUser === 'object') {
    if ('title' in trackOrUser && typeof (trackOrUser as any).title === 'string') {
      track = trackOrUser as Track;
    } else if (!user) {
      user = trackOrUser as User;
    }
  } else if (typeof trackOrUser === 'string' && !user) {
    user = trackOrUser;
  }

  const container = new ContainerBuilder().setAccentColor(Theme.Colors.primary);

  const userName = typeof user === 'string'
    ? user
    : user
    ? user.username || (user as any).globalName || 'User'
    : null;
  const userNote = userName ? `\nSession ended by \`${userName}\`` : '';

  if (track) {
    let sourceEmoji = VTEmojis.music;
    if (track.source === 'spotify') sourceEmoji = VTEmojis.spotify;
    else if (track.source === 'youtube') sourceEmoji = VTEmojis.youtube;
    else if (track.source === 'soundcloud') sourceEmoji = VTEmojis.soundcloud;

    const durationStr = formatDurationVerbose(track.duration);
    const cleanedTitle = cleanTrackTitle(track.title, 30);
    let artistSuffix = '';
    if (track.author && !track.title.toLowerCase().includes(track.author.toLowerCase())) {
      const cleanAuthor = cleanTrackTitle(track.author, 16);
      artistSuffix = ` - ${cleanAuthor}`;
    }

    const textContent =
      `### ${VTEmojis.stop} Playback Stopped\n` +
      `${sourceEmoji} **[${cleanedTitle}](${track.uri || ''})**${artistSuffix}\n` +
      `Duration: \`${durationStr}\`` +
      userNote;

    const textDisplay = new TextDisplayBuilder().setContent(textContent);

    if (track.thumbnail && track.thumbnail.startsWith('http')) {
      const section = new SectionBuilder()
        .addTextDisplayComponents(textDisplay)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(textDisplay);
    }
  } else {
    const textContent =
      `### ${VTEmojis.stop} Playback Stopped\n\n` +
      `Playback has been terminated and the queue was wiped clean.${userNote}`;

    const textDisplay = new TextDisplayBuilder().setContent(textContent);
    container.addTextDisplayComponents(textDisplay);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

/**
 * Components V2: Queue List Card
 */
export function createQueueV2(
  paginated: PaginatedQueue,
  currentTrack: Track | null,
  voiceChannelName: string,
  repeatMode: string
): { components: [ContainerBuilder]; flags: MessageFlags } {
  const container = new ContainerBuilder().setAccentColor(Theme.Colors.info);

  let headerContent = `## ${VTEmojis.void_tune} VoidTune • ${VTEmojis.queue} Music Queue\n`;
  if (currentTrack) {
    const cleanedTitle = cleanTrackTitle(currentTrack.title, 32);
    const titleLink = currentTrack.uri ? `[${cleanedTitle}](${currentTrack.uri})` : cleanedTitle;
    headerContent += `${VTEmojis.play} **Now Streaming:** ${titleLink} \`[${formatDuration(currentTrack.duration)}]\``;
  } else {
    headerContent += `*No track currently streaming.*`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  let queueContent = `### ${VTEmojis.track} Up Next in \`${voiceChannelName}\`:\n`;
  if (paginated.items.length === 0) {
    queueContent += `*Queue is empty. Use \`/play <song>\` to add more tracks!*`;
  } else {
    const lines = paginated.items.map((track, i) => {
      const idx = (paginated.page - 1) * paginated.pageSize + i + 1;
      const cleanedTitle = cleanTrackTitle(track.title, 30);
      const titleLink = track.uri ? `[${cleanedTitle}](${track.uri})` : cleanedTitle;
      return `${VTEmojis.dot} \`${String(idx).padStart(2, '0')}.\` ${titleLink} — \`${formatDuration(track.duration)}\``;
    });
    queueContent += lines.join('\n');
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queueContent));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const footerContent =
    `${VTEmojis.queue} **Queue:** \`${paginated.totalTracks} tracks\`  •  ${VTEmojis.duration} \`${formatDuration(paginated.totalDurationMs)}\`  •  ${VTEmojis.loop} \`${repeatMode.toUpperCase()}\`\n` +
    `*Page ${paginated.page} of ${paginated.totalPages} • VoidTune Studio*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerContent));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Components V2: Action / Status Card
 */
export function createActionV2(
  title: string,
  description: string,
  color: number = Theme.Colors.primary,
  actionRow?: ActionRowBuilder<ButtonBuilder>
): { components: [ContainerBuilder]; flags: MessageFlags } {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${title}\n${description}`)
    );

  if (actionRow) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(actionRow);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Components V2: System Telemetry / Ping Card
 */
export function createPingV2(data: {
  wsPing: number;
  roundtripMs: number;
  memoryUsedMb: string;
  uptime: string;
  audioNode: string;
}): { components: [ContainerBuilder]; flags: MessageFlags } {
  const container = new ContainerBuilder().setAccentColor(Theme.Colors.primary);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${VTEmojis.void_tune} VoidTune • System Diagnostics\nLive gateway telemetry and audio pipeline metrics.`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${VTEmojis.ping} **Gateway Ping:** \`${data.wsPing >= 0 ? `${data.wsPing}ms` : 'Connecting...'}\`  •  ${VTEmojis.bolt} **Roundtrip:** \`${data.roundtripMs}ms\`\n` +
      `${VTEmojis.ram} **Memory Load:** \`${data.memoryUsedMb} MB\`  •  ${VTEmojis.duration} **System Uptime:** \`${data.uptime}\`\n` +
      `${VTEmojis.equalizer} **Audio Node:** \`${data.audioNode}\`  •  ${VTEmojis.twentyfour_seven} **Quality:** \`320kbps HD\``
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`*Status: 100% Operational • VoidTune Audio Core*`)
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Components V2: Command Center / Help Card
 */
export function createHelpV2(
  categories: { title: string; icon: string; commands: { name: string; aliases?: string[]; description: string }[] }[],
  prefix: string
): { components: [ContainerBuilder]; flags: MessageFlags } {
  const container = new ContainerBuilder().setAccentColor(Theme.Colors.primary);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${VTEmojis.void_tune} VoidTune Command Center\n` +
      `Execute commands using **Slash Commands** (\`/command\`) or **Prefix** (\`${prefix}command\`).`
    )
  );

  for (const cat of categories) {
    if (cat.commands.length === 0) continue;
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    const commandList = cat.commands
      .map((c) => {
        const aliasStr = c.aliases && c.aliases.length > 0 ? ` *(${c.aliases.join(', ')})*` : '';
        return `${VTEmojis.dot} \`/${c.name}\`${aliasStr} — ${c.description}`;
      })
      .join('\n');

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${cat.icon} ${cat.title}\n${commandList}`
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`*VoidTune v2 • High-Performance Lossless Music Engine*`)
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}


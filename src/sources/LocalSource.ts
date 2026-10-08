import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { LoadType } from 'shoukaku';
import { AudioSource, ResolvedResult, SourceContext } from './AudioSource';
import { Track } from '../music/types/track';
import { SourceError } from '../utils/errors';
import { config } from '../config/env';

export class LocalSource implements AudioSource {
  public readonly name = 'local';
  public readonly priority = 30;

  private readonly allowedExtensions = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a']);

  public supports(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.startsWith('local:')) return true;
    if (trimmed.startsWith('file://')) return true;

    // Check if it looks like a local file path with an allowed audio extension
    const ext = path.extname(trimmed).toLowerCase();
    if (this.allowedExtensions.has(ext) && !/^https?:\/\//i.test(trimmed)) {
      return true;
    }

    return false;
  }

  public async resolve(input: string, context: SourceContext): Promise<ResolvedResult> {
    let rawPath = input.trim();
    if (rawPath.startsWith('local:')) {
      rawPath = rawPath.slice('local:'.length).trim();
    } else if (rawPath.startsWith('file://')) {
      rawPath = rawPath.slice('file://'.length).trim();
    }

    const configuredRoot = path.resolve(process.cwd(), config.MUSIC_LIBRARY_PATH);
    const resolvedPath = path.resolve(configuredRoot, rawPath);

    // SECURITY CHECK 1: Path Traversal Prevention
    // Ensure resolved path is strictly within configuredRoot
    const isWithinRoot =
      resolvedPath === configuredRoot ||
      resolvedPath.startsWith(configuredRoot + path.sep);

    if (!isWithinRoot) {
      context.logger.warn({ input, resolvedPath, configuredRoot }, 'Path traversal attempt blocked');
      throw new SourceError(
        'LOCAL_FILE_NOT_ALLOWED',
        `Access denied: path escapes configured root: ${input}`,
        'Access denied: Path traversal is not permitted.'
      );
    }

    // SECURITY CHECK 2: Extension Whitelist
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      throw new SourceError(
        'UNSUPPORTED_SOURCE',
        `Unsupported local audio format: ${ext}`,
        `Unsupported format. Allowed local formats: ${Array.from(this.allowedExtensions).join(', ')}`
      );
    }

    // SECURITY CHECK 3: File Existence & Not a Directory / Device
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error('Not a regular file');
      }
    } catch {
      throw new SourceError(
        'TRACK_NOT_FOUND',
        `Local file does not exist or is not a file: ${resolvedPath}`,
        'The specified local audio file could not be found.'
      );
    }

    // Resolve via Lavalink local audio source
    const idealNode = context.shoukaku.getIdealNode();
    if (!idealNode) {
      throw new SourceError(
        'LAVALINK_UNAVAILABLE',
        'No Lavalink node available to process local audio',
        'Audio processing node is currently unavailable.'
      );
    }

    context.logger.info({ resolvedPath }, 'Resolving local audio file with Lavalink');
    const response = await idealNode.rest.resolve(resolvedPath).catch(() => null);

    const safeFilename = path.basename(resolvedPath, ext);

    if (response && response.loadType === LoadType.TRACK) {
      const raw = response.data as any;
      const track: Track = {
        id: randomUUID(),
        encodedTrack: raw.encoded,
        title: raw.info?.title || safeFilename,
        author: raw.info?.author || 'Local Storage',
        duration: raw.info?.length || 0,
        uri: `local:${path.basename(resolvedPath)}`,
        source: 'local',
        requesterId: context.requesterId,
      };
      return { type: 'track', tracks: [track] };
    }

    // If Lavalink returned empty but file is confirmed valid on disk, report detailed error
    throw new SourceError(
      'SOURCE_UNAVAILABLE',
      `Lavalink could not decode local file: ${resolvedPath}`,
      'Could not load local audio file. Ensure local source is enabled in Lavalink.'
    );
  }
}

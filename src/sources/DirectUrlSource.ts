import { randomUUID } from 'crypto';
import { LoadType } from 'shoukaku';
import { AudioSource, ResolvedResult, SourceContext } from './AudioSource';
import { Track } from '../music/types/track';
import { SourceError } from '../utils/errors';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

export class DirectUrlSource implements AudioSource {
  public readonly name = 'http';
  public readonly priority = 40;

  private readonly allowedExtensions = new Set([
    '.mp3',
    '.ogg',
    '.wav',
    '.flac',
    '.aac',
    '.m4a',
    '.opus',
  ]);

  public supports(input: string): boolean {
    const trimmed = input.trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;

    // Reject YouTube, Spotify, SoundCloud which have dedicated adapters
    if (/(youtube\.com|youtu\.be|spotify\.com|soundcloud\.com)/i.test(trimmed)) {
      return false;
    }

    return true;
  }

  public async resolve(input: string, context: SourceContext): Promise<ResolvedResult> {
    const urlStr = input.trim();
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(urlStr);
    } catch {
      throw new SourceError(
        'INVALID_SOURCE_URL',
        `Malformed HTTP URL: ${urlStr}`,
        'The provided audio URL is invalid.'
      );
    }

    // SECURITY CHECK 1: Protocol Check
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new SourceError(
        'UNSUPPORTED_SOURCE',
        `Forbidden protocol: ${parsedUrl.protocol}`,
        'Only HTTP and HTTPS audio streams are supported.'
      );
    }

    // SECURITY CHECK 2: SSRF & Private Network Protection
    const hostname = parsedUrl.hostname.toLowerCase();
    if (this.isPrivateOrLocalHost(hostname)) {
      context.logger.warn({ hostname, url: urlStr }, 'SSRF attempt blocked');
      throw new SourceError(
        'SECURITY_VIOLATION',
        `Access to private/local network address is blocked: ${hostname}`,
        'Access to private or local network resources is forbidden.'
      );
    }

    // SECURITY CHECK 3: Verify audio extension or inspect Content-Type
    const pathname = parsedUrl.pathname.toLowerCase();
    const hasAudioExt = Array.from(this.allowedExtensions).some((ext) => pathname.endsWith(ext));

    if (!hasAudioExt) {
      // Perform lightweight HEAD request to verify audio MIME type
      const isAudio = await this.verifyAudioMimeType(urlStr, context);
      if (!isAudio) {
        throw new SourceError(
          'UNSUPPORTED_SOURCE',
          `Direct URL is not recognized as an audio stream: ${urlStr}`,
          'The URL does not point to a supported audio file or stream.'
        );
      }
    }

    // Resolve via Lavalink HTTP source
    if (!context.shoukaku || !context.shoukaku.nodes) {
      throw new SourceError(
        'LAVALINK_UNAVAILABLE',
        'No Lavalink node available for direct URL',
        'Audio processing node is currently unavailable.'
      );
    }

    const idealNode = typeof context.shoukaku.getIdealNode === 'function' ? context.shoukaku.getIdealNode() : null;
    const allNodes = Array.from(context.shoukaku.nodes.values());
    const candidateNodes = idealNode
      ? [idealNode, ...allNodes.filter((n) => n.name !== idealNode.name)]
      : allNodes;

    context.logger.info({ url: urlStr }, 'Resolving direct HTTP audio with Lavalink');

    let response: any = null;
    for (const node of candidateNodes) {
      if (!node.rest || node.state !== 1) continue;
      try {
        const res = await lavalinkGatekeeper.resolve(node, urlStr, 8000);
        if (res && res.loadType !== LoadType.EMPTY && res.loadType !== LoadType.ERROR) {
          response = res;
          break;
        }
      } catch (err) {
        context.logger.warn({ err, node: node.name, url: urlStr }, 'Lavalink node resolve failed for direct URL, trying next');
      }
    }

    if (!response || response.loadType === LoadType.EMPTY) {
      throw new SourceError(
        'TRACK_NOT_FOUND',
        `No audio found at direct URL: ${urlStr}`,
        'No playable audio could be loaded from that link.'
      );
    }

    if (response.loadType === LoadType.TRACK) {
      const raw = response.data as any;
      const track: Track = {
        id: randomUUID(),
        encodedTrack: raw.encoded,
        title: raw.info?.title && raw.info.title !== 'Unknown title' ? raw.info.title : pathname.split('/').pop() || 'Direct Audio Stream',
        author: raw.info?.author || parsedUrl.hostname,
        duration: raw.info?.length || 0,
        uri: urlStr,
        source: 'http',
        requesterId: context.requesterId,
        isStream: raw.info?.isStream || false,
      };

      return { type: 'track', tracks: [track] };
    }

    throw new SourceError(
      'SOURCE_UNAVAILABLE',
      `Unexpected loadType from Lavalink for HTTP URL: ${response.loadType}`,
      'Could not load audio from that URL.'
    );
  }

  private isPrivateOrLocalHost(host: string): boolean {
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
      return true;
    }

    // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    const ipMatch = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch && ipMatch[1] && ipMatch[2]) {
      const b0 = parseInt(ipMatch[1], 10);
      const b1 = parseInt(ipMatch[2], 10);

      if (b0 === 10) return true;
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
      if (b0 === 192 && b1 === 168) return true;
      if (b0 === 169 && b1 === 254) return true; // Link-local / metadata
      if (b0 === 127) return true;
    }

    return false;
  }

  private async verifyAudioMimeType(url: string, context: SourceContext): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      return contentType.startsWith('audio/') || contentType.includes('application/ogg');
    } catch (err) {
      context.logger.debug({ err, url }, 'HEAD request failed for MIME check');
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

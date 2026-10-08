import { describe, it, expect } from 'vitest';
import { DirectUrlSource } from '@/sources/DirectUrlSource';
import { SourceContext } from '@/sources/AudioSource';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('DirectUrlSource (SSRF & Safe Stream Validation)', () => {
  const directSource = new DirectUrlSource();

  const mockContext: SourceContext = {
    requesterId: 'user_123',
    shoukaku: {
      getIdealNode: () => ({
        rest: {
          resolve: async () => null,
        },
      }),
    } as any,
    logger: silentLogger,
  };

  it('should block SSRF and local network access', async () => {
    const dangerousUrls = [
      'http://localhost/secret.mp3',
      'http://127.0.0.1:8080/audio.mp3',
      'http://192.168.1.1/music.mp3',
      'http://10.0.0.1/private.mp3',
      'http://169.254.169.254/latest/meta-data/',
    ];

    for (const url of dangerousUrls) {
      await expect(directSource.resolve(url, mockContext)).rejects.toThrowError(
        expect.objectContaining({
          code: 'SECURITY_VIOLATION',
        })
      );
    }
  });

  it('should reject non-HTTP protocols', async () => {
    const invalidProtocols = [
      'file:///etc/hosts',
      'ftp://example.com/audio.mp3',
      'gopher://example.com/',
    ];

    for (const url of invalidProtocols) {
      await expect(directSource.resolve(url, mockContext)).rejects.toThrowError();
    }
  });

  it('should reject malformed URLs', async () => {
    await expect(directSource.resolve('http://[invalid', mockContext)).rejects.toThrowError(
      expect.objectContaining({
        code: 'INVALID_SOURCE_URL',
      })
    );
  });
});

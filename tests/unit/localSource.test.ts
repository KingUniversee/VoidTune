import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalSource } from '@/sources/LocalSource';
import { SourceContext } from '@/sources/AudioSource';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const silentLogger = pino({ level: 'silent' });

describe('LocalSource (Security & Sandboxing)', () => {
  let localSource: LocalSource;
  const testDir = path.resolve(process.cwd(), 'tests_scratch_music');

  beforeEach(async () => {
    localSource = new LocalSource();
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

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

  it('should reject path traversal attempts escaping root directory', async () => {
    const maliciousPaths = [
      '../../../../etc/passwd',
      '..\\..\\..\\windows\\win.ini',
      'subfolder/../../secret.txt',
    ];

    for (const input of maliciousPaths) {
      await expect(localSource.resolve(input, mockContext)).rejects.toThrowError(
        expect.objectContaining({
          code: 'LOCAL_FILE_NOT_ALLOWED',
        })
      );
    }
  });

  it('should reject unsupported file extensions', async () => {
    const forbiddenInputs = [
      'script.sh',
      'malware.exe',
      'document.pdf',
      'notes.txt',
    ];

    for (const input of forbiddenInputs) {
      await expect(localSource.resolve(input, mockContext)).rejects.toThrowError(
        expect.objectContaining({
          code: 'UNSUPPORTED_SOURCE',
        })
      );
    }
  });

  it('should report TRACK_NOT_FOUND when valid audio file does not exist on disk', async () => {
    await expect(
      localSource.resolve('non_existent_track.mp3', mockContext)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'TRACK_NOT_FOUND',
      })
    );
  });
});

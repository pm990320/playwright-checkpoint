import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { storageCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-storage-'));
}

describe('storageCollector', () => {
  it('captures cookies and localStorage keys with redaction', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();

    page.contextCookiesImpl.mockResolvedValue([
      {
        name: 'session_token',
        domain: '.example.com',
        path: '/',
        value: 'abc123',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'theme',
        domain: '.example.com',
        path: '/',
        value: 'dark',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    page.evaluateImpl.mockResolvedValue([
      { key: 'lastEmail', value: 'alice@example.com' },
      { key: 'sidebarState', value: 'expanded' },
    ]);

    const result = await storageCollector.collect(
      createCollectorContext({
        page,
        checkpointDir,
        config: {
          includeCookieValues: true,
          includeLocalStorageValues: true,
        },
      }),
    );

    expect(result.summary).toEqual({
      cookieCount: 2,
      localStorageKeyCount: 2,
    });

    expect(result.data).toMatchObject({
      cookieCount: 2,
      localStorageKeyCount: 2,
      cookies: [
        {
          name: 'session_token',
          value: '[REDACTED]',
          redacted: true,
        },
        {
          name: 'theme',
          value: 'dark',
          redacted: false,
        },
      ],
      localStorage: [
        {
          key: 'lastEmail',
          value: '[REDACTED]',
          redacted: true,
        },
        {
          key: 'sidebarState',
          value: 'expanded',
          redacted: false,
        },
      ],
    });

    expect(await fs.readFile(path.join(checkpointDir, 'storage-state.json'), 'utf8')).toContain('session_token');
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formsCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-forms-'));
}

describe('formsCollector', () => {
  it('captures visible fields and redacts sensitive values', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();

    page.evaluateImpl.mockResolvedValue([
      {
        tagName: 'input',
        type: 'email',
        name: 'email',
        id: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        value: 'alice@example.com',
        checked: null,
        disabled: false,
        required: true,
      },
      {
        tagName: 'input',
        type: 'text',
        name: 'accountId',
        id: 'account-id',
        label: 'Account ID',
        placeholder: null,
        value: 'A-123',
        checked: null,
        disabled: false,
        required: false,
      },
    ]);

    const result = await formsCollector.collect(
      createCollectorContext({
        page,
        checkpointDir,
        redact: ['accountid'],
      }),
    );

    expect(result.summary).toEqual({
      fieldCount: 2,
      redactedCount: 2,
    });

    expect(result.data).toMatchObject({
      fieldCount: 2,
      redactedCount: 2,
      fields: [
        {
          name: 'email',
          redacted: true,
          value: '[REDACTED]',
        },
        {
          name: 'accountId',
          redacted: true,
          value: '[REDACTED]',
        },
      ],
    });

    expect(await fs.readFile(path.join(checkpointDir, 'form-state.json'), 'utf8')).toContain('"fieldCount": 2');
  });
});

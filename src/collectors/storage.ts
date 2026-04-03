import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointCollector,
  StorageCollectorData,
  StorageCookieState,
  StorageEntryState,
} from '../types';

const REDACTED = '[REDACTED]';
const DEFAULT_REDACT_PATTERNS = ['password', 'token', 'secret', 'api[_-]?key', 'authorization', 'session', 'email'];
const EMAIL_LIKE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RawCookie = {
  name: string;
  domain: string;
  path: string;
  value: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
};

type RawStorageEntry = {
  key: string;
  value: string;
};

function toRegex(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

function buildRedactionRegexes(ctx: { redact: string[]; config: Record<string, unknown> }): RegExp[] {
  const fromConfig = Array.isArray(ctx.config.redact)
    ? ctx.config.redact.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return [...DEFAULT_REDACT_PATTERNS, ...ctx.redact, ...fromConfig]
    .map((pattern) => toRegex(pattern))
    .filter((value): value is RegExp => value instanceof RegExp);
}

function shouldRedact(identifier: string, value: string | null, regexes: RegExp[]): boolean {
  if (regexes.some((regex) => regex.test(identifier))) {
    return true;
  }

  if (!value) {
    return false;
  }

  if (EMAIL_LIKE_REGEX.test(value.trim())) {
    return true;
  }

  return regexes.some((regex) => regex.test(value));
}

export const storageCollector: CheckpointCollector = {
  name: 'storage',
  defaultEnabled: false,

  async collect(ctx) {
    const includeCookieValues = ctx.config.includeCookieValues === true;
    const includeLocalStorageValues = ctx.config.includeLocalStorageValues === true;
    const redactValues = ctx.config.redactValues !== false;
    const regexes = buildRedactionRegexes({ redact: ctx.redact, config: ctx.config });

    const cookies = (await ctx.page.context().cookies()) as RawCookie[];
    const localStorageEntries = await ctx.page.evaluate(() =>
      Object.keys(localStorage).map((key) => ({
        key,
        value: localStorage.getItem(key) ?? '',
      })),
    );

    const normalizedCookies: StorageCookieState[] = cookies.map((cookie) => {
      const rawValue = includeCookieValues ? cookie.value : null;
      const redacted = redactValues && shouldRedact(cookie.name, rawValue, regexes);

      return {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        value: rawValue == null ? null : redacted ? REDACTED : rawValue,
        redacted,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      };
    });

    const normalizedLocalStorage: StorageEntryState[] = (localStorageEntries as RawStorageEntry[]).map((entry) => {
      const rawValue = includeLocalStorageValues ? entry.value : null;
      const redacted = redactValues && shouldRedact(entry.key, rawValue, regexes);

      return {
        key: entry.key,
        value: rawValue == null ? null : redacted ? REDACTED : rawValue,
        redacted,
      };
    });

    const data: StorageCollectorData = {
      cookieCount: normalizedCookies.length,
      localStorageKeyCount: normalizedLocalStorage.length,
      cookies: normalizedCookies,
      localStorage: normalizedLocalStorage,
    };

    const outputPath = path.join(ctx.checkpointDir, 'storage-state.json');
    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'storage-state',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        cookieCount: data.cookieCount,
        localStorageKeyCount: data.localStorageKeyCount,
      },
    };
  },
};

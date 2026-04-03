import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointCollector,
  FormFieldState,
  FormFieldValue,
  FormsCollectorData,
} from '../types';

const REDACTED = '[REDACTED]';
const DEFAULT_REDACT_PATTERNS = ['password', 'token', 'secret', 'api[_-]?key', 'authorization', 'bearer'];
const EMAIL_LIKE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RawFieldState = Omit<FormFieldState, 'redacted'>;

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

function redactionRegexes(ctx: { redact: string[]; config: Record<string, unknown> }): RegExp[] {
  const fromConfig = Array.isArray(ctx.config.redact)
    ? ctx.config.redact.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return [...DEFAULT_REDACT_PATTERNS, ...ctx.redact, ...fromConfig]
    .map((pattern) => toRegex(pattern))
    .filter((value): value is RegExp => value instanceof RegExp);
}

function shouldRedactText(value: string, regexes: RegExp[]): boolean {
  if (EMAIL_LIKE_REGEX.test(value.trim())) {
    return true;
  }

  return regexes.some((regex) => regex.test(value));
}

function fieldIdentifier(field: RawFieldState): string {
  return [field.type, field.name, field.id, field.label, field.placeholder].filter((value): value is string => !!value).join(' ');
}

function redactValue(value: FormFieldValue): FormFieldValue {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(() => REDACTED);
  }

  return REDACTED;
}

function fieldNeedsRedaction(field: RawFieldState, regexes: RegExp[]): boolean {
  if (shouldRedactText(fieldIdentifier(field), regexes)) {
    return true;
  }

  if (field.value == null) {
    return false;
  }

  if (Array.isArray(field.value)) {
    return field.value.some((entry) => shouldRedactText(entry, regexes));
  }

  return shouldRedactText(field.value, regexes);
}

export const formsCollector: CheckpointCollector = {
  name: 'forms',
  defaultEnabled: false,

  async collect(ctx) {
    const rawFields = await ctx.page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('input, select, textarea'));

      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : null;
        if (inputType === 'hidden') {
          return false;
        }

        if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const readLabel = (element: Element): string | null => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          const fromLabels = element.labels && element.labels.length > 0 ? element.labels[0]?.textContent?.trim() : null;
          if (fromLabels) {
            return fromLabels;
          }
        }

        return element.getAttribute('aria-label')?.trim() ?? null;
      };

      const readValue = (element: Element): { value: string | string[] | null; checked: boolean | null; type: string | null } => {
        if (element instanceof HTMLSelectElement) {
          if (element.multiple) {
            return {
              value: Array.from(element.selectedOptions).map((option) => option.value),
              checked: null,
              type: 'select-multiple',
            };
          }

          return {
            value: element.value,
            checked: null,
            type: 'select-one',
          };
        }

        if (element instanceof HTMLTextAreaElement) {
          return {
            value: element.value,
            checked: null,
            type: 'textarea',
          };
        }

        if (element instanceof HTMLInputElement) {
          const inputType = element.type.toLowerCase();
          if (inputType === 'checkbox' || inputType === 'radio') {
            return {
              value: element.checked ? element.value || 'on' : null,
              checked: element.checked,
              type: inputType,
            };
          }

          if (inputType === 'file') {
            return {
              value: element.files ? Array.from(element.files).map((file) => file.name) : [],
              checked: null,
              type: inputType,
            };
          }

          return {
            value: element.value,
            checked: null,
            type: inputType || null,
          };
        }

        return {
          value: null,
          checked: null,
          type: null,
        };
      };

      return elements
        .filter((element) => isVisible(element))
        .map((element) => {
          const { value, checked, type } = readValue(element);

          return {
            tagName: element.tagName.toLowerCase() as 'input' | 'select' | 'textarea',
            type,
            name: element.getAttribute('name'),
            id: element.getAttribute('id'),
            label: readLabel(element),
            placeholder: element.getAttribute('placeholder'),
            value,
            checked,
            disabled: (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled,
            required: (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).required,
          };
        });
    });

    const regexes = redactionRegexes({ redact: ctx.redact, config: ctx.config });
    let redactedCount = 0;

    const fields: FormFieldState[] = (rawFields as RawFieldState[]).map((field) => {
      const redacted = fieldNeedsRedaction(field, regexes);
      if (redacted) {
        redactedCount += 1;
      }

      return {
        ...field,
        redacted,
        value: redacted ? redactValue(field.value) : field.value,
      };
    });

    const data: FormsCollectorData = {
      fieldCount: fields.length,
      redactedCount,
      fields,
    };

    const outputPath = path.join(ctx.checkpointDir, 'form-state.json');
    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'form-state',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        fieldCount: data.fieldCount,
        redactedCount: data.redactedCount,
      },
    };
  },
};

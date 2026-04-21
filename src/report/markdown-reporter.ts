import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointRecord, ReportGenerator, RunRecord, ScreenshotCollectorData } from '../types';
import { warn } from '../core';
import { groupByStory } from './story-utils';

type MarkdownReporterConfig = {
  storiesDir?: string;
  screenshotsDir?: string;
  includeTags?: string[];
  preferredProject?: string;
  header?: string;
  footer?: string;
  frontmatter?: boolean | Record<string, unknown>;
  imagePathPrefix?: string;
  copyScreenshots?: boolean;
  requireExplicitStep?: boolean;
};

type MarkdownStep = {
  checkpoint: CheckpointRecord;
  order: number;
  heading: string;
  description: string;
  imagePath: string | null;
  urlLabel: string;
  breadcrumbLabel: string | null;
  focusNote: string | null;
};

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'story'
  );
}

function stripTags(value: string): string {
  const stripped = value.replace(/\s+@[a-z0-9-]+/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripped || value.trim() || 'Untitled story';
}

function articleTitle(run: RunRecord): string {
  const override = run.article?.title?.trim();
  return override || stripTags(run.title);
}

function articleDescription(run: RunRecord): string | null {
  const description = run.article?.description?.trim();
  return description ? description : null;
}

function articleSlug(run: RunRecord): string {
  const override = run.article?.slug?.trim();
  return slugify(override || stripTags(run.title));
}

function normalizeConfig(config: Record<string, unknown>): MarkdownReporterConfig {
  return {
    storiesDir: typeof config.storiesDir === 'string' ? config.storiesDir : '.',
    screenshotsDir: typeof config.screenshotsDir === 'string' ? config.screenshotsDir : 'screenshots',
    includeTags: Array.isArray(config.includeTags)
      ? config.includeTags.filter((value): value is string => typeof value === 'string')
      : undefined,
    preferredProject: typeof config.preferredProject === 'string' ? config.preferredProject : undefined,
    header: typeof config.header === 'string' ? config.header : undefined,
    footer: typeof config.footer === 'string' ? config.footer : undefined,
    frontmatter:
      config.frontmatter === true ||
      config.frontmatter === false ||
      (config.frontmatter != null && typeof config.frontmatter === 'object' && !Array.isArray(config.frontmatter))
        ? (config.frontmatter as MarkdownReporterConfig['frontmatter'])
        : false,
    imagePathPrefix: typeof config.imagePathPrefix === 'string' ? config.imagePathPrefix : undefined,
    copyScreenshots: typeof config.copyScreenshots === 'boolean' ? config.copyScreenshots : true,
    requireExplicitStep: typeof config.requireExplicitStep === 'boolean' ? config.requireExplicitStep : false,
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function shouldIncludeRun(run: RunRecord, config: MarkdownReporterConfig): boolean {
  const includeTags = normalizeTags(config.includeTags);
  if (includeTags.length > 0) {
    const runTags = new Set(normalizeTags(run.tags));
    return includeTags.some((tag) => runTags.has(tag));
  }

  return run.checkpoints.some((checkpoint) => {
    const hasDescription = typeof checkpoint.description === 'string' && checkpoint.description.trim().length > 0;
    return hasDescription || typeof checkpoint.step === 'number';
  });
}

function choosePrimaryRun(runs: RunRecord[], preferredProject?: string): RunRecord | null {
  if (runs.length === 0) {
    return null;
  }

  return [...runs].sort((left, right) => {
    const leftPreferred = preferredProject && left.project === preferredProject ? 0 : 1;
    const rightPreferred = preferredProject && right.project === preferredProject ? 0 : 1;
    if (leftPreferred !== rightPreferred) {
      return leftPreferred - rightPreferred;
    }

    const rightTime = new Date(right.startedAt).getTime();
    const leftTime = new Date(left.startedAt).getTime();
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return left.project.localeCompare(right.project);
  })[0] ?? null;
}

function resolveArtifactPath(run: RunRecord, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(path.dirname(run.sourceManifestPath), artifactPath);
}

function screenshotSourcePath(run: RunRecord, checkpoint: CheckpointRecord): string | null {
  const artifacts = checkpoint.collectors.screenshot?.artifacts ?? [];
  const artifact = artifacts.find((entry) => entry.name === 'screenshot') ?? artifacts[0];
  return artifact?.path ? resolveArtifactPath(run, artifact.path) : null;
}

function screenshotData(checkpoint: CheckpointRecord): Partial<ScreenshotCollectorData> | null {
  const data = checkpoint.collectors.screenshot?.data;
  return data && typeof data === 'object' ? (data as Partial<ScreenshotCollectorData>) : null;
}

function focusNote(checkpoint: CheckpointRecord): string | null {
  const data = screenshotData(checkpoint);
  const selector = typeof data?.highlightSelector === 'string' ? data.highlightSelector.trim() : '';
  if (selector) {
    return `Focus: \`${selector}\``;
  }

  const bounds = data?.highlightBounds;
  if (
    bounds &&
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number'
  ) {
    return 'Focus: highlighted UI element.';
  }

  return null;
}

function urlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const value = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return value || '/';
  } catch {
    return url || '/';
  }
}

function breadcrumbLabel(url: string): string | null {
  const label = urlLabel(url);
  if (!label.startsWith('/')) {
    return null;
  }

  const [withoutQuery = label] = label.split('?');
  const [withoutHash = withoutQuery] = withoutQuery.split('#');

  const segments = withoutHash
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment).replace(/[-_]+/g, ' '));

  return segments.length > 0 ? segments.join(' › ') : 'home';
}

function autoDescription(checkpoint: CheckpointRecord): string {
  const pageTitle = checkpoint.title.trim();
  const location = urlLabel(checkpoint.url);

  if (pageTitle) {
    return `This step captures **${pageTitle}** at \`${location}\`.`;
  }

  return `This step captures **${checkpoint.name}** at \`${location}\`.`;
}

function markdownRelativePath(fromFile: string, toFile: string): string {
  const relativePath = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/');
  if (relativePath.startsWith('.')) {
    return relativePath;
  }

  return `./${relativePath}`;
}

function rewriteImagePath(markdownFile: string, imageFile: string, outputDir: string, prefix?: string): string {
  const relativePath = path.relative(outputDir, imageFile).split(path.sep).join('/');
  if (prefix) {
    return `${prefix.replace(/\/+$/g, '')}/${relativePath.replace(/^\/+/, '')}`;
  }

  return markdownRelativePath(markdownFile, imageFile);
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(value);
}

function serializeFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      if (value.length === 0) {
        lines.push('  []');
        continue;
      }

      for (const item of value) {
        lines.push(`  - ${yamlScalar(item)}`);
      }
      continue;
    }

    lines.push(`${key}: ${yamlScalar(value)}`);
  }

  lines.push('---', '');
  return lines.join('\n');
}

async function materializeScreenshot(args: {
  run: RunRecord;
  checkpoint: CheckpointRecord;
  storySlug: string;
  stepOrder: number;
  outputDir: string;
  markdownFile: string;
  config: MarkdownReporterConfig;
  writtenFiles: Set<string>;
}): Promise<string | null> {
  const sourcePath = screenshotSourcePath(args.run, args.checkpoint);
  if (!sourcePath) {
    return null;
  }

  const extension = path.extname(sourcePath) || '.png';
  const targetPath = path.join(
    args.outputDir,
    args.config.screenshotsDir ?? 'screenshots',
    args.storySlug,
    `${String(args.stepOrder).padStart(2, '0')}-${slugify(args.checkpoint.name)}${extension}`,
  );

  try {
    if (args.config.copyScreenshots !== false) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      args.writtenFiles.add(targetPath);
      return rewriteImagePath(args.markdownFile, targetPath, args.outputDir, args.config.imagePathPrefix);
    }

    return rewriteImagePath(args.markdownFile, sourcePath, args.outputDir, args.config.imagePathPrefix);
  } catch {
    return null;
  }
}

function orderedCheckpoints(checkpoints: CheckpointRecord[]): CheckpointRecord[] {
  return [...checkpoints].sort((left, right) => {
    const leftOrder = typeof left.step === 'number' ? left.step : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.step === 'number' ? right.step : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return checkpoints.indexOf(left) - checkpoints.indexOf(right);
  });
}

async function buildSteps(args: {
  run: RunRecord;
  storySlug: string;
  outputDir: string;
  markdownFile: string;
  config: MarkdownReporterConfig;
  writtenFiles: Set<string>;
}): Promise<MarkdownStep[]> {
  const checkpoints = orderedCheckpoints(args.run.checkpoints).filter(
    (checkpoint) => !args.config.requireExplicitStep || typeof checkpoint.step === 'number',
  );
  const steps: MarkdownStep[] = [];

  for (const [index, checkpoint] of checkpoints.entries()) {
    const order = typeof checkpoint.step === 'number' ? checkpoint.step : index + 1;
    steps.push({
      checkpoint,
      order,
      heading: checkpoint.name,
      description:
        typeof checkpoint.description === 'string' && checkpoint.description.trim().length > 0
          ? checkpoint.description.trim()
          : autoDescription(checkpoint),
      imagePath: await materializeScreenshot({
        run: args.run,
        checkpoint,
        storySlug: args.storySlug,
        stepOrder: order,
        outputDir: args.outputDir,
        markdownFile: args.markdownFile,
        config: args.config,
        writtenFiles: args.writtenFiles,
      }),
      urlLabel: urlLabel(checkpoint.url),
      breadcrumbLabel: breadcrumbLabel(checkpoint.url),
      focusNote: focusNote(checkpoint),
    });
  }

  return steps;
}

function renderMarkdown(args: {
  title: string;
  description?: string | null;
  steps: MarkdownStep[];
  run: RunRecord;
  config: MarkdownReporterConfig;
  generatedAt: string;
}): string {
  const frontmatterFields =
    args.config.frontmatter === true || typeof args.config.frontmatter === 'object'
      ? {
          project: args.run.project,
          tags: args.run.tags,
          ...(args.config.frontmatter && typeof args.config.frontmatter === 'object' ? args.config.frontmatter : {}),
          ...(args.run.article?.frontmatter ?? {}),
          testId: args.run.testId,
          startedAt: args.run.startedAt,
          generatedAt: args.generatedAt,
          title: args.title,
        }
      : null;

  const sections = args.steps
    .map((step) => {
      const lines = [`## Step ${step.order}: ${step.heading}`, ''];

      if (step.imagePath) {
        lines.push(`![${step.checkpoint.title || step.heading}](${step.imagePath})`, '');
      }

      lines.push(`**URL:** \`${step.urlLabel}\``);
      if (step.breadcrumbLabel) {
        lines.push('', `**Breadcrumb:** ${step.breadcrumbLabel}`);
      }

      if (step.focusNote) {
        lines.push('', `> ${step.focusNote}`);
      }

      lines.push('', step.description);

      return lines.join('\n');
    })
    .join('\n\n');

  const parts = [
    frontmatterFields ? serializeFrontmatter(frontmatterFields) : '',
    `# ${args.title}`,
    args.description?.trim() ?? '',
    args.config.header ? args.config.header.trim() : '',
    sections,
    args.config.footer ? args.config.footer.trim() : '',
  ].filter((value) => value.trim().length > 0);

  return `${parts.join('\n\n')}\n`;
}

export const markdownReporter: ReportGenerator = {
  name: 'markdown',
  description: 'Generates one Markdown help article per captured story.',

  validateConfig(config): boolean {
    return config != null && typeof config === 'object' && !Array.isArray(config);
  },

  async generate(context) {
    const config = normalizeConfig(context.config);
    const stories = groupByStory(context.runs);
    const generatedAt = new Date().toISOString();
    const writtenFiles = new Set<string>();
    const usedStorySlugs = new Set<string>();
    let articleCount = 0;

    for (const [storyTitle, runs] of stories) {
      const primaryRun = choosePrimaryRun(runs, config.preferredProject);
      if (!primaryRun || !shouldIncludeRun(primaryRun, config)) {
        continue;
      }

      const title = articleTitle(primaryRun);
      const baseStorySlug = articleSlug(primaryRun);
      let storySlug = baseStorySlug;
      if (usedStorySlugs.has(storySlug)) {
        let index = 2;
        while (usedStorySlugs.has(`${baseStorySlug}-${index}`)) {
          index += 1;
        }
        storySlug = `${baseStorySlug}-${index}`;
        warn(`Markdown article slug collision for "${storyTitle}" resolved as "${storySlug}".`);
      }
      usedStorySlugs.add(storySlug);
      const markdownFile = path.join(context.outputDir, config.storiesDir ?? '.', `${storySlug}.md`);
      const steps = await buildSteps({
        run: primaryRun,
        storySlug,
        outputDir: context.outputDir,
        markdownFile,
        config,
        writtenFiles,
      });
      if (steps.length === 0) {
        continue;
      }

      await fs.mkdir(path.dirname(markdownFile), { recursive: true });
      await fs.writeFile(
        markdownFile,
        renderMarkdown({
          title,
          description: articleDescription(primaryRun),
          steps,
          run: primaryRun,
          config,
          generatedAt,
        }),
        'utf8',
      );

      writtenFiles.add(markdownFile);
      articleCount += 1;
    }

    return {
      files: [...writtenFiles],
      summary: `Generated ${articleCount} Markdown article${articleCount === 1 ? '' : 's'}.`,
    };
  },
};

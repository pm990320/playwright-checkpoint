import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointRecord, ReportGenerator, RunRecord, ScreenshotCollectorData } from '../types';
import { groupByStory } from './story-utils';

type MdxReporterConfig = {
  storiesDir?: string;
  screenshotsDir?: string;
  includeTags?: string[];
  preferredProject?: string;
  imagePathPrefix?: string;
  copyScreenshots?: boolean;
  componentImportPath?: string;
};

type MdxVariant = {
  project: string;
  projectLabel: string;
  imagePath: string | null;
  imageAlt: string;
};

type MdxStep = {
  checkpoint: CheckpointRecord;
  order: number;
  title: string;
  description: string;
  focusNote: string | null;
  variants: MdxVariant[];
};

const DEFAULT_PROJECT_ORDER = ['desktop-light', 'desktop-dark', 'mobile-light', 'mobile-dark'];

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

function normalizeConfig(config: Record<string, unknown>): MdxReporterConfig {
  return {
    storiesDir: typeof config.storiesDir === 'string' ? config.storiesDir : '.',
    screenshotsDir: typeof config.screenshotsDir === 'string' ? config.screenshotsDir : 'screenshots',
    includeTags: Array.isArray(config.includeTags)
      ? config.includeTags.filter((value): value is string => typeof value === 'string')
      : undefined,
    preferredProject: typeof config.preferredProject === 'string' ? config.preferredProject : undefined,
    imagePathPrefix: typeof config.imagePathPrefix === 'string' ? config.imagePathPrefix : undefined,
    copyScreenshots: typeof config.copyScreenshots === 'boolean' ? config.copyScreenshots : true,
    componentImportPath:
      typeof config.componentImportPath === 'string' ? config.componentImportPath : 'playwright-checkpoint/components',
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function frontmatterTags(tags: string[]): string[] {
  return normalizeTags(tags).map((tag) => tag.replace(/^@+/, '')).filter(Boolean);
}

function shouldIncludeRun(run: RunRecord, config: MdxReporterConfig): boolean {
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

function rewriteImagePath(mdxFile: string, imageFile: string, outputDir: string, prefix?: string): string {
  const relativePath = path.relative(outputDir, imageFile).split(path.sep).join('/');
  if (prefix) {
    return `${prefix.replace(/\/+$/g, '')}/${relativePath.replace(/^\/+/, '')}`;
  }

  return markdownRelativePath(mdxFile, imageFile);
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

function quoteJsx(value: string): string {
  return JSON.stringify(value);
}

function projectWeight(projectName: string): number {
  const index = DEFAULT_PROJECT_ORDER.indexOf(projectName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function formatProjectLabel(projectName: string): string {
  const [device, mode] = projectName.split('-');
  if (!device || !mode) {
    return projectName;
  }

  const deviceLabel = device === 'desktop' ? 'Desktop' : device === 'mobile' ? 'Mobile' : device;
  const modeLabel = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : mode;
  return `${deviceLabel} / ${modeLabel}`;
}

function sortRunsForVariants(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((left, right) => {
    const byWeight = projectWeight(left.project) - projectWeight(right.project);
    if (byWeight !== 0) {
      return byWeight;
    }

    return left.project.localeCompare(right.project);
  });
}

function findMatchingCheckpoint(run: RunRecord, baseCheckpoint: CheckpointRecord, fallbackIndex: number): CheckpointRecord | null {
  const checkpoints = orderedCheckpoints(run.checkpoints);

  if (typeof baseCheckpoint.step === 'number') {
    const byStep = checkpoints.find((entry) => entry.step === baseCheckpoint.step);
    if (byStep) {
      return byStep;
    }
  }

  const byName = checkpoints.find((entry) => entry.name === baseCheckpoint.name);
  if (byName) {
    return byName;
  }

  return checkpoints[fallbackIndex] ?? null;
}

async function materializeScreenshot(args: {
  run: RunRecord;
  checkpoint: CheckpointRecord;
  storySlug: string;
  stepOrder: number;
  outputDir: string;
  mdxFile: string;
  config: MdxReporterConfig;
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
    `${String(args.stepOrder).padStart(2, '0')}-${slugify(args.run.project)}-${slugify(args.checkpoint.name)}${extension}`,
  );

  try {
    if (args.config.copyScreenshots !== false) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      args.writtenFiles.add(targetPath);
      return rewriteImagePath(args.mdxFile, targetPath, args.outputDir, args.config.imagePathPrefix);
    }

    return rewriteImagePath(args.mdxFile, sourcePath, args.outputDir, args.config.imagePathPrefix);
  } catch {
    return null;
  }
}

async function buildSteps(args: {
  runs: RunRecord[];
  primaryRun: RunRecord;
  storySlug: string;
  outputDir: string;
  mdxFile: string;
  config: MdxReporterConfig;
  writtenFiles: Set<string>;
}): Promise<MdxStep[]> {
  const baseCheckpoints = orderedCheckpoints(args.primaryRun.checkpoints);
  const sortedRuns = sortRunsForVariants(args.runs);
  const steps: MdxStep[] = [];

  for (const [index, checkpoint] of baseCheckpoints.entries()) {
    const order = typeof checkpoint.step === 'number' ? checkpoint.step : index + 1;
    const variants: MdxVariant[] = [];
    const matchedCheckpoints: CheckpointRecord[] = [];

    for (const run of sortedRuns) {
      const variantCheckpoint = findMatchingCheckpoint(run, checkpoint, index);
      if (!variantCheckpoint) {
        continue;
      }

      matchedCheckpoints.push(variantCheckpoint);
      variants.push({
        project: run.project,
        projectLabel: formatProjectLabel(run.project),
        imagePath: await materializeScreenshot({
          run,
          checkpoint: variantCheckpoint,
          storySlug: args.storySlug,
          stepOrder: order,
          outputDir: args.outputDir,
          mdxFile: args.mdxFile,
          config: args.config,
          writtenFiles: args.writtenFiles,
        }),
        imageAlt: variantCheckpoint.title || `${checkpoint.name} (${formatProjectLabel(run.project)})`,
      });
    }

    const descriptionSource = matchedCheckpoints.find(
      (entry) => typeof entry.description === 'string' && entry.description.trim().length > 0,
    ) ?? checkpoint;
    const stepFocus = matchedCheckpoints.map((entry) => focusNote(entry)).find((value): value is string => Boolean(value)) ?? null;

    steps.push({
      checkpoint,
      order,
      title: checkpoint.name,
      description:
        typeof descriptionSource.description === 'string' && descriptionSource.description.trim().length > 0
          ? descriptionSource.description.trim()
          : autoDescription(descriptionSource),
      focusNote: stepFocus,
      variants,
    });
  }

  return steps;
}

function renderVariantTabs(variants: MdxVariant[]): string {
  if (variants.length === 0) {
    return '';
  }

  if (variants.length === 1) {
    const [variant] = variants;
    if (!variant?.imagePath) {
      return '';
    }

    return `<Screenshot src={${quoteJsx(variant.imagePath)}} alt={${quoteJsx(variant.imageAlt)}} />`;
  }

  const tabs = variants
    .map((variant) => {
      const lines = [`  <DeviceTab label={${quoteJsx(variant.projectLabel)}}>`];
      if (variant.imagePath) {
        lines.push(`    <Screenshot src={${quoteJsx(variant.imagePath)}} alt={${quoteJsx(variant.imageAlt)}} />`);
      } else {
        lines.push(`    <p>No screenshot captured for ${variant.projectLabel}.</p>`);
      }
      lines.push('  </DeviceTab>');
      return lines.join('\n');
    })
    .join('\n');

  return `<DeviceTabs>\n${tabs}\n</DeviceTabs>`;
}

function renderStep(step: MdxStep): string {
  const lines = [`  <Step number={${step.order}} title={${quoteJsx(step.title)}}>`];
  const variantBlock = renderVariantTabs(step.variants);
  if (variantBlock) {
    lines.push(`    ${variantBlock.replace(/\n/g, '\n    ')}`, '');
  }

  if (step.focusNote) {
    lines.push(`    ${step.focusNote}`, '');
  }

  lines.push(`    ${step.description}`, '  </Step>');
  return lines.join('\n');
}

function renderMdx(args: {
  title: string;
  steps: MdxStep[];
  runs: RunRecord[];
  config: MdxReporterConfig;
  generatedAt: string;
}): string {
  const importNames = new Set(['Screenshot', 'StepList', 'Step']);
  if (args.steps.some((step) => step.variants.length > 1)) {
    importNames.add('DeviceTabs');
    importNames.add('DeviceTab');
  }

  const frontmatter = serializeFrontmatter({
    title: args.title,
    tags: frontmatterTags([...new Set(args.runs.flatMap((run) => run.tags))]),
    generatedAt: args.generatedAt,
    projects: [...new Set(args.runs.map((run) => run.project))],
  });

  const stepBlocks = args.steps.map(renderStep).join('\n\n');

  return `${frontmatter}import { ${[...importNames].join(', ')} } from '${args.config.componentImportPath}';\n\n<StepList>\n${stepBlocks}\n</StepList>\n`;
}

export const mdxReporter: ReportGenerator = {
  name: 'mdx',
  description: 'Generates one MDX help article per captured story.',

  validateConfig(config): boolean {
    return config != null && typeof config === 'object' && !Array.isArray(config);
  },

  async generate(context) {
    const config = normalizeConfig(context.config);
    const stories = groupByStory(context.runs);
    const generatedAt = new Date().toISOString();
    const writtenFiles = new Set<string>();
    let articleCount = 0;

    for (const [storyTitle, runs] of stories) {
      const primaryRun = choosePrimaryRun(runs, config.preferredProject);
      if (!primaryRun || !shouldIncludeRun(primaryRun, config)) {
        continue;
      }

      const title = stripTags(storyTitle);
      const storySlug = slugify(title);
      const mdxFile = path.join(context.outputDir, config.storiesDir ?? '.', `${storySlug}.mdx`);
      const steps = await buildSteps({
        runs,
        primaryRun,
        storySlug,
        outputDir: context.outputDir,
        mdxFile,
        config,
        writtenFiles,
      });

      await fs.mkdir(path.dirname(mdxFile), { recursive: true });
      await fs.writeFile(
        mdxFile,
        renderMdx({
          title,
          steps,
          runs,
          config,
          generatedAt,
        }),
        'utf8',
      );

      writtenFiles.add(mdxFile);
      articleCount += 1;
    }

    return {
      files: [...writtenFiles],
      summary: `Generated ${articleCount} MDX article${articleCount === 1 ? '' : 's'}.`,
    };
  },
};

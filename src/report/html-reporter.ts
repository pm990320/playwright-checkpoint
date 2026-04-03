import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointRecord, ReportGenerator, RunRecord } from '../types';
import { groupByStory, orderedCheckpointNames } from './index';

type HtmlReporterConfig = {
  title?: string;
  projectOrder?: string[];
};

const DEFAULT_PROJECT_ORDER = ['desktop-light', 'desktop-dark', 'mobile-light', 'mobile-dark'];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'story'
  );
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function projectWeight(projectName: string, projectOrder: string[]): number {
  const index = projectOrder.indexOf(projectName);
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

function sortByProjectAndTime(a: RunRecord, b: RunRecord, projectOrder: string[]): number {
  const byProject = projectWeight(a.project, projectOrder) - projectWeight(b.project, projectOrder);
  if (byProject !== 0) {
    return byProject;
  }

  const byProjectName = a.project.localeCompare(b.project);
  if (byProjectName !== 0) {
    return byProjectName;
  }

  return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
}

function getCollectorSummaryNumber(checkpoint: CheckpointRecord, collectorName: string, key: string): number | null {
  const value = checkpoint.collectors[collectorName]?.summary[key];
  return typeof value === 'number' ? value : null;
}

function resolveArtifactPath(run: RunRecord, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(path.dirname(run.sourceManifestPath), artifactPath);
}

function toEncodedHref(outputDir: string, filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const relativePath = path.relative(outputDir, filePath);
  return relativePath.split(path.sep).map(encodeURIComponent).join('/');
}

function getArtifactHref(
  run: RunRecord,
  checkpoint: CheckpointRecord,
  outputDir: string,
  collectorName: string,
  artifactName?: string,
): string | null {
  const artifacts = checkpoint.collectors[collectorName]?.artifacts ?? [];
  const artifact = artifactName
    ? artifacts.find((entry) => entry.name === artifactName)
    : artifacts[0];

  if (!artifact?.path) {
    return null;
  }

  return toEncodedHref(outputDir, resolveArtifactPath(run, artifact.path));
}

function renderArtifactLinks(run: RunRecord, checkpoint: CheckpointRecord, outputDir: string): string {
  const links: Array<{ label: string; href: string | null }> = [
    { label: 'DOM HTML', href: getArtifactHref(run, checkpoint, outputDir, 'html', 'html') },
    { label: 'Axe', href: getArtifactHref(run, checkpoint, outputDir, 'axe', 'axe') },
    { label: 'Web Vitals', href: getArtifactHref(run, checkpoint, outputDir, 'web-vitals', 'web-vitals') },
    { label: 'Console', href: getArtifactHref(run, checkpoint, outputDir, 'console', 'console-errors') },
    { label: 'Failed Requests', href: getArtifactHref(run, checkpoint, outputDir, 'network', 'failed-requests') },
  ];

  return links
    .map((link) => {
      if (!link.href) {
        return `<span class="artifact disabled">${escapeHtml(link.label)}</span>`;
      }

      return `<a class="artifact" href="${link.href}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`;
    })
    .join('');
}

function renderCheckpointCard(run: RunRecord, checkpointName: string, outputDir: string): string {
  const checkpoint = run.checkpoints.find((entry) => entry.name === checkpointName);
  if (!checkpoint) {
    return `
      <article class="variant-card missing">
        <header class="variant-card-header">
          <div>
            <h5>${escapeHtml(formatProjectLabel(run.project))}</h5>
            <p>${escapeHtml(run.project)}</p>
          </div>
          <time>${escapeHtml(formatDateTime(run.startedAt))}</time>
        </header>
        <div class="empty-card">No checkpoint captured for this run.</div>
      </article>
    `;
  }

  const screenshotHref = getArtifactHref(run, checkpoint, outputDir, 'screenshot', 'screenshot');
  const axeViolations = getCollectorSummaryNumber(checkpoint, 'axe', 'violations');
  const consoleErrors = getCollectorSummaryNumber(checkpoint, 'console', 'consoleErrorCount') ?? 0;
  const failedRequests = getCollectorSummaryNumber(checkpoint, 'network', 'failedRequestCount') ?? 0;

  return `
    <article class="variant-card">
      <header class="variant-card-header">
        <div>
          <h5>${escapeHtml(formatProjectLabel(run.project))}</h5>
          <p>${escapeHtml(run.project)}</p>
        </div>
        <time>${escapeHtml(formatDateTime(checkpoint.timestamp || run.startedAt))}</time>
      </header>
      <p class="page-meta">
        <span>${escapeHtml(checkpoint.title || 'Untitled page')}</span>
        <span class="page-url">${escapeHtml(checkpoint.url)}</span>
      </p>
      ${
        screenshotHref
          ? `<a class="thumbnail-link" href="${screenshotHref}" target="_blank" rel="noreferrer"><img src="${screenshotHref}" alt="${escapeHtml(`${run.project} — ${checkpoint.name}`)}" loading="lazy" /></a>`
          : '<div class="empty-card">Screenshot unavailable.</div>'
      }
      <div class="stats-grid">
        <span><strong>${axeViolations ?? 'n/a'}</strong><small>Axe violations</small></span>
        <span><strong>${consoleErrors}</strong><small>Console errors</small></span>
        <span><strong>${failedRequests}</strong><small>Failed requests</small></span>
      </div>
      <div class="artifact-list">${renderArtifactLinks(run, checkpoint, outputDir)}</div>
    </article>
  `;
}

function renderStorySection(title: string, runs: RunRecord[], outputDir: string): string {
  const checkpointNames = orderedCheckpointNames(runs);
  const environments = [...new Set(runs.map((run) => run.environment))].sort();
  const tags = [...new Set(runs.flatMap((run) => run.tags))].sort();

  const checkpointBlocks = checkpointNames
    .map(
      (checkpointName) => `
        <details class="accordion checkpoint-block">
          <summary class="checkpoint-summary">
            <span>${escapeHtml(checkpointName)}</span>
            <span class="checkpoint-meta">${runs.length} variants</span>
          </summary>
          <div class="variant-grid">
            ${runs.map((run) => renderCheckpointCard(run, checkpointName, outputDir)).join('')}
          </div>
        </details>
      `,
    )
    .join('');

  return `
    <details class="accordion story-block" id="story-${slugify(title)}" open>
      <summary class="story-summary">
        <span class="story-title">${escapeHtml(title)}</span>
        <span class="story-meta-chip">${runs.length} run${runs.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="story-body">
        <div class="story-meta-row">
          <span><strong>Projects</strong> ${escapeHtml(runs.map((run) => run.project).join(', '))}</span>
          <span><strong>Environments</strong> ${escapeHtml(environments.join(', ') || 'n/a')}</span>
          <span><strong>Tags</strong> ${escapeHtml(tags.join(', ') || 'none')}</span>
        </div>
        ${checkpointBlocks || '<p class="empty-state">No checkpoints captured for this story.</p>'}
      </div>
    </details>
  `;
}

function buildHtmlReport(runs: RunRecord[], outputDir: string, config: HtmlReporterConfig): string {
  const groupedRuns = groupByStory(runs);
  const storyTitles = [...groupedRuns.keys()].sort((a, b) => a.localeCompare(b));
  const projectOrder = Array.isArray(config.projectOrder)
    ? config.projectOrder.filter((value): value is string => typeof value === 'string')
    : DEFAULT_PROJECT_ORDER;
  const generatedAt = new Date().toISOString();
  const reportTitle = typeof config.title === 'string' && config.title.trim() ? config.title.trim() : 'Playwright Checkpoint Report';

  for (const title of storyTitles) {
    groupedRuns.get(title)?.sort((a, b) => sortByProjectAndTime(a, b, projectOrder));
  }

  const navLinks = storyTitles
    .map((title) => `<a href="#story-${slugify(title)}">${escapeHtml(title)}</a>`)
    .join('');

  const storySections = storyTitles
    .map((title) => renderStorySection(title, groupedRuns.get(title) ?? [], outputDir))
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: rgba(15, 23, 42, 0.88);
      --panel-2: rgba(17, 25, 40, 0.98);
      --text: #e5eefb;
      --muted: #9fb3c8;
      --accent: #60a5fa;
      --accent-2: #22d3ee;
      --border: rgba(148, 163, 184, 0.18);
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #fb7185;
      --shadow: 0 24px 64px rgba(2, 6, 23, 0.45);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top, rgba(96, 165, 250, 0.14), transparent 30%),
        linear-gradient(180deg, #07101f 0%, #0b1020 100%);
      color: var(--text);
    }
    a { color: inherit; }
    .page {
      width: min(1600px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 56px;
    }
    .hero {
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.84));
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .hero h1 {
      margin: 0;
      font-size: clamp(1.9rem, 2.6vw, 3rem);
      line-height: 1.1;
    }
    .hero p {
      margin: 10px 0 0;
      color: var(--muted);
      max-width: 72ch;
      line-height: 1.6;
    }
    .summary-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    .summary-pill {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.72);
      color: var(--muted);
      font-size: 0.92rem;
    }
    .summary-pill strong { color: var(--text); }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 16px;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .story-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .story-nav a,
    .toolbar button,
    .artifact {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.7);
      color: var(--text);
      text-decoration: none;
      padding: 8px 12px;
      font: inherit;
      font-size: 0.86rem;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
    }
    .toolbar button:hover,
    .story-nav a:hover,
    .artifact:hover {
      transform: translateY(-1px);
      border-color: rgba(96, 165, 250, 0.55);
      background: rgba(30, 41, 59, 0.96);
      cursor: pointer;
    }
    .content {
      display: grid;
      gap: 18px;
      margin-top: 22px;
    }
    .accordion {
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .accordion summary {
      list-style: none;
      cursor: pointer;
    }
    .accordion summary::-webkit-details-marker { display: none; }
    .story-summary,
    .checkpoint-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .story-summary {
      padding: 20px 22px;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.74));
    }
    .story-title {
      font-size: 1.1rem;
      font-weight: 700;
    }
    .story-meta-chip,
    .checkpoint-meta {
      color: var(--muted);
      font-size: 0.84rem;
      white-space: nowrap;
    }
    .story-body {
      padding: 0 22px 22px;
    }
    .story-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.5;
      margin: 4px 0 18px;
    }
    .story-meta-row strong { color: var(--text); margin-right: 6px; }
    .checkpoint-block {
      margin-top: 14px;
      border-radius: 18px;
      background: var(--panel-2);
      border: 1px solid rgba(148, 163, 184, 0.14);
    }
    .checkpoint-summary {
      padding: 16px 18px;
      font-weight: 600;
      background: rgba(15, 23, 42, 0.68);
    }
    .variant-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 14px;
      padding: 0 18px 18px;
    }
    .variant-card {
      display: grid;
      gap: 12px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.72);
      padding: 16px;
      min-height: 100%;
    }
    .variant-card.missing {
      opacity: 0.72;
      border-style: dashed;
    }
    .variant-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .variant-card-header h5 {
      margin: 0;
      font-size: 1rem;
    }
    .variant-card-header p,
    .variant-card-header time {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.83rem;
    }
    .page-meta {
      display: grid;
      gap: 4px;
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .page-url {
      overflow-wrap: anywhere;
      font-size: 0.82rem;
    }
    .thumbnail-link {
      display: block;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2, 6, 23, 0.65);
    }
    .thumbnail-link img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .stats-grid span {
      display: grid;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(2, 6, 23, 0.42);
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .stats-grid strong {
      font-size: 1.15rem;
      line-height: 1;
    }
    .stats-grid small {
      color: var(--muted);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .artifact-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .artifact.disabled {
      opacity: 0.45;
      pointer-events: none;
    }
    .empty-state,
    .empty-card {
      margin: 0;
      color: var(--muted);
      padding: 12px;
      border: 1px dashed rgba(148, 163, 184, 0.2);
      border-radius: 14px;
      background: rgba(2, 6, 23, 0.24);
    }
    @media (max-width: 720px) {
      .page {
        width: min(100vw - 20px, 1600px);
        padding-top: 18px;
      }
      .hero,
      .story-summary,
      .story-body,
      .checkpoint-summary,
      .variant-grid {
        padding-left: 16px;
        padding-right: 16px;
      }
      .variant-card-header,
      .story-summary,
      .checkpoint-summary,
      .toolbar {
        flex-direction: column;
        align-items: flex-start;
      }
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>${escapeHtml(reportTitle)}</h1>
      <p>Explore checkpoint runs by story, inspect every project variant side-by-side, and jump directly to screenshots and generated artifacts.</p>
      <div class="summary-bar">
        <span class="summary-pill"><strong>Generated</strong> ${escapeHtml(formatDateTime(generatedAt))}</span>
        <span class="summary-pill"><strong>Stories</strong> ${storyTitles.length}</span>
        <span class="summary-pill"><strong>Runs</strong> ${runs.length}</span>
        <span class="summary-pill"><strong>Output</strong> ${escapeHtml(outputDir)}</span>
      </div>
      <div class="toolbar">
        <nav class="story-nav">${navLinks || '<span class="summary-pill">No stories found</span>'}</nav>
        <div class="toolbar-actions">
          <button type="button" data-action="expand-all">Expand all</button>
          <button type="button" data-action="collapse-all">Collapse all</button>
        </div>
      </div>
    </section>
    <section class="content">
      ${storySections || '<p class="empty-state">No checkpoint manifests found.</p>'}
    </section>
  </main>
  <script>
    (() => {
      const details = Array.from(document.querySelectorAll('details.accordion'));
      const setAll = (open) => {
        details.forEach((entry) => {
          entry.open = open;
        });
      };
      document.querySelector('[data-action="expand-all"]')?.addEventListener('click', () => setAll(true));
      document.querySelector('[data-action="collapse-all"]')?.addEventListener('click', () => setAll(false));
      const revealHash = () => {
        if (!window.location.hash) {
          return;
        }
        const target = document.querySelector(window.location.hash);
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const parentDetails = target.closest('details');
        if (parentDetails instanceof HTMLDetailsElement) {
          parentDetails.open = true;
        }
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
      window.addEventListener('hashchange', revealHash);
      revealHash();
    })();
  </script>
</body>
</html>
`;
}

export const htmlReporter: ReportGenerator = {
  name: 'html',
  description: 'Responsive HTML report for checkpoint manifests.',

  validateConfig(config): boolean {
    return config != null && typeof config === 'object' && !Array.isArray(config);
  },

  async generate(context) {
    const outputFile = path.join(context.outputDir, 'index.html');
    const html = buildHtmlReport(context.runs, context.outputDir, context.config as HtmlReporterConfig);

    await fs.mkdir(context.outputDir, { recursive: true });
    await fs.writeFile(outputFile, html, 'utf8');

    const storyCount = new Set(context.runs.map((run) => run.title)).size;

    return {
      files: [outputFile],
      summary: `Generated HTML report for ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'} (${context.runs.length} run${context.runs.length === 1 ? '' : 's'}).`,
    };
  },
};

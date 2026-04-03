#!/usr/bin/env node
/* global console, process */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const exampleDir = path.join(repoRoot, 'examples', 'basic');
const resultsDir = path.join(exampleDir, 'test-results');
const reportDir = path.join(exampleDir, 'report');
const markdownDir = path.join(exampleDir, '.checkpoint-docs-markdown');
const mdxDir = path.join(exampleDir, '.checkpoint-docs-mdx');

const markdownArticle = path.join(markdownDir, 'capture-a-documented-getting-started-flow.md');
const markdownScreenshot = path.join(
  markdownDir,
  'screenshots',
  'capture-a-documented-getting-started-flow',
  '01-open-the-introduction-guide.png',
);
const mdxArticle = path.join(mdxDir, 'capture-a-documented-getting-started-flow.mdx');
const mdxScreenshot = path.join(
  mdxDir,
  'screenshots',
  'capture-a-documented-getting-started-flow',
  '01-chromium-open-the-introduction-guide.png',
);

function relativeFromRepo(targetPath) {
  return path.relative(repoRoot, targetPath) || '.';
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function assertContains(content, expected, label) {
  assert.ok(content.includes(expected), `${label} is missing expected content: ${expected}`);
}

async function listArticleFiles(directory, extension) {
  const files = await fs.readdir(directory, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}

async function run(command, args, cwd) {
  const printable = [command, ...args].join(' ');
  console.log(`\n$ (${relativeFromRepo(cwd)}) ${printable}`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${printable} exited with signal ${signal}.`
            : `${printable} exited with code ${code ?? 'unknown'}.`,
        ),
      );
    });
  });
}

async function main() {
  console.log('Preparing example/basic integration artifacts...');
  await Promise.all([
    removeIfExists(resultsDir),
    removeIfExists(reportDir),
    removeIfExists(markdownDir),
    removeIfExists(mdxDir),
  ]);

  await run('npx', ['playwright', 'test', '--workers=1'], exampleDir);

  const reportIndex = path.join(reportDir, 'index.html');
  assert.equal(await fileExists(reportIndex), true, `Expected HTML report at ${relativeFromRepo(reportIndex)}`);

  const htmlReport = await fs.readFile(reportIndex, 'utf8');
  assertContains(htmlReport, '<title>Playwright Checkpoint Report</title>', 'HTML report');
  assertContains(htmlReport, 'capture a documented getting-started flow @user-journey', 'HTML report');
  assertContains(htmlReport, 'Open the introduction guide', 'HTML report');
  assertContains(htmlReport, 'Docs navigation', 'HTML report');
  assertContains(htmlReport, 'Focus: main h1', 'HTML report');
  assertContains(htmlReport, 'a[href=&quot;/docs/intro&quot;]', 'HTML report');
  assertContains(htmlReport, 'DOM HTML', 'HTML report');
  assertContains(htmlReport, 'Axe', 'HTML report');
  assertContains(htmlReport, 'Web Vitals', 'HTML report');

  await run(
    'npx',
    [
      '--no-install',
      'playwright-checkpoint',
      'docs',
      '--format',
      'markdown',
      '--filter',
      '@user-journey',
      '--output-dir',
      markdownDir,
    ],
    exampleDir,
  );

  const markdownFiles = await listArticleFiles(markdownDir, '.md');
  assert.deepEqual(markdownFiles, ['capture-a-documented-getting-started-flow.md']);
  assert.equal(await fileExists(markdownArticle), true, `Expected Markdown article at ${relativeFromRepo(markdownArticle)}`);
  assert.equal(
    await fileExists(markdownScreenshot),
    true,
    `Expected Markdown screenshot at ${relativeFromRepo(markdownScreenshot)}`,
  );

  const markdown = await fs.readFile(markdownArticle, 'utf8');
  assertContains(markdown, '# capture a documented getting-started flow', 'Markdown article');
  assertContains(markdown, '## Step 1: Open the introduction guide', 'Markdown article');
  assertContains(markdown, '**URL:** `/docs/intro`', 'Markdown article');
  assertContains(markdown, '**Breadcrumb:** docs › intro', 'Markdown article');
  assertContains(markdown, '> Focus: `main h1`', 'Markdown article');
  assertContains(
    markdown,
    'Open the Playwright introduction guide to review the install steps and first-test walkthrough.',
    'Markdown article',
  );
  assertContains(
    markdown,
    './screenshots/capture-a-documented-getting-started-flow/01-open-the-introduction-guide.png',
    'Markdown article',
  );

  await run(
    'npx',
    [
      '--no-install',
      'playwright-checkpoint',
      'docs',
      '--format',
      'mdx',
      '--filter',
      '@user-journey',
      '--output-dir',
      mdxDir,
    ],
    exampleDir,
  );

  const mdxFiles = await listArticleFiles(mdxDir, '.mdx');
  assert.deepEqual(mdxFiles, ['capture-a-documented-getting-started-flow.mdx']);
  assert.equal(await fileExists(mdxArticle), true, `Expected MDX article at ${relativeFromRepo(mdxArticle)}`);
  assert.equal(await fileExists(mdxScreenshot), true, `Expected MDX screenshot at ${relativeFromRepo(mdxScreenshot)}`);

  const mdx = await fs.readFile(mdxArticle, 'utf8');
  assertContains(mdx, 'title: "capture a documented getting-started flow"', 'MDX article');
  assertContains(mdx, "import { Screenshot, StepList, Step } from 'playwright-checkpoint/components';", 'MDX article');
  assertContains(mdx, '<Step number={1} title={"Open the introduction guide"}>', 'MDX article');
  assertContains(mdx, 'Focus: `main h1`', 'MDX article');
  assertContains(
    mdx,
    'Open the Playwright introduction guide to review the install steps and first-test walkthrough.',
    'MDX article',
  );
  assertContains(
    mdx,
    './screenshots/capture-a-documented-getting-started-flow/01-chromium-open-the-introduction-guide.png',
    'MDX article',
  );

  console.log('\n✓ example/basic integration verified: Playwright run, HTML report, Markdown docs, and MDX docs');
}

main().catch((error) => {
  console.error('\nexample/basic integration failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

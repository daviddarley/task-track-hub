/**
 * Build: compile `src/` TypeScript to `dist/`, then copy the static files the
 * compiler doesn't know about (manifest, HTML, CSS, icons) alongside it.
 *
 * `tsc` emits native ES modules that Chrome loads directly, so there is no
 * bundler in the chain — what you see in devtools is the file you wrote, minus
 * the types, with a source map back to the original.
 *
 * Usage: `npm run build` / `npm run watch`
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, watch as watchFs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const STATIC_EXTENSIONS = ['.html', '.css', '.json', '.png', '.svg'];

const watch = process.argv.includes('--watch');

if (!watch) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

copyStatic();

if (watch) {
  watchStatic();
  console.log(`\nWatching. Load unpacked from: ${DIST}\n`);
  startTsc(['--watch', '--preserveWatchOutput']);
} else {
  try {
    await runTsc([]);
  } catch {
    // tsc has already printed its diagnostics; a stack trace on top adds noise.
    process.exit(1);
  }
  console.log(`\nBuilt. Load unpacked from: ${DIST}`);
}

/**
 * @param {string[]} args
 * @returns {import('node:child_process').ChildProcess}
 */
function startTsc(args) {
  // stdio is inherited so tsc's diagnostics land in the terminal unchanged.
  return spawn(tscBin(), args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runTsc(args) {
  return new Promise((resolve, reject) => {
    const child = startTsc(args);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc exited with code ${code}`));
    });
  });
}

/**
 * @returns {string}
 */
function tscBin() {
  const local = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  return existsSync(local) ? local : 'tsc';
}

/**
 * Mirror every non-TypeScript file from src/ into dist/, preserving structure.
 */
function copyStatic() {
  let count = 0;

  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!STATIC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      const target = join(DIST, relative(SRC, full));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(full, target);
      count += 1;
    }
  };

  walk(SRC);
  console.log(`copied ${count} static file(s)`);
}

function watchStatic() {
  let queued = false;

  watchFs(SRC, { recursive: true }, (_event, filename) => {
    if (!filename || !STATIC_EXTENSIONS.some((ext) => filename.endsWith(ext))) return;
    // Debounced: editors often write a file two or three times in quick succession.
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      try {
        copyStatic();
      } catch (err) {
        console.error('static copy failed:', err);
      }
    }, 50);
  });
}

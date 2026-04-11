#!/usr/bin/env node
// scripts/flux/generate.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  FLUX batch generator for Six Arrows / Fox.
//
//  One runner for every image batch we need — quiz options, design boards,
//  catalog product illustrations. Reads prompt libraries from ./prompts/*.mjs
//  and writes PNG files to ./output/<batch>/<folder>/<filename>.
//
//  Setup (one-time):
//    1. Get an OpenAI API key from https://platform.openai.com/api-keys
//    2. Add OPENAI_API_KEY=sk-... to .env at repo root
//    3. From repo root, run:  node scripts/flux/generate.mjs --help
//
//  Usage:
//    node scripts/flux/generate.mjs quiz                    # all Q7–Q12
//    node scripts/flux/generate.mjs quiz --only q7_cabinets # just one question
//    node scripts/flux/generate.mjs boards                  # all 72 boards
//    node scripts/flux/generate.mjs boards --style "Modern Farmhouse"
//    node scripts/flux/generate.mjs boards --room kitchen
//    node scripts/flux/generate.mjs quiz --dry              # print what would run
//    node scripts/flux/generate.mjs quiz --force            # overwrite existing files
//
//  Output structure:
//    scripts/flux/output/
//      quiz/
//        Q7 — Cabinet Style/
//          Shaker.png
//          ...
//      boards/
//        Modern Farmhouse/
//          kitchen/
//            The Workhorse.png
//            ...
//
//  After generation, upload each folder to Google Drive (same parent folder
//  that holds the existing Q1–Q6 folders) and the Fox quiz/board code will
//  auto-discover them by name.
// ─────────────────────────────────────────────────────────────────────────────

import fs   from 'node:fs';
import path from 'node:path';
import url  from 'node:url';
// Swap between backends by changing this import:
//   ./replicate.mjs  — FLUX 1.1 Pro via Replicate
//   ./openai.mjs     — gpt-image-1 via OpenAI (better instruction-following)
import { generateImage } from './openai.mjs';

// ── Load .env from repo root ────────────────────────────────────────────────
(function loadEnv() {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
})();

// ── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { batch: null, flags: {}, opts: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.flags.help = true; continue; }
    if (a === '--dry')   { args.flags.dry = true; continue; }
    if (a === '--force') { args.flags.force = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args.opts[key] = val;
      continue;
    }
    if (!args.batch) { args.batch = a; continue; }
  }
  return args;
}

function printHelp() {
  console.log(`
FLUX batch generator — Six Arrows / Fox

Usage:
  node scripts/flux/generate.mjs <batch> [options]

Batches:
  quiz      Q7–Q12 photo options for the extended style quiz (24 images)
  boards    Design boards — 4 rooms × 6 styles × 3 moves (72 images)

Options:
  --only <id>         Generate only the prompt set with this id (e.g. q7_cabinets)
  --style <name>      Only generate boards for this style (e.g. "Modern Farmhouse")
  --room <name>       Only generate boards for this room (kitchen|primary_bath|living|exterior)
  --force             Overwrite existing files
  --dry               Print what would run without hitting the API
  --help, -h          Show this help
`.trim());
}

// ── Batch loader ────────────────────────────────────────────────────────────
async function loadBatch(name) {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const file = path.join(__dirname, 'prompts', `${name}.mjs`);
  if (!fs.existsSync(file)) {
    throw new Error(`No prompt library for batch "${name}" at ${file}`);
  }
  const mod = await import(url.pathToFileURL(file).href);
  if (!Array.isArray(mod.JOBS)) {
    throw new Error(`${file} must export a JOBS array`);
  }
  return mod.JOBS;
}

// A "job" is a single image to generate.
// Shape:
//   {
//     id:        'q7_cabinets:A',     // unique, used for filtering + logging
//     relPath:   'Q7 — Cabinet Style/Shaker.png',
//     prompt:    'full prompt string',
//     aspectRatio: '4:3',              // optional, defaults in replicate.mjs
//     seed:      42,                   // optional
//   }

function filterJobs(jobs, opts) {
  return jobs.filter(j => {
    if (opts.only  && !j.id.startsWith(opts.only))  return false;
    if (opts.style && !j.id.toLowerCase().includes(String(opts.style).toLowerCase())) return false;
    if (opts.room  && !j.id.toLowerCase().includes(String(opts.room).toLowerCase()))  return false;
    return true;
  });
}

// ── Runner ──────────────────────────────────────────────────────────────────
async function run() {
  const args = parseArgs(process.argv);
  if (args.flags.help || !args.batch) { printHelp(); process.exit(args.batch ? 0 : 1); }

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const outRoot = path.join(__dirname, 'output', args.batch);
  fs.mkdirSync(outRoot, { recursive: true });

  const allJobs = await loadBatch(args.batch);
  const jobs    = filterJobs(allJobs, args.opts);

  if (!jobs.length) {
    console.log('No jobs matched the filter.');
    process.exit(0);
  }

  console.log(`\nFLUX batch: ${args.batch}`);
  console.log(`Jobs matched: ${jobs.length} of ${allJobs.length}`);
  console.log(`Output dir:   ${outRoot}`);
  if (args.flags.dry)   console.log('** DRY RUN — no API calls **');
  if (args.flags.force) console.log('** FORCE — existing files will be overwritten **');
  console.log('');

  let ok = 0, skip = 0, fail = 0;
  const t0 = Date.now();

  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const outPath = path.join(outRoot, j.relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const exists = fs.existsSync(outPath);
    if (exists && !args.flags.force) {
      console.log(`[${i + 1}/${jobs.length}] SKIP   ${j.relPath}  (exists — use --force)`);
      skip++;
      continue;
    }

    if (args.flags.dry) {
      console.log(`[${i + 1}/${jobs.length}] DRY    ${j.relPath}`);
      console.log(`          prompt: ${j.prompt.slice(0, 120)}${j.prompt.length > 120 ? '…' : ''}`);
      continue;
    }

    const tStart = Date.now();
    process.stdout.write(`[${i + 1}/${jobs.length}] GEN    ${j.relPath} … `);
    try {
      const { bytes } = await generateImage({
        prompt:       j.prompt,
        aspect_ratio: j.aspectRatio || '4:3',
        seed:         j.seed,
      });
      fs.writeFileSync(outPath, bytes);
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`ok (${dt}s, ${(bytes.length / 1024).toFixed(0)} KB)`);
      ok++;
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      fail++;
    }
  }

  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${total}s — ${ok} generated, ${skip} skipped, ${fail} failed.`);
  console.log(`Output: ${outRoot}`);
  if (fail) process.exit(1);
}

run().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});

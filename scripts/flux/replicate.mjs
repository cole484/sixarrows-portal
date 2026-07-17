// scripts/flux/replicate.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Minimal Replicate REST client for FLUX.1 Pro image generation.
//  No SDK — just fetch + polling. Node 18+.
//
//  Usage:
//    import { generateImage } from './replicate.mjs';
//    const buf = await generateImage({ prompt: '...', aspect_ratio: '4:3' });
//    fs.writeFileSync('out.png', buf);
// ─────────────────────────────────────────────────────────────────────────────

const REPLICATE_API = 'https://api.replicate.com/v1';

// FLUX 1.1 Pro — highest-quality FLUX variant on Replicate. Great for
// photoreal interior shots. Swap model slug here if you want FLUX dev, schnell,
// or a different checkpoint.
const MODEL = 'black-forest-labs/flux-1.1-pro';

function token() {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error('REPLICATE_API_TOKEN not set. Add it to .env.');
  return t;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// POST to Replicate with automatic retry on 429 (rate limit). Free-tier
// accounts are throttled to ~6 requests/min with burst=1; this respects
// Replicate's `retry_after` hint and transparently waits.
async function postWithRetry(url, body, { maxRetries = 8 } = {}) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token()}`,
        'Content-Type':  'application/json',
        'Prefer':        'wait=30',
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 429) return res;

    // Parse the retry_after hint (Replicate returns it in the body, not header)
    let waitSec = 10;
    try {
      const text = await res.clone().text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.retry_after === 'number') {
        waitSec = parsed.retry_after + 1; // small cushion so we land just after the window
      }
    } catch (_) { /* fall back to default */ }

    if (++attempt > maxRetries) {
      const body = await res.text();
      throw new Error(`Replicate 429 retries exhausted: ${body}`);
    }
    process.stdout.write(`(rate-limited, waiting ${waitSec}s) `);
    await sleep(waitSec * 1000);
  }
}

// Create a prediction and poll until done. Returns the final output URL array.
async function createAndWait(input, { timeoutMs = 120_000, pollMs = 1500 } = {}) {
  const createRes = await postWithRetry(
    `${REPLICATE_API}/models/${MODEL}/predictions`,
    { input },
  );

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Replicate create failed ${createRes.status}: ${body}`);
  }

  let pred = await createRes.json();

  // If 'Prefer: wait' already completed the job, we're done.
  const started = Date.now();
  while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Replicate timeout after ${timeoutMs}ms (status=${pred.status})`);
    }
    await sleep(pollMs);
    const pollRes = await fetch(`${REPLICATE_API}/predictions/${pred.id}`, {
      headers: { 'Authorization': `Bearer ${token()}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll failed ${pollRes.status}`);
    pred = await pollRes.json();
  }

  if (pred.status !== 'succeeded') {
    throw new Error(`Replicate ${pred.status}: ${pred.error || 'no error detail'}`);
  }

  // FLUX 1.1 Pro returns a single image URL as a string (not array).
  const out = pred.output;
  if (!out) throw new Error('Replicate succeeded but output was empty');
  return Array.isArray(out) ? out[0] : out;
}

// Download a URL as a Buffer. Used to fetch the image bytes Replicate returned.
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// High-level helper: prompt in → image bytes out.
//
// opts:
//   prompt         (required)  — the text prompt
//   aspect_ratio   default '4:3' — '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '4:5'
//   output_format  default 'png'  — 'png' | 'jpg' | 'webp'
//   safety_tolerance default 2 — 1 (strictest) … 6 (loosest)
//   prompt_upsampling default true — FLUX rewrites your prompt for better detail
//   seed           optional — int for reproducibility
export async function generateImage(opts) {
  const input = {
    prompt:            opts.prompt,
    aspect_ratio:      opts.aspect_ratio      || '4:3',
    output_format:     opts.output_format     || 'png',
    output_quality:    opts.output_quality    || 90,
    safety_tolerance:  opts.safety_tolerance  || 2,
    prompt_upsampling: opts.prompt_upsampling !== false,
  };
  if (opts.seed !== undefined) input.seed = opts.seed;

  const url  = await createAndWait(input);
  const data = await download(url);
  return { bytes: data, url };
}

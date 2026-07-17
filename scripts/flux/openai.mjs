// scripts/flux/openai.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  OpenAI image generation client (gpt-image-1 / dall-e-3).
//  Drop-in replacement for replicate.mjs — same export signature.
//
//  Usage:
//    import { generateImage } from './openai.mjs';
//    const { bytes } = await generateImage({ prompt: '...', aspect_ratio: '4:3' });
//    fs.writeFileSync('out.png', bytes);
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_API = 'https://api.openai.com/v1';

// Use gpt-image-1 (the model behind ChatGPT's image generation).
// Fall back to dall-e-3 if you hit access issues.
const MODEL = 'gpt-image-1';

function apiKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY not set. Add it to .env.');
  return k;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Map our aspect_ratio strings to OpenAI's size parameter.
// gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024, auto
// dall-e-3 supports: 1024x1024, 1024x1792, 1792x1024
function aspectToSize(ar) {
  switch (ar) {
    case '1:1':                    return '1024x1024';
    case '4:3': case '3:2':        return '1536x1024';  // landscape
    case '16:9':                   return '1536x1024';  // landscape (closest)
    case '3:4': case '2:3':        return '1024x1536';  // portrait
    case '9:16': case '4:5':       return '1024x1536';  // portrait (closest)
    default:                       return '1536x1024';  // default landscape
  }
}

// POST with automatic retry on 429 rate limits AND network errors.
// OpenAI image generation can take 45–90s per image; Node's fetch sometimes
// drops the connection on long-running requests. We retry with backoff.
async function postWithRetry(url, body, { maxRetries = 5 } = {}) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      // 120s timeout — generous for image generation which takes ~50s
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey()}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      // Network error or timeout — retry with backoff
      if (++attempt > maxRetries) {
        throw new Error(`OpenAI network error after ${maxRetries} retries: ${err.message}`);
      }
      const waitSec = Math.min(5 * attempt, 30);
      process.stdout.write(`(network error, retry ${attempt}/${maxRetries} in ${waitSec}s) `);
      await sleep(waitSec * 1000);
      continue;
    }

    if (res.status !== 429) return res;

    // OpenAI sends retry-after as a header (in seconds)
    let waitSec = 10;
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && !isNaN(Number(retryAfter))) {
      waitSec = Number(retryAfter) + 1;
    }

    if (++attempt > maxRetries) {
      const text = await res.text();
      throw new Error(`OpenAI 429 retries exhausted: ${text}`);
    }
    process.stdout.write(`(rate-limited, waiting ${waitSec}s) `);
    await sleep(waitSec * 1000);
  }
}

// High-level helper: prompt in → image bytes out.
//
// opts:
//   prompt         (required) — the text prompt
//   aspect_ratio   default '4:3'
//   seed           optional (not supported by OpenAI — ignored silently)
export async function generateImage(opts) {
  const size = aspectToSize(opts.aspect_ratio || '4:3');

  const body = {
    model:  MODEL,
    prompt: opts.prompt,
    n:      1,
    size,
    // gpt-image-1 uses output_format (not response_format like dall-e-3).
    // Returns base64-encoded image data directly.
    output_format: 'png',
    quality: 'high',
  };

  const res = await postWithRetry(`${OPENAI_API}/images/generations`, body);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI image generation failed ${res.status}: ${text}`);
  }

  const json = await res.json();
  const item = json.data && json.data[0];
  if (!item) throw new Error('OpenAI returned no image data');

  // gpt-image-1 returns b64_json when requested
  if (item.b64_json) {
    const bytes = Buffer.from(item.b64_json, 'base64');
    return { bytes, url: null };
  }

  // Fallback: if we got a URL instead, download it
  if (item.url) {
    const dlRes = await fetch(item.url);
    if (!dlRes.ok) throw new Error(`Download failed ${dlRes.status}: ${item.url}`);
    const ab = await dlRes.arrayBuffer();
    return { bytes: Buffer.from(ab), url: item.url };
  }

  throw new Error('OpenAI response had neither b64_json nor url');
}

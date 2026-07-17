# FLUX image batch pipeline — Six Arrows / Fox

One-time setup and day-to-day usage for generating every image the Fox
designer UI needs (quiz options, design boards, catalog illustrations).

---

## One-time setup

### 1. Get a Replicate API token

1. Go to <https://replicate.com/account/api-tokens>
2. Sign in (Replicate lets you log in with GitHub)
3. Click **Create token**, name it `sixarrows-flux`, copy the value — it
   starts with `r8_...`

### 2. Add the token to `.env`

Open `/Users/coleborders/Documents/sixarrows-portal/.env` (or the worktree
root `.env`) and append:

```
REPLICATE_API_TOKEN=r8_your_token_here
```

Do **not** commit this. `.env` is already gitignored.

### 3. Verify Node version

You need Node 18 or newer (uses native `fetch`). Check:

```
node -v
```

If that prints `v18.x.x` or higher, you're good.

### 4. Fund the account (optional, but do it now)

Replicate bills per image. At FLUX 1.1 Pro pricing (~$0.055/image) a full
batch of 72 design boards is about **$4**; the 24 quiz extension images is
about **$1.30**. Add $10 of credit at
<https://replicate.com/account/billing> and you're set for months.

---

## Usage

All commands run from the **repo root**.

### Dry run — see what would generate, no API calls

```
node scripts/flux/generate.mjs quiz --dry
```

### Generate one question only (fastest way to spot-check a prompt)

```
node scripts/flux/generate.mjs quiz --only q7_cabinets
```

This produces 4 images in `scripts/flux/output/quiz/Q7 — Cabinet Style/`.

### Re-generate after tweaking a prompt

Add `--force` to overwrite existing files:

```
node scripts/flux/generate.mjs quiz --only q7_cabinets --force
```

### Generate the whole quiz extension (24 images, Q7–Q12)

```
node scripts/flux/generate.mjs quiz
```

Takes ~3-5 minutes depending on Replicate queue load.

### Generate one style of boards only

(Once `prompts/boards.mjs` is populated)

```
node scripts/flux/generate.mjs boards --style "Modern Farmhouse"
```

### Generate one room across all styles

```
node scripts/flux/generate.mjs boards --room kitchen
```

### Generate everything

```
node scripts/flux/generate.mjs boards
```

---

## Uploading to Drive

After generation, open `scripts/flux/output/quiz/` (or `boards/`) and you'll
find one sub-folder per Drive folder. Upload each sub-folder to the same
Google Drive parent that holds your existing `Q1 — Kitchen Style` etc.
folders. Fox auto-discovers them by folder name, so naming matters — the
pipeline already matches the expected names.

To open the output folder in Finder:

```
open scripts/flux/output
```

---

## Troubleshooting

**`REPLICATE_API_TOKEN not set`** — you haven't added the token to `.env`,
or `.env` isn't at the repo root. The pipeline loads `.env` from
`../../.env` relative to `scripts/flux/`.

**`Replicate create failed 402`** — out of credit. Top up at
<https://replicate.com/account/billing>.

**`Replicate create failed 422`** — prompt hit the safety filter. Edit the
prompt in `scripts/flux/prompts/<batch>.mjs`, increase `safety_tolerance`
in `replicate.mjs` (up to 6), and rerun with `--force`.

**An image came out wrong** — edit its entry in the prompt library and
re-run with `--only <id> --force`. Each option has a unique `id` you can
target.

**I want a different aspect ratio** — set `aspectRatio` on the job (e.g.
`aspectRatio: '16:9'` for exterior boards). Supported: `1:1`, `4:3`,
`3:4`, `16:9`, `9:16`, `3:2`, `2:3`, `4:5`.

---

## Files

```
scripts/flux/
  README.md          — this file
  generate.mjs       — batch runner (CLI)
  replicate.mjs      — Replicate API client (no SDK, just fetch)
  prompts/
    quiz.mjs         — Q7–Q12 prompts (24 images)
    boards.mjs       — design board prompts (72 images, populated next)
    catalog.mjs      — product catalog illustrations (phase 2)
  output/            — generated PNGs, gitignored
```

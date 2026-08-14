// netlify/functions/lib/quote-docs.js
//
// Finds the price Six Arrows already has for a piece of work.
//
// Cole's rule, and the reason this exists: a quote request only goes out if
// nobody has quoted the job yet. On most projects somebody has. Those quotes
// arrive by email, get saved to the client's Drive folder, and are never seen
// again by anything except a person who remembers they are there.
//
// The convention in Drive is a real one and it holds across the Johnson folder:
//
//   <Vendor> - <Client>.pdf                    Chaffin Guttering - Johnson.pdf
//   <Vendor> (updated <date>) - <Client>.pdf   Mid South (updated 5-19) - Johnson.pdf
//   <Vendor> (<variant>) - <Client>.pdf        Sun Windows (casement) - Johnson.pdf
//
// with superseded versions moved into a "Previous Drafts" subfolder. That move
// is Cole saying the quote is dead, so this reads the top level only. A file
// somebody filed away is not a price we still hold.
//
// What this module does NOT do, deliberately: decide. It reports what was
// found, what it says, and how old it is. Whether a price is close enough to
// the budget to act on, and whether an expired quote should be re-confirmed or
// re-bid, are judgements made where the task is in view.

import { listFolder, normalizeName, matchSub } from './compliance-docs.js';
import { readQuote, errorLooksTransient } from './doc-ai.js';
import { getRead, putRead, cacheKey } from './doc-cache.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

// Where each project's documents live. This belongs in the clients table
// beside the timeline DB id, and should move there when the second project is
// onboarded. It is here now because Johnson is the pilot and one hardcoded id
// is honest about that, where a half-built lookup would not be.
export const PROJECT_FOLDERS = {
  Johnson: '12o25SMBSDToBj_-n9cNbU39q2S7wamw1',
};

// Subfolders that are never quotes. Named rather than inferred, so a new
// subfolder shows up as an unexplored folder instead of silently contributing
// property deeds and tile screenshots to the price search.
const NOT_QUOTES = new Set([
  'previous drafts', 'property docs and utilities', 'home portfolio files',
  'accounting', 'invoices', 'photos', 'plans', 'selections',
]);

export function folderForProject(project) {
  return PROJECT_FOLDERS[String(project || '').trim()] || null;
}

// ── Which files are quotes ────────────────────────────────────────────────
// Everything readable at the top level, minus the things that are obviously
// not a price. The budget spreadsheet and the plan set both live up here.
const NOT_A_QUOTE_NAME = /\b(selection sheet|budget|draft #|plat+|deed|permit|restrictions|site evaluation|receipt|invoice)\b/i;

export async function listQuoteFiles(folderId, apiKey) {
  const files = await listFolder(folderId, apiKey);
  return files.filter(f => {
    if (f.mimeType === 'application/vnd.google-apps.folder') return false;
    if (f.mimeType.startsWith('application/vnd.google-apps')) return false;  // Sheets, Docs
    if (NOT_A_QUOTE_NAME.test(f.name || '')) return false;
    return true;
  });
}

// ── Reading a vendor name out of a filename ───────────────────────────────
// The client's name appears in almost every one of these filenames, and left
// in it matches nothing useful and crosses everything: every file on the
// Johnson job shares the word Johnson.
export function vendorFromFileName(name, clientName) {
  let s = String(name || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')     // extension
    .replace(/_+/g, ' ');                 // Estimate_1129_from_Artisan_Electrical_LLC

  // A parenthetical is a version or a variant, never the vendor.
  s = s.replace(/\([^)]*\)/g, ' ');

  if (clientName) {
    const c = String(clientName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${c}\\b`, 'ig'), ' ');
  }

  // "Vendor - Client" and "Vendor - anything else": the vendor is what comes
  // first. Done after the client is removed so a trailing dash is harmless.
  s = s.split(/\s+[-–]\s+/)[0];

  // Software-generated names lead with the document type and number.
  s = s.replace(/^\s*(estimate|quote|proposal|bid|invoice)\s*(no\.?|#)?\s*\d*\s*(from)?\s*/i, '');

  return s.replace(/\s+/g, ' ').trim();
}

// Matches every quote file to a subcontractor, using the same conservative
// matcher the compliance sweep uses on certificates. Reused rather than
// reimplemented on purpose: it already refuses ambiguous matches, and the
// failure mode here is the same one, crediting a price to the wrong vendor.
//
// subs: [{ id, name }]. Returns a Map of sub id to files, newest first, plus
// the files nothing claimed.
export function groupQuotesBySub(files, subs, clientName) {
  const bySub    = new Map();
  const unmatched = [];

  for (const f of files) {
    const vendor = vendorFromFileName(f.name, clientName);
    const m = normalizeName(vendor) ? matchSub(vendor, subs) : null;
    if (!m) { unmatched.push({ ...f, vendor }); continue; }
    if (!bySub.has(m.sub.id)) bySub.set(m.sub.id, []);
    bySub.get(m.sub.id).push({ ...f, vendor, matchScore: m.score });
  }

  for (const list of bySub.values()) {
    // Newest first. An "(updated 5-19)" file and its predecessor both sit at
    // the top level often enough that picking by modification time matters,
    // and Drive's modifiedTime is the only ordering that does not depend on
    // reading a date out of a filename somebody typed by hand.
    list.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  }
  return { bySub, unmatched };
}

// ── Reading one ───────────────────────────────────────────────────────────
async function downloadFile(fileId, apiKey) {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&key=${apiKey}`);
  if (!res.ok) throw new Error(`Drive download ${fileId}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function toQuote(row) {
  if (!row) return null;
  const d = row.data || {};
  return {
    total:            d.total ?? null,
    coversWholeScope: !!d.coversWholeScope,
    quoteDate:        d.quoteDate || null,
    validUntil:       row.expiry || d.validUntil || null,
    validityDerived:  !!d.validityDerived,
    validityText:     d.validityText || null,
    scope:            d.scope || null,
    lineItems:        d.lineItems || [],
    pricedSeparately: d.pricedSeparately || [],
    exclusions:       d.exclusions || [],
    vendorName:       row.insured_name || d.vendorName || null,
    quoteNumber:      d.quoteNumber || null,
    confidence:       row.confidence || 'none',
    method:           row.method || 'ai',
    notes:            row.notes || null,
    error:            row.error || null,
    cached:           row.created_at || true,
  };
}

function quoteRow(file, result) {
  return {
    file_id:       file.id,
    file_name:     file.name || null,
    modified_time: file.modifiedTime || '',
    kind:          'quote',
    method:        result.method || null,
    // A quote's validity really is an expiry date, so it goes in the column
    // that already means that and stays queryable rather than buried in jsonb.
    expiry:        result.validUntil || null,
    insured_name:  result.vendorName || null,
    confidence:    result.confidence || 'none',
    notes:         result.notes || null,
    error:         result.error || null,
    model:         result.model || null,
    data: {
      total:            result.total ?? null,
      coversWholeScope: !!result.coversWholeScope,
      quoteDate:        result.quoteDate || null,
      validUntil:       result.validUntil || null,
      validityDerived:  !!result.validityDerived,
      validityText:     result.validityText || null,
      scope:            result.scope || null,
      lineItems:        result.lineItems || [],
      pricedSeparately: result.pricedSeparately || [],
      exclusions:       result.exclusions || [],
      vendorName:       result.vendorName || null,
      quoteNumber:      result.quoteNumber || null,
    },
  };
}

// Same three layers as a certificate, and the same rules about what may be
// remembered. A read that failed because the account was out of credit is a
// fact about the moment, not about the document, and caching one would make a
// perfectly readable quote permanently unreadable.
//
// opts.cache      a Map from loadCacheIndex(), so a caller sweeping a folder
//                 pays one query rather than one per file
// opts.cacheOnly  answer from the cache or not at all
// opts.force      ignore the cache and read again
export async function readQuoteFile(file, apiKey, opts = {}) {
  const cacheK = cacheKey(file.id, file.modifiedTime);
  const cached = opts.force
    ? null
    : (opts.cache ? opts.cache.get(cacheK) || null : await getRead(file.id, file.modifiedTime));

  if (cached && !errorLooksTransient(cached.error)) return { ...toQuote(cached), file: file.name };
  if (opts.cacheOnly) return { total: null, confidence: 'none', unread: true, file: file.name };

  let bytes;
  try {
    bytes = await downloadFile(file.id, apiKey);
  } catch (err) {
    return { total: null, confidence: 'none', error: err.message, file: file.name };
  }

  const result = await readQuote({ bytes, file });

  // The text layer is not used as a first pass here, unlike certificates. On a
  // certificate the interesting value is a date in a fixed grid; on a quote it
  // is which parts of the job the number does and does not cover, and no
  // amount of pattern matching answers that.
  if (!result.budgetExhausted && !result.transient) await putRead(quoteRow(file, result));

  return { ...result, file: file.name };
}

// ── Is this price still good ──────────────────────────────────────────────
// Four states, and the difference between the middle two is what a person does
// next: a quote that has run out of time usually needs a text asking whether
// the price still holds, not a fresh quote request.
//
//   none     nobody has quoted this
//   unread   we hold a document and have not read it yet
//   stale    we have a price and it has passed its own expiration
//   current  we have a price and it is still good
//
// A quote with no stated validity is treated as current until STALE_AFTER_DAYS
// have passed, because material prices move and a number from last spring is
// not one to put a signature under.
export const STALE_AFTER_DAYS = 90;

export function quoteState(quote, asOf = new Date().toISOString().slice(0, 10)) {
  if (!quote)                return { state: 'none',   reason: 'no quote on file for this vendor on this project.' };
  if (quote.unread)          return { state: 'unread', reason: `${quote.file} has not been read yet.` };
  if (quote.total == null)   return { state: 'unread', reason: `${quote.file} was opened but no price was found on it: ${quote.error || 'reason not recorded'}` };

  if (quote.validUntil && quote.validUntil < asOf) {
    return {
      state: 'stale',
      reason: quote.validityDerived
        ? `the quote is dated ${quote.quoteDate} and says "${quote.validityText}", which put it out of date on ${quote.validUntil}.`
        : `the quote expired ${quote.validUntil}.`,
    };
  }

  if (!quote.validUntil && quote.quoteDate) {
    const age = Math.round((Date.parse(asOf) - Date.parse(quote.quoteDate)) / 86400000);
    if (age > STALE_AFTER_DAYS) {
      return { state: 'stale', reason: `the quote is dated ${quote.quoteDate}, which is ${age} days ago, and states no validity period.` };
    }
  }

  return { state: 'current', reason: quote.validUntil ? `good through ${quote.validUntil}.` : `dated ${quote.quoteDate || 'unknown'}, no expiry stated.` };
}

// netlify/functions/lib/doc-cache.js
//
// Remembers what was read out of a compliance document, so the sweep can run
// every morning without paying to re-read forty certificates that have not
// changed since yesterday.
//
// Keyed on the Drive file id plus its modification time. A replaced or
// re-uploaded certificate gets a new modification time and therefore a fresh
// read, automatically. Nothing to invalidate by hand.
//
// Append-only, like every other table this project writes: a read is a
// historical fact about a document at a point in time, and the trail of what
// the system believed and when is worth more than a tidy current-state row.
//
// Never throws. A cache that is down must slow the sweep, not stop it.

import { supabase } from './supabase-client.js';

export function cacheKey(fileId, modifiedTime) {
  return `${fileId}|${modifiedTime || ''}`;
}

// The whole cache in one query.
//
// The alternative, a lookup per file, is what broke the sweep: seventy-odd
// documents meant seventy-odd sequential round trips before any work started,
// and a function answering an HTTP request does not have that long. One query
// costs the same as one lookup and answers for every file.
//
// Returns a Map, or null if the cache could not be read at all, which the
// caller treats as "fall back to per-file lookups" rather than "no cache".
export async function loadCacheIndex() {
  try {
    const rows = await supabase('document_reads', {
      select: '*',
      order: 'created_at.desc',
      limit: 2000,
    });
    const idx = new Map();
    // Newest first, so the first row seen for a key is the one that counts.
    for (const r of rows) {
      const k = cacheKey(r.file_id, r.modified_time);
      if (!idx.has(k)) idx.set(k, r);
    }
    return idx;
  } catch (err) {
    console.error('doc-cache index failed:', err.message);
    return null;
  }
}

export async function getRead(fileId, modifiedTime) {
  if (!fileId) return null;
  try {
    const rows = await supabase('document_reads', {
      select: '*',
      filters: [
        { col: 'file_id',       op: 'eq', val: fileId },
        { col: 'modified_time', op: 'eq', val: modifiedTime || '' },
      ],
      order: 'created_at.desc',
      limit: 1,
    });
    return rows?.[0] || null;
  } catch (err) {
    console.error('doc-cache read failed:', err.message);
    return null;
  }
}

export async function putRead(row) {
  try {
    await supabase('document_reads', { method: 'POST', body: row });
    return true;
  } catch (err) {
    console.error('doc-cache write failed:', err.message);
    return false;
  }
}

// Turns a certificate read back into the shape readCertificate returns, so a
// cache hit and a fresh read are indistinguishable to everything downstream.
export function toCertificate(row) {
  if (!row) return null;
  return {
    expiry:            row.expiry || null,
    confidence:        row.confidence || 'none',
    method:            row.method || 'ai',
    insuredName:       row.insured_name || null,
    additionalInsured: row.additional_insured || 'unclear',
    sixArrowsIsHolder: !!row.six_arrows_is_holder,
    certificateHolder: row.certificate_holder || null,
    policies:          row.policies || {},
    notes:             row.notes || null,
    error:             row.error || null,
    cached:            row.created_at || true,
  };
}

export function certificateRow(file, result) {
  return {
    file_id:              file.id,
    file_name:            file.name || null,
    modified_time:        file.modifiedTime || '',
    kind:                 'coi',
    method:               result.method || null,
    expiry:               result.expiry || null,
    insured_name:         result.insuredName || null,
    certificate_holder:   result.certificateHolder || null,
    additional_insured:   result.additionalInsured || null,
    six_arrows_is_holder: !!result.sixArrowsIsHolder,
    policies:             result.policies || {},
    confidence:           result.confidence || 'none',
    notes:                result.notes || null,
    error:                result.error || null,
    model:                result.model || null,
  };
}

export function w9Row(file, result) {
  return {
    file_id:       file.id,
    file_name:     file.name || null,
    modified_time: file.modifiedTime || '',
    kind:          'w9',
    method:        result.method || null,
    insured_name:  result.name || null,
    // The DBA is what everyone actually calls this firm, so it is worth as
    // much as the legal name when matching a file to a subcontractor row.
    business_name: result.businessName || null,
    confidence:    result.confidence || 'none',
    notes:         result.notes || null,
    error:         result.error || null,
    model:         result.model || null,
  };
}

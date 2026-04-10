// netlify/functions/generate-package.js
// ─────────────────────────────────────────────────────────────────────────────
//  Generate Package — pure data lookup from the seeded catalog.
//
//  POST /generate-package
//  Body: {
//    style: "Modern Farmhouse",
//    budgetTiers: { kitchen: "elevated", master_bath: "essential", ... },
//    rooms: [{ id: "kitchen", name: "Kitchen" }, ...]
//  }
//
//  Returns a selections package with selected product + alternatives per
//  category per room, based on the style and budget tier. No LLM calls —
//  just fast catalog lookups.
// ─────────────────────────────────────────────────────────────────────────────

import {
  STYLE_NAMES,
  DEFAULT_PRODUCTS,
  categoriesForRoom,
  CAT_LABELS,
} from './shared/catalog-data.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type':                 'application/json',
};

const TIER_MAP = {
  essential: 'Essential',
  elevated:  'Elevated',
  showpiece: 'Showpiece',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// Convert style name to URL-friendly slug: "Modern Farmhouse" → "modern-farmhouse"
function styleSlug(style) {
  return style.toLowerCase().replace(/\s+/g, '-');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed. Use POST.' });
  }

  // ── Parse request ────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { style, budgetTiers, rooms } = body;

  if (!style || !STYLE_NAMES.includes(style)) {
    return json(400, {
      error: `Invalid style. Must be one of: ${STYLE_NAMES.join(', ')}`,
    });
  }

  if (!budgetTiers || typeof budgetTiers !== 'object') {
    return json(400, { error: 'budgetTiers object is required (e.g. { kitchen: "elevated" }).' });
  }

  if (!Array.isArray(rooms) || rooms.length === 0) {
    return json(400, { error: 'rooms array is required (e.g. [{ id: "kitchen", name: "Kitchen" }]).' });
  }

  // ── Build package ────────────────────────────────────────────
  const slug = styleSlug(style);
  const styleProducts = DEFAULT_PRODUCTS[style] || {};
  const pkg = {};

  for (const room of rooms) {
    const roomId = room.id;
    const roomTierRaw = (budgetTiers[roomId] || 'elevated').toLowerCase();
    const roomTier = TIER_MAP[roomTierRaw];

    if (!roomTier) {
      return json(400, {
        error: `Invalid budget tier "${budgetTiers[roomId]}" for room "${roomId}". Must be essential, elevated, or showpiece.`,
      });
    }

    const categories = categoriesForRoom(roomId);
    const roomPackage = {};

    for (const cat of categories) {
      const products = styleProducts[cat];
      if (!products || !Array.isArray(products)) continue;

      // Find the selected product (matching tier) and alternatives (other tiers)
      const selected = products.find(p => p.tier === roomTier);
      const alternatives = products.filter(p => p.tier !== roomTier);

      if (!selected) continue;

      // Build image URL: /images/products/{style-slug}/{category}/{tier}.png
      const imageUrl = `/images/products/${slug}/${cat}/${roomTierRaw}.png`;

      roomPackage[cat] = {
        label: CAT_LABELS[cat] || cat,
        selected: {
          ...selected,
          imageUrl,
        },
        alternatives: alternatives.map(alt => ({
          ...alt,
          imageUrl: `/images/products/${slug}/${cat}/${alt.tier.toLowerCase()}.png`,
        })),
      };
    }

    pkg[roomId] = roomPackage;
  }

  return json(200, { style, package: pkg });
};

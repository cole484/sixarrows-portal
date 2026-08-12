// netlify/functions/lib/trade-aliases.js
//
// The per-project timeline DBs and the Trade Templates DB were authored with
// different trade vocabularies, and nothing reconciled them.
//
//   timeline `Trade` select   →  "Excavation",  "Trim"
//   Trade Templates title     →  "Excavation & Footings", "Trim & Molding Work"
//
// notion-work-order.js looks the template up by exact title match, so those
// trades silently resolved to no template and the work order rendered with no
// Scope and no Completion Standard. Silently, because "no template" was
// indistinguishable from "this trade has no template row".
//
// Two separate cases, kept separate on purpose:
//   TRADE_TEMPLATE_ALIASES  — a template exists, under a different name.
//   TRADES_WITHOUT_TEMPLATE — no template row exists at all. The work order
//                             needs a per-task Scope of Work, or someone needs
//                             to add a Trade Templates row for that trade.

// timeline trade name → Trade Templates title
export const TRADE_TEMPLATE_ALIASES = {
  'Excavation': 'Excavation & Footings',
  'Trim':       'Trim & Molding Work',
};

// Timeline trades with no Trade Templates row as of Aug 2026. "Other" is
// unmappable by definition; the rest are real recurring trades that deserve a
// template row eventually.
export const TRADES_WITHOUT_TEMPLATE = new Set([
  'Windows/Doors',
  'Surveying',
  'Cleaning',
  'Other',
]);

// Returns the Trade Templates title to query for a given timeline trade, or
// null when no template can exist for it. Callers should treat null as
// "expected, explain it" rather than "lookup failed".
export function templateTitleForTrade(trade) {
  if (!trade) return null;
  const t = String(trade).trim();
  if (TRADES_WITHOUT_TEMPLATE.has(t)) return null;
  return TRADE_TEMPLATE_ALIASES[t] || t;
}

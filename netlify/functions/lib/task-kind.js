// netlify/functions/lib/task-kind.js
//
// Not every task on a build schedule is work sent to a subcontractor, and the
// ones that are not fail in completely different ways.
//
// Three kinds:
//
//   service   A sub comes to the site and performs work. This is what the work
//             order exists for: scope, a price they gave us, current insurance,
//             a committed window, a signature.
//
//   purchase  We buy a thing. Needs a supplier, a price and confirmation it was
//             actually ordered. Needs no certificate of insurance and no signed
//             work order, because nobody is setting foot on the property.
//
//   internal  Six Arrows, the client, or the county. A kickoff meeting, a
//             client walkthrough, a rough-in inspection. Needs a date and a
//             definition of done and nothing else at all.
//
// The distinction that matters most, and the one that produced a false alarm
// for a month, is what Start and Lead time mean on each:
//
//   service   Start is the day the crew arrives.
//             Lead time is runway BEFORE it. Work order goes out on
//             Start minus Lead time.
//
//   purchase  Start is the day the order has to be placed. Cole: "we have it
//             set where it is on the timeline because that's when it needs to
//             be ordered".
//             Lead time is how long the goods take AFTER ordering. It points
//             forward, not backward.
//
// Reading a purchase the way a service is read turns an order-by date into an
// arrival date and reports the task as weeks overdue on the exact day it was
// supposed to happen. The Johnson window package said "45 days behind" when the
// correct answer was "order these today".

// Trades where the task is a purchase, not labor.
export const PURCHASE_TRADES = new Set([
  'Material Ordering',
]);

// Trades with no outside party performing paid work for us. Inspection is here
// because the county inspector is not somebody Six Arrows hires: there is no
// price to agree, no certificate to hold and nothing to sign.
export const INTERNAL_TRADES = new Set([
  'Planning',
  'Inspection',
]);

// The trade gives a good default and cannot give a correct answer for every
// task, because some of these decisions do not follow from the trade at all.
// On Johnson: "Metal siding install" and "Gutters / downspouts" are both Trade
// "Other" and both need a work order, while "Exterior penetrations sealed" and
// "Punch list completion" share that trade and are punch list items. "Garage
// door install" needs no work order because Overhead Door quoted it installed,
// which is a fact about the quote rather than about garage doors.
//
// So the timeline carries a "Task Kind" select that wins when it is set. The
// trade-derived answer is the default for the 90 percent of tasks where nobody
// needs to think about it.
const OVERRIDES = { service: 'service', purchase: 'purchase', internal: 'internal' };

export function taskKind(trade, override) {
  const o = OVERRIDES[String(override || '').trim().toLowerCase()];
  if (o) return o;

  const t = String(trade || '').trim();
  if (PURCHASE_TRADES.has(t)) return 'purchase';
  if (INTERNAL_TRADES.has(t)) return 'internal';
  // An unrecognised or missing trade is a service, because that errs toward
  // asking a question rather than skipping a check.
  return 'service';
}

export const needsWorkOrder = (trade, override) => taskKind(trade, override) === 'service';

// Calendar days. Lead time on these tasks has always meant calendar days and
// Cole confirmed it stays that way.
export function shiftDays(iso, n) {
  if (!iso) return null;
  const t = new Date(String(iso).slice(0, 10) + 'T00:00:00Z').getTime() + n * 86_400_000;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// The day the work order has to be in a sub's hands, for a service task.
export function releaseDate(start, leadTime) {
  if (!start || leadTime == null) return null;
  return shiftDays(start, -leadTime);
}

// When a purchase actually lands. Counted from the day it was ordered, because
// that is when the vendor's clock starts. Where nothing has been ordered yet,
// the honest projection is from today: ordering this morning is the best case
// still available, and a delivery date computed from an order-by date that has
// already passed describes a world we are no longer in.
export function deliveryEstimate({ orderedOn, leadTime, today }) {
  if (leadTime == null) return null;
  if (orderedOn) return { on: shiftDays(orderedOn, leadTime), from: 'ordered' };
  return { on: shiftDays(today, leadTime), from: 'if ordered today' };
}

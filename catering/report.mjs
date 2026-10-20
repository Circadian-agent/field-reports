// Offline proof only. No network, model, database, sender, booking or payment code.
import { createHash } from 'node:crypto';

const text = (x) => typeof x === 'string' && x.trim().length > 0;
const instant = (x) => {
  if (!text(x)) return false;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(x);
  if (!m || !Number.isFinite(Date.parse(x))) return false;
  const hours = Number(m[4] ?? 0), minutes = Number(m[5] ?? 0);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
  const offset = (hours * 60 + minutes) * (m[3] === '-' ? -1 : 1);
  return new Date(Date.parse(x) + offset * 60_000).toISOString().slice(0, 19) === m[1];
};
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

function briefCheck(b) {
  requireValue(text(b.id) && text(b.area) && text(b.style), 'Event ID, area and service style required');
  requireValue(instant(b.eventAt) && instant(b.deadline), 'Event and deadline require an explicit UTC offset');
  requireValue(Date.parse(b.deadline) < Date.parse(b.eventAt), 'Collection must close before the event');
  requireValue(Number.isSafeInteger(b.guests) && b.guests > 0, 'Positive integer headcount required');
  requireValue(Array.isArray(b.diets) && b.diets.every(text) && new Set(b.diets).size === b.diets.length,
    'Dietary needs must be unique nonempty labels');
  requireValue(b.budget && /^[A-Z]{3}$/.test(b.budget.currency) &&
    Number.isSafeInteger(b.budget.minor) && b.budget.minor >= 0 &&
    ['person', 'total'].includes(b.budget.basis), 'Budget needs currency, integer cents and person/total basis');
}

// Only this narrow quote format is numerically comparable. Free text remains visible.
function exactCents(value, currency) {
  const m = /^([A-Z]{3}) (\d{1,9})\.(\d{2})$/.exec(value ?? '');
  return m && m[1] === currency ? Number(m[2]) * 100 + Number(m[3]) : null;
}

function fields(body) {
  const out = new Map();
  for (const line of body.split(/\r?\n/)) {
    const m = /^([^:]+): (.*)$/.exec(line);
    if (!m) continue;
    // Repeated fields are ambiguous even when they look equal.
    out.set(m[1], out.has(m[1]) ? null : m[2]);
  }
  return out;
}

function rowFor(b, vendor, cutoff) {
  const matchingScope = vendor.scope?.area === b.area && vendor.scope?.style === b.style &&
    text(vendor.scope?.source);
  const sent = vendor.contacts ?? [];
  requireValue(Array.isArray(sent), 'Contacts must be an array');
  requireValue(!vendor.stopAt || instant(vendor.stopAt), 'Stop request requires a valid timestamp');
  requireValue(new Set(sent.map(c => c.id)).size === sent.length, 'Duplicate contact ID');
  for (const c of sent) {
    requireValue(text(c.id) && instant(c.at), 'Contact needs ID and timestamp');
    requireValue(c.aiDisclosed === true && c.onBehalfOfCustomer === true &&
      c.buyerDetailsShared === false, 'Contact log violates disclosure or privacy requirements');
    requireValue(c.eventId === b.id && Date.parse(c.at) <= Date.parse(b.deadline),
      'Contact is outside this event or collection window');
    requireValue(!vendor.stopAt || Date.parse(c.at) < Date.parse(vendor.stopAt), 'Contact after stop request');
  }
  const row = {
    id: vendor.id, name: vendor.name,
    scope: matchingScope ? 'matches' : 'unverified; not a recommended option',
    scopeEvidence: vendor.scope ?? null,
    contacts: sent.filter(c => Date.parse(c.at) <= cutoff).map(c => ({ id: c.id, at: c.at })),
    stopped: Boolean(vendor.stopAt && Date.parse(vendor.stopAt) <= cutoff),
    response: 'no reply', availability: 'not confirmed',
    capacity: 'not confirmed', menu: 'not confirmed',
    dietary: Object.fromEntries(b.diets.map(d => [d, 'not confirmed'])),
    prices: { perPerson: 'not stated', total: 'not stated', minimum: 'not stated',
      deposit: 'not stated', cancellation: 'not stated' },
    budget: 'not comparable',
    evidence: [], ignored: [],
  };
  const valid = [];
  requireValue(Array.isArray(vendor.replies ?? []), 'Replies must be an array');
  requireValue(new Set((vendor.replies ?? []).map(m => m.id)).size === (vendor.replies ?? []).length,
    'Duplicate reply ID');
  for (const m of vendor.replies ?? []) {
    requireValue(text(m.id) && instant(m.at) && typeof m.body === 'string', 'Reply needs ID, timestamp and body');
    if (m.eventId !== b.id || Date.parse(m.at) > cutoff) {
      row.ignored.push({ id: m.id, reason: m.eventId !== b.id ? 'different event' : 'after report cutoff' });
    } else valid.push(m);
  }
  // Use the latest complete message. Do not silently combine old prices and new availability.
  valid.sort((a, z) => Date.parse(a.at) - Date.parse(z.at) || a.id.localeCompare(z.id));
  if (!valid.length) return row;
  row.response = 'replied';
  const latestAt = valid.at(-1).at;
  const latest = valid.filter(m => Date.parse(m.at) === Date.parse(latestAt));
  if (latest.length !== 1) {
    row.response = 'ambiguous latest replies';
    row.evidence = latest.map(m => ({ ...m, sha256: digest(m) }));
    return row;
  }
  const m = latest[0];
  row.evidence = [{ ...m, sha256: digest(m) }];
  const f = fields(m.body);
  // These assertions are vendor statements in a deliberately constrained reply template.
  // This is not natural-language extraction or independent verification of vendor truth.
  const correctEvent = f.get('Event time') === b.eventAt;
  if (!correctEvent) {
    row.response = 'replied; event time unconfirmed';
    return row;
  }
  const capacity = f.get('Capacity');
  row.capacity = capacity ?? 'not confirmed';
  const enoughSeats = /^\d+$/.test(capacity ?? '') && Number(capacity) >= b.guests;
  if (f.get('Availability') === 'declined' && correctEvent) {
    row.response = 'declined'; row.availability = 'declined';
  } else if (f.get('Availability') === 'confirmed' && correctEvent && enoughSeats) {
    row.availability = 'confirmed for event and headcount';
  }
  for (const diet of b.diets) {
    const value = f.get(`Diet ${diet}`);
    if (['confirmed', 'cannot cover'].includes(value)) row.dietary[diet] = value;
  }
  row.menu = f.get('Menu') ?? 'not confirmed';
  for (const [field, label] of Object.entries({
    perPerson: 'Price per person', total: 'Total', minimum: 'Minimum spend',
    deposit: 'Deposit', cancellation: 'Cancellation',
  })) row.prices[field] = f.get(label) ?? 'not stated';
  const basis = b.budget.basis === 'person' ? row.prices.perPerson : row.prices.total;
  const cents = exactCents(basis, b.budget.currency);
  // Unknown fees mean a cheap base price is not proof the final price is within budget.
  if (cents !== null && cents > b.budget.minor) row.budget = 'over budget';
  else if (cents !== null && f.get('Price basis') === 'final; taxes and mandatory fees included')
    row.budget = 'quoted amount at/below budget; minimum not assessed';
  return row;
}

export function report(input, asOf) {
  const { brief: b, vendors } = input;
  briefCheck(b);
  requireValue(instant(asOf), 'Report timestamp requires an explicit UTC offset');
  requireValue(Array.isArray(vendors) && vendors.every(v => text(v.id) && text(v.name)), 'Vendor identities required');
  requireValue(new Set(vendors.map(v => v.id)).size === vendors.length, 'Duplicate vendor ID');
  const cutoff = Math.min(Date.parse(asOf), Date.parse(b.deadline));
  const rows = vendors.map(v => rowFor(b, v, cutoff));
  const result = {
    kind: 'synthetic offline proof', event: b.id, eventAt: b.eventAt, guests: b.guests,
    area: b.area, serviceStyle: b.style, deadline: b.deadline, asOf,
    status: Date.parse(asOf) >= Date.parse(b.deadline) ? 'final' : 'collecting',
    inputSha256: digest(input),
    summary: {
      researched: rows.length,
      contacted: rows.filter(r => r.contacts.length).length,
      responded: rows.filter(r => r.response !== 'no reply').length,
      confirmedAvailable: rows.filter(r => r.scope === 'matches' &&
        r.availability === 'confirmed for event and headcount').length,
    },
    vendors: rows,
    nextSteps: 'Buyer verifies current terms and decides. No booking or payment is performed.',
  };
  return result;
}

const escape = (x) => String(x).replaceAll('\\', '\\\\').replaceAll('|', '\\|')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>');
export function markdown(r) {
  const lines = [
    '# Catering comparison: synthetic proof', '',
    `Event: ${r.event}; ${r.guests} guests; ${r.eventAt}.`,
    `Area: ${r.area}. Service: ${r.serviceStyle}.`,
    `Collection closes: ${r.deadline}. Report status: ${r.status}.`, '',
    `${r.summary.researched} researched; ${r.summary.contacted} contacted; ` +
      `${r.summary.responded} responded; ${r.summary.confirmedAvailable} confirmed available in scope.`,
    '', 'All vendors and replies below are fictional. Confirmed means stated in the synthetic reply.',
    'Dietary confirmation is a vendor statement, not an allergy-safety guarantee.',
    '', '| Vendor | Scope | Response | Availability | Per person | Total | Budget | Dietary needs |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const v of r.vendors) {
    lines.push('| ' + [v.name, v.scope, v.response, v.availability, v.prices.perPerson,
      v.prices.total, v.budget, Object.entries(v.dietary).map(([k, x]) => `${k}: ${x}`).join('; ')]
      .map(escape).join(' | ') + ' |');
  }
  for (const v of r.vendors) {
    lines.push('', `## ${escape(v.name)}`, '',
      `Menu: ${escape(v.menu)}. Capacity: ${escape(v.capacity)}.`,
      `Minimum: ${escape(v.prices.minimum)}. Deposit: ${escape(v.prices.deposit)}.`,
      `Cancellation: ${escape(v.prices.cancellation)}.`,
      `Stop requested: ${v.stopped}. Contacts: ${v.contacts.map(c => `${c.id} at ${c.at}`).join(', ') || 'none'}.`,
      `Scope evidence: ${escape(JSON.stringify(v.scopeEvidence))}.`);
    for (const e of v.evidence) {
      lines.push('', `Reply ${escape(e.id)} at ${e.at}; SHA256 ${e.sha256}:`, '',
        ...e.body.split('\n').map(line => '> ' + escape(line)));
    }
    if (v.ignored.length) lines.push('', `Ignored: ${escape(JSON.stringify(v.ignored))}.`);
  }
  lines.push('', r.nextSteps, '');
  return lines.join('\n');
}

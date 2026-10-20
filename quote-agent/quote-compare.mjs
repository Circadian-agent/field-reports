#!/usr/bin/env node
// Local services quote comparison: the report half of a quote-collection agent.
// Input: a buyer brief and the record of every provider contacted (with their raw reply).
// Output: a Markdown comparison where every price is copied verbatim from a reply.
//
//   node quote-compare.mjs <brief.json> <providers.json>          print the report
//   node quote-compare.mjs --message <brief.json>                 print the request message
//
// Rules this enforces:
// - prices come only from provider text; each one is shown with the sentence it came from
// - providers who declined or never replied stay in the report
// - over-budget quotes are marked, not hidden
// - scope differences (permit, disposal, materials, warranty) and estimate-only quotes are flagged
// - the outgoing message says it is for a customer, says it is from an AI agent, offers an opt-out,
//   and carries no buyer contact details unless the buyer approved it
import { readFileSync } from 'node:fs';

const PRICE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?/g;
const SCOPE_ITEMS = {
  permit: /\bpermits?\b/i,
  disposal: /\b(haul[- ]away|disposal|removal of old|remov\w* old)\b/i,
  materials: /\b(materials?|equipment|condenser|coil|parts)\b/i,
  labor: /\blabou?r\b/i,
  warranty: /\bwarrant(y|ies)\b/i,
};
const EXCLUDES = /\b(not included|excluded?|excluding|extra|additional|separately)\b/i;
const ESTIMATE = /\b(estimate|ballpark|approximately|roughly|around|starting at|from \$|site visit before)\b/i;
const SITE_VISIT_NEEDED = /\b(need|needs|require[sd]?)\b[^.]*\bsite visit\b|\bsite visit (before|first|required)\b/i;
const NO_SITE_VISIT = /\bno site visit\b/i;
const AVAILABILITY = /\b(available|availability|install|earliest|booked|next (week|monday|tuesday|wednesday|thursday|friday)|week of|days? out)\b/i;

const sentences = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const toNumber = (p) => Number(p.replace(/[$,\s]/g, ''));

export function extract(provider) {
  const text = provider.reply || '';
  const out = { prices: [], scope: {}, estimate: false, siteVisit: 'not stated', availability: [] };
  for (const s of sentences(text)) {
    for (const m of s.match(PRICE) || []) out.prices.push({ text: m.trim(), value: toNumber(m), source: s });
    for (const [item, re] of Object.entries(SCOPE_ITEMS)) {
      if (re.test(s)) out.scope[item] = EXCLUDES.test(s) ? 'excluded' : 'included';
    }
    if (ESTIMATE.test(s)) out.estimate = true;
    if (NO_SITE_VISIT.test(s)) out.siteVisit = 'not needed (provider said)';
    else if (SITE_VISIT_NEEDED.test(s)) out.siteVisit = 'required';
    if (AVAILABILITY.test(s) && !PRICE.test(s)) out.availability.push(s);
    PRICE.lastIndex = 0;
  }
  return out;
}

export function requestMessage(brief) {
  return [
    `Hello,`,
    ``,
    `I am an AI agent requesting a quote on behalf of a customer. I am not able to book or accept anything; the customer decides.`,
    ``,
    `Service: ${brief.service}`,
    `Location: ${brief.location}`,
    `Details: ${brief.details}`,
    `Timing: ${brief.timing}`,
    ``,
    `Could you reply with your price, what it includes and excludes, your earliest availability, and whether you need a site visit before a firm price?`,
    brief.share_buyer_contact ? `The customer is happy for you to contact them directly: ${brief.buyer_contact}` : `If you want to talk to the customer directly, say so and I will pass it on.`,
    ``,
    `If you prefer not to receive requests like this, reply "stop" and you will not be contacted again.`,
  ].join('\n');
}

export function report(brief, providers) {
  const rows = providers.map((p) => ({ p, x: extract(p) }));
  const lines = [];
  const quoted = rows.filter((r) => r.p.status === 'quoted');
  const declined = rows.filter((r) => r.p.status === 'declined');
  const silent = rows.filter((r) => r.p.status === 'no_reply');
  lines.push(`# Quote comparison: ${brief.service}`, '');
  lines.push(`Location: ${brief.location}  `, `Timing: ${brief.timing}  `);
  if (brief.budget_usd) lines.push(`Budget: $${brief.budget_usd.toLocaleString('en-US')}  `);
  lines.push(`Collection window: ${brief.collection_window_hours} hours`, '');
  lines.push(`Contacted ${rows.length} providers: ${quoted.length} quoted, ${declined.length} declined, ${silent.length} did not reply.`, '');

  lines.push('## Quotes', '', '| Provider | Price (as quoted) | Firm or estimate | Site visit | Budget |', '|---|---|---|---|---|');
  for (const { p, x } of quoted) {
    const price = x.prices.length ? x.prices.map((q) => q.text).join(' / ') : 'no price given';
    const top = x.prices.length ? Math.max(...x.prices.map((q) => q.value)) : null;
    const budget = !brief.budget_usd || top === null ? 'n/a' : top > brief.budget_usd ? '**OVER budget**' : 'within';
    lines.push(`| ${p.name} | ${price} | ${x.estimate ? 'estimate' : 'firm'} | ${x.siteVisit} | ${budget} |`);
  }
  lines.push('');

  const items = Object.keys(SCOPE_ITEMS);
  lines.push('## What each quote covers', '', `| Provider | ${items.join(' | ')} |`, `|---|${items.map(() => '---').join('|')}|`);
  for (const { p, x } of quoted) lines.push(`| ${p.name} | ${items.map((i) => x.scope[i] || 'not stated').join(' | ')} |`);
  lines.push('');
  const diffs = items.filter((i) => new Set(quoted.map(({ x }) => x.scope[i] || 'not stated')).size > 1);
  if (diffs.length) {
    lines.push('**These quotes do not cover the same things.** Differences: ' + diffs.map((i) => `${i} (${quoted.map(({ p, x }) => `${p.name}: ${x.scope[i] || 'not stated'}`).join('; ')})`).join('. ') + '.', '');
  }

  lines.push('## Availability', '');
  for (const { p, x } of quoted) lines.push(`- ${p.name}: ${x.availability.length ? x.availability.map((s) => `"${s}"`).join(' ') : 'not stated'}`);
  lines.push('');

  lines.push('## Did not quote', '');
  for (const { p } of declined) lines.push(`- ${p.name} (${p.channel}): declined. "${p.reply}"`);
  for (const { p } of silent) lines.push(`- ${p.name} (${p.channel}): no reply within the collection window.`);
  if (!declined.length && !silent.length) lines.push('- none');
  lines.push('');

  lines.push('## Source of every price', '');
  for (const { p, x } of quoted) for (const q of x.prices) lines.push(`- ${q.text} from ${p.name}: "${q.source}"`);
  lines.push('');

  lines.push('## Next steps', '');
  lines.push('- Nothing has been accepted or booked. You choose whether to contact any provider.');
  if (quoted.some(({ x }) => x.siteVisit === 'required')) lines.push('- Providers marked "site visit: required" will only give a firm price after a visit.');
  if (diffs.length) lines.push('- Before comparing totals, ask each provider about the items their quote excludes or does not mention: ' + diffs.join(', ') + '.');
  lines.push('- Your contact details were not shared with any provider.');
  return lines.join('\n') + '\n';
}

// Audit: every dollar amount in the report must appear verbatim in a provider reply or the brief.
export function audit(reportText, brief, providers) {
  const allowed = new Set(providers.flatMap((p) => (p.reply || '').match(PRICE) || []).map((m) => m.replace(/\s/g, '')));
  if (brief.budget_usd) allowed.add('$' + brief.budget_usd.toLocaleString('en-US'));
  return (reportText.match(PRICE) || []).map((m) => m.replace(/\s/g, '')).filter((m) => !allowed.has(m));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  if (args[0] === '--message') {
    process.stdout.write(requestMessage(read(args[1])) + '\n');
  } else {
    const brief = read(args[0]);
    const providers = read(args[1]);
    const text = report(brief, providers);
    const invented = audit(text, brief, providers);
    if (invented.length) {
      console.error('refusing: report contains amounts no provider stated: ' + invented.join(', '));
      process.exit(2);
    }
    process.stdout.write(text);
  }
}

// Call-for-me booking agent: the policy core that sits between speech and the phone line.
// Speech-to-text turns what the business says into events; this module decides what the
// agent says back, what it may accept, when it may call, and what it reports.

const REQUIRED = ['business', 'phone', 'timezone', 'date', 'windowStart', 'windowEnd', 'partySize', 'bookingName', 'callbackNumber', 'language'];

export function checkBrief(brief) {
  const missing = REQUIRED.filter((k) => brief[k] === undefined || brief[k] === '');
  if (brief.windowStart && brief.windowEnd && brief.windowStart >= brief.windowEnd) missing.push('window (start must be before end)');
  return missing;
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Local wall-clock time and weekday at the business, from a UTC instant.
function localParts(isoUtc, timezone) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(isoUtc)).map((x) => [x.type, x.value]));
  return { day: p.weekday.toLowerCase(), time: `${p.hour}:${p.minute}` };
}

export function isOpen(brief, isoUtc) {
  const { day, time } = localParts(isoUtc, brief.timezone);
  return (brief.openingHours?.[day] ?? []).some(([from, to]) => toMin(time) >= toMin(from) && toMin(time) < toMin(to));
}

// An offer is acceptable only if it matches the brief, or one of the buyer's listed alternatives.
export function withinBrief(brief, offer) {
  const options = [{ date: brief.date, windowStart: brief.windowStart, windowEnd: brief.windowEnd, partySize: brief.partySize }, ...(brief.alternatives ?? [])];
  return options.some((o) => offer.date === o.date && offer.partySize === o.partySize
    && toMin(offer.time) >= toMin(o.windowStart) && toMin(offer.time) <= toMin(o.windowEnd));
}

export function opening(brief) {
  return `Hello, this is an AI assistant calling on behalf of ${brief.bookingName}. ` +
    `I would like to book a table for ${brief.partySize} on ${brief.date}, between ${brief.windowStart} and ${brief.windowEnd}. Do you have anything?`;
}

// One call. events: what the business said, already classified by the speech layer.
// Returns what the agent said and the outcome of this attempt.
export function runCall(brief, events) {
  const said = [];
  const offered = [];
  let booked = null;
  let pending = null;
  let flag = null;
  for (const e of events) {
    if (e.type === 'no_answer' || e.type === 'busy' || e.type === 'voicemail') {
      return { outcome: e.type, said, offered, booked: null, flag };
    }
    if (e.type === 'greeting') said.push(opening(brief));
    else if (e.type === 'asks_if_ai') said.push(`Yes, I am an AI assistant. I am calling for ${brief.bookingName}.`);
    else if (e.type === 'asks_detail') {
      const answers = { name: brief.bookingName, partySize: String(brief.partySize), callback: brief.callbackNumber, requests: brief.specialRequests || 'No special requests.' };
      said.push(answers[e.field] ?? 'I do not have that detail. The customer will confirm it with you directly.');
    } else if (e.type === 'offer') {
      if (withinBrief(brief, e)) {
        pending = { date: e.date, time: e.time, partySize: e.partySize };
        said.push(`Yes please, ${e.date} at ${e.time} for ${e.partySize}, under the name ${brief.bookingName}.`);
      } else {
        offered.push({ date: e.date, time: e.time, partySize: e.partySize });
        const alts = (brief.alternatives ?? []).map((a) => ` or ${a.date} between ${a.windowStart} and ${a.windowEnd}`).join('');
        // Ask about the window and alternatives once; a second refusal ends the call.
        const ask = offered.length === 1 ? ` Is anything free between ${brief.windowStart} and ${brief.windowEnd}${alts}?` : '';
        said.push(`Thank you, but ${e.time} is outside what my customer can do, so I cannot accept it. I will pass the offer on to them.${ask}`);
      }
    } else if (e.type === 'asks_payment') {
      flag = `business asked for ${e.what}`;
      pending = null;
      said.push('I am not able to give card details or agree to a deposit or fee. I will ask my customer and they can call you back. Thank you.');
      return { outcome: 'needs_buyer', said, offered, booked: null, flag };
    } else if (e.type === 'confirm' && pending) {
      // Booked only when the business states back the same date, time, name and size.
      const same = e.date === pending.date && e.time === pending.time && e.partySize === pending.partySize && e.name === brief.bookingName;
      if (same) booked = { ...pending, name: e.name, confirmation: e.confirmation ?? null };
      else said.push(`Sorry, to check: ${pending.date} at ${pending.time}, ${pending.partySize} people, name ${brief.bookingName}?`);
    } else if (e.type === 'no_availability' || e.type === 'refuse') {
      said.push('I understand. Thank you for your time.');
      return { outcome: e.type === 'refuse' ? 'refused' : 'not_available', said, offered, booked: null, flag };
    }
  }
  return { outcome: booked ? 'booked' : 'not_available', said, offered, booked, flag };
}

// Calls a business until booked, refused or out of retries. Busy and no answer retry only
// inside opening hours, up to the cap published in the listing.
export function runJob(brief, schedule, calls, { maxAttempts = 3 } = {}) {
  const attempts = [];
  let placed = 0;
  for (let i = 0; i < schedule.length && placed < maxAttempts; i++) {
    if (!isOpen(brief, schedule[i])) { attempts.push({ at: schedule[i], outcome: 'skipped_closed' }); continue; }
    const r = runCall(brief, calls[placed++] ?? [{ type: 'no_answer' }]);
    attempts.push({ at: schedule[i], ...r });
    if (!['no_answer', 'busy', 'voicemail'].includes(r.outcome)) break;
  }
  return attempts;
}

const T = {
  en: { title: 'Booking report', status: 'Status', booked: 'BOOKED', not_available: 'NOT BOOKED: nothing available inside your window', no_answer: 'NOT BOOKED: no answer within the retry limit', refused: 'NOT BOOKED: the business declined', needs_buyer: 'NOT BOOKED: needs your decision', details: 'Booking', conf: 'Confirmation number', none: 'none given', offers: 'Offered but not accepted (outside your window)', attempts: 'Attempts', flag: 'Needs you' },
  es: { title: 'Informe de reserva', status: 'Estado', booked: 'RESERVADO', not_available: 'NO RESERVADO: no había nada dentro de su horario', no_answer: 'NO RESERVADO: sin respuesta dentro del límite de intentos', refused: 'NO RESERVADO: el negocio lo rechazó', needs_buyer: 'NO RESERVADO: necesita su decisión', details: 'Reserva', conf: 'Número de confirmación', none: 'no se dio', offers: 'Ofrecido pero no aceptado (fuera de su horario)', attempts: 'Intentos', flag: 'Requiere su atención' },
};

export function report(brief, attempts) {
  const t = T[brief.language] ?? T.en;
  const last = [...attempts].reverse().find((a) => a.outcome !== 'skipped_closed') ?? { outcome: 'no_answer' };
  const status = ['busy', 'voicemail'].includes(last.outcome) ? 'no_answer' : last.outcome;
  const lines = [`# ${t.title}: ${brief.business}`, '', `${t.status}: ${t[status]}`];
  if (last.booked) {
    const b = last.booked;
    lines.push(`${t.details}: ${b.date} ${b.time}, ${b.partySize}, ${b.name}`, `${t.conf}: ${b.confirmation ?? t.none}`);
  }
  if (last.flag) lines.push(`${t.flag}: ${last.flag}`);
  const offers = attempts.flatMap((a) => a.offered ?? []);
  if (offers.length) lines.push('', `${t.offers}:`, ...offers.map((o) => `- ${o.date} ${o.time}, ${o.partySize}`));
  lines.push('', `${t.attempts}:`, ...attempts.map((a, i) => `${i + 1}. ${a.at} ${a.outcome}`));
  return lines.join('\n') + '\n';
}

// The report may only claim a booking that the business confirmed on the call.
export function audit(text, attempts) {
  const booked = attempts.find((a) => a.booked)?.booked;
  const claims = /BOOKED\b|RESERVADO\b/.test(text.replace(/NOT BOOKED|NO RESERVADO/g, ''));
  if (claims && !booked) return ['report says booked, but no booking was confirmed'];
  if (booked && !text.includes(`${booked.date} ${booked.time}, ${booked.partySize}, ${booked.name}`)) return ['booking details differ from the confirmation'];
  return [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const attempts = runJob(s.brief, s.schedule, s.calls, s.options);
  for (const a of attempts) for (const line of a.said ?? []) console.error(`agent: ${line}`);
  process.stdout.write(report(s.brief, attempts));
}

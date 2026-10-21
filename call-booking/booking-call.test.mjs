import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkBrief, isOpen, runJob, report, audit } from './booking-call.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const run = (s) => { const attempts = runJob(s.brief, s.schedule, s.calls, s.options); return { attempts, text: report(s.brief, attempts) }; };

test('no call before the brief is complete', () => {
  const { brief } = load('booked');
  assert.deepEqual(checkBrief(brief), []);
  assert.deepEqual(checkBrief({ ...brief, callbackNumber: '', windowEnd: '18:00' }), ['callbackNumber', 'window (start must be before end)']);
});

test('books inside the window, discloses AI up front and when asked, report matches the confirmation', () => {
  const { attempts, text } = run(load('booked'));
  assert.match(attempts[0].said[0], /^Hello, this is an AI assistant calling on behalf of Hansen/);
  assert.match(attempts[0].said[1], /^Yes, I am an AI assistant/);
  assert.match(text, /Status: BOOKED\nBooking: 2026-10-30 19:30, 4, Hansen\nConfirmation number: B-2231/);
  assert.deepEqual(audit(text, attempts), []);
});

test('only table outside the window: declines on the call, reports not booked with the offer, in the buyer language', () => {
  const { attempts, text } = run(load('outside-window'));
  assert.match(attempts[0].said[1], /outside what my customer can do, so I cannot accept it\. I will pass the offer on to them\. Is anything free between 19:00 and 20:30 or on 2026-10-31 between 18:00 and 19:00\?$/);
  assert.match(text, /Estado: NO RESERVADO/);
  assert.match(text, /fuera de su horario\):\n- 2026-10-30 21:30, 4/);
  assert.deepEqual(audit(text, attempts), []);
});

test('deposit or card request: refuses, does not book, hands the decision to the buyer', () => {
  const { attempts, text } = run(load('deposit'));
  assert.equal(attempts[0].booked, null);
  assert.match(attempts[0].said.at(-1), /not able to give card details or agree to a deposit/);
  assert.match(text, /needs your decision\nNeeds you: business asked for a 200 NOK per person deposit by card/);
});

test('busy and no answer retry inside opening hours only, then book an approved alternative', () => {
  const { attempts, text } = run(load('retries'));
  assert.deepEqual(attempts.map((a) => a.outcome), ['skipped_closed', 'busy', 'no_answer', 'booked']);
  assert.match(text, /Booking: 2026-10-31 18:30, 4, Hansen\nConfirmation number: none given/);
});

test('voicemail is never a booking, and retries stop at the published cap', () => {
  const { attempts, text } = run(load('voicemail'));
  assert.equal(attempts.length, 3);
  assert.match(text, /no answer within the retry limit/);
});

test('opening hours use the business time zone', () => {
  const { brief } = load('booked');
  assert.equal(isOpen(brief, '2026-10-27T10:30:00Z'), true);   // 11:30 Oslo
  assert.equal(isOpen(brief, '2026-10-27T21:30:00Z'), false);  // 22:30 Oslo, closed
});

test('the audit catches a report that claims a booking nobody confirmed', () => {
  const { attempts } = run(load('outside-window'));
  assert.deepEqual(audit('Status: BOOKED\n', attempts), ['report says booked, but no booking was confirmed']);
});

test('a confirmation with a different time is not accepted as booked', () => {
  const s = load('booked');
  s.calls[0][4] = { ...s.calls[0][4], time: '20:45' };
  const { attempts, text } = run(s);
  assert.equal(attempts[0].booked, null);
  assert.match(attempts[0].said.at(-1), /^Sorry, to check/);
  assert.doesNotMatch(text.replace('NOT BOOKED', ''), /BOOKED/);
});

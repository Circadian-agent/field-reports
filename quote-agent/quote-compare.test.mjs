import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { report, audit, requestMessage } from './quote-compare.mjs';

const brief = JSON.parse(readFileSync(new URL('./fixtures/ac/brief.json', import.meta.url)));
const providers = JSON.parse(readFileSync(new URL('./fixtures/ac/providers.json', import.meta.url)));

test('every amount in the report was stated by a provider', () => {
  assert.deepEqual(audit(report(brief, providers), brief, providers), []);
});

test('the audit catches an invented price', () => {
  assert.deepEqual(audit(report(brief, providers) + '\nTypical cost: $7,500\n', brief, providers), ['$7,500']);
});

test('declined and silent providers stay in the report', () => {
  const r = report(brief, providers);
  assert.match(r, /Provider D HVAC \(email\): declined/);
  assert.match(r, /Provider E Air Pros \(phone\): no reply/);
});

test('over-budget quotes are marked, not hidden', () => {
  assert.match(report(brief, providers), /Provider C Mechanical \| \$10,200 \| firm \| not stated \| \*\*OVER budget\*\*/);
});

test('scope differences and estimates are flagged', () => {
  const r = report(brief, providers);
  assert.match(r, /do not cover the same things/);
  assert.match(r, /Provider B Comfort Services \| \$6,900 \| estimate \| required/);
});

test('thin coverage reports the real count without padding', () => {
  const thin = [{ id: 'x', name: 'Only Provider', channel: 'email', status: 'no_reply', reply: '' }];
  const r = report({ ...brief, service: 'Chimney relining' }, thin);
  assert.match(r, /Contacted 1 providers: 0 quoted, 0 declined, 1 did not reply/);
  assert.equal(audit(r, brief, thin).length, 0);
});

test('request message discloses customer, AI, opt-out and hides buyer contact', () => {
  const m = requestMessage({ ...brief, buyer_contact: 'buyer@example.com' });
  assert.match(m, /AI agent/);
  assert.match(m, /on behalf of a customer/);
  assert.match(m, /reply "stop"/);
  assert.doesNotMatch(m, /buyer@example\.com/);
});

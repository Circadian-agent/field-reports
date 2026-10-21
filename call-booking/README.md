# Call-for-me booking agent: call policy core

Working sample by Circadian, an AI agent business operated for Aron (Webfiks, Norway).

This is the decision layer of a phone booking agent. The speech layer turns what the business
says into events (offer, confirm, asks if AI, asks for a deposit, busy, voicemail). This module
decides what the agent says back, what it may accept, when it may call, and what it reports.

- No call until the brief is complete: business, phone, time zone, date, window, party size,
  booking name, callback number and report language.
- The agent says it is an AI and who it calls for in its first sentence, and again if asked.
- It accepts only a time inside the buyer's window or a listed alternative. Anything else is
  declined on the call and reported as "offered, not accepted".
- It never gives card details or agrees to a deposit, prepayment or fee. It ends the call and
  hands the decision to the buyer.
- "Booked" needs the business to state back the same date, time, size and name. A mismatch gets
  a read-back question, not a booking. An audit refuses a report that claims a booking the call
  did not confirm.
- Busy, no answer and voicemail retry only inside the business's opening hours, in its own time
  zone, up to the cap in the listing.
- The report is written in the buyer's language (English and Spanish in this sample).

Nothing is recorded or stored here: the module keeps only status, times, booking details and
offers. Business names and numbers in the fixtures are placeholders. No real business was called.

```
node booking-call.mjs fixtures/outside-window.json   # agent lines on stderr, report on stdout
node --test booking-call.test.mjs                    # 9 tests
```

All five scenarios with their output: [sample-calls.md](sample-calls.md).

# Catering comparison proof

An offline, dependency-free Node.js sample by Circadian, an AI agent operated for Aron's business.
It demonstrates the reporting core for the Catering & Group Dining Agent brief.
Every vendor, contact, quote and reply in the fixtures is fictional.

Run with Node.js 22 or later:

```sh
node --test catering/report.test.mjs
node catering/demo.mjs /tmp/catering-proof-output
```

The demo writes a JSON report and a Markdown comparison for each of three scenarios.
The repository does not require package installation or credentials.

| Scenario | Vendors | Responses | Confirmed availability | Finding |
|---|---:|---:|---:|---|
| 40-person drop-off lunch | 4 | 3 | 2 | One silent vendor and one decline remain visible. Gluten-free stays unknown unless explicitly confirmed. |
| Private room for 12 | 3 | 3 | 3 | USD 72 exceeds the USD 60 budget. EUR 55 is not compared to a USD budget. |
| Buffet for 150 in a small town | 2 | 1 | 0 | A vendor with capacity 100 does not meet the headcount. No extra vendors are invented. |

What the code demonstrates:

- Preserve exact stated financial text. Do not multiply per-person prices into invented totals.
- Compare only an exact same-currency amount with the same budget basis. Unknown taxes or charges prevent marking the quoted amount below budget. This narrow comparison does not assess minimum spend or deposit affordability and says so in the report.
- Keep absent, contradictory and ambiguous facts unknown.
- Tie availability to the event's explicit time and required capacity.
- Retain every contacted vendor, including declines, silence and vendors whose scope needs rechecking.
- Include source IDs, timestamps, original reply text and SHA256 hashes.
- Reject contact logs that lack AI/customer disclosure, share buyer details, or contact a vendor after a stop request.
- Produce a final report at the collection cutoff even with no responses. Ignore later replies in that version.
- Prefer the latest reply without silently combining superseded quotes with newer availability.

The parser accepts only the explicit line format shown in `fixtures.mjs`. It does
not understand arbitrary vendor prose. Unsupported phrasing remains unknown.
This is deliberately narrower than a finished catering agent. A production
extractor would need separate tests against real, consented reply examples and
evidence for every extracted assertion. Exact timestamps must use the same
representation as the brief. Equivalent alternative timezone spellings are not
normalized for availability matching.

Scope evidence is supplied by the fixture and is not independently verified.
Reply hashes identify the input used; they do not authenticate a sender or prove
that a vendor statement is true. Dietary confirmation is a vendor statement,
not an allergy-safety guarantee.

There is no discovery, email, contact-form, phone, LLM, hosting, marketplace
integration, scheduled delivery, booking or payment code. The deadline test
proves deterministic report cutoff behavior, not an operating background timer.
Stop-request validation is an audit check, not a sending system or persistent
suppression list. For production, the sending path must enforce suppression
before sending, including across jobs.

Possible next production work, only after an agreed funded award: permitted
vendor discovery and contact, consent and suppression checks, reply ingestion,
evidence-grounded extraction, persistent job state, scheduled report delivery,
hosting, platform integration and acceptance tests against controlled inboxes.
This sample does not establish those capabilities and makes no delivery or
funding claim.

# Local services quote agent: comparison core

Working sample by Circadian, an AI agent business operated for Aron (Webfiks, Norway).

This is the report half of a quote-collection agent. It takes a buyer brief and the record
of every provider contacted, and builds a side-by-side comparison.

- Every price is copied from a provider's reply and shown with the sentence it came from.
- A built-in audit refuses to print a report that contains an amount no provider stated.
- Providers who declined or never replied stay in the report.
- Over-budget quotes are marked, not hidden.
- Scope differences (permit, disposal, materials, labor, warranty) and estimate-only quotes are flagged.
- The request message says it is from an AI agent acting for a customer, offers an opt-out,
  and never includes the buyer's contact details unless the buyer approved it.

Provider names in the fixtures are placeholders. No real business was contacted for this sample.

```
node quote-compare.mjs fixtures/ac/brief.json fixtures/ac/providers.json   # report
node quote-compare.mjs --message fixtures/ac/brief.json                    # outgoing request
node --test quote-compare.test.mjs                                         # 7 tests
```

Output for the AC replacement scenario: [sample-report.md](sample-report.md).

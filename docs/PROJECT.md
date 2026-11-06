# Project record: problem-details

## Objective

Provide RFC 9457 problem+json errors from a typed catalog with templated details, leak-safe error mapping, spec-compliant parsing and Markdown docs, so that one catalog is the source for HTTP responses, client parsing and error documentation.

Measurable outcome: the Vitest suite in `test/index.test.ts` asserts the byte-exact out-of-credit response body, the error codes thrown for each invalid input class, the 200-character message limit, the 65,536-byte default parse limit and the byte-exact Markdown table. The library is intended for Node.js backend teams that return HTTP errors and need stable codes and safe defaults for unexpected exceptions.

## Scope

In scope:

- The public API documented in the README: `defineCatalog`, `ProblemCatalog`, `HttpProblem`, `toResponse`, `fromError`, `parseProblem`, `catalogToMarkdown` and `ProblemError`.
- Serialisation as `application/problem+json` without a framework.
- Validation of catalog entries and extension members.
- Tolerant parsing of problem documents received from other services.

Out of scope:

- Framework middleware. The README shows an Express usage pattern only as a comment-free example; the library does not register handlers.
- Internationalisation of titles or details.
- `application/problem+xml` and any other media type.
- Content negotiation.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 461860 / 60471 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.5025 | factory ledger |

## Factory run u053 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2491 | 41442 | 0 | 4473 | 0.2101 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 469 | 6899 | 41477 | 0.0261 |
| fix-2 | claude-sonnet-5-5 | no | 10 | 1044 | 7292 | 71635 | 0.0359 |
| fix-3 | claude-sonnet-5-5 | no | 8 | 798 | 6553 | 55076 | 0.0299 |
| audit | claude-sonnet-5-5 | no | 10 | 2043 | 28596 | 93909 | 0.1013 |
| fix-4 | claude-sonnet-5-5 | no | 18 | 4089 | 13495 | 165810 | 0.0912 |
| docs | claude-haiku-5-5 | no | 26937 | 10586 | 0 | 0 | 0.0080 |

Total: $0.5025. Prices: Anthropic list prices.

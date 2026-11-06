# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suite in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Test files

- `test/index.test.ts` is the only test file. It imports from `../src/index.js`, so it exercises the public entry point.

The file contains these groups:

- `create and toResponse`: the RFC 9457 golden response body, frozen output, `type` built from `baseUri`, copy of extension values, `unknown_code`, `missing_param`, placeholder expansion (adjacent, spaced and literal braces), single-pass insertion of parameter values, rejection of reserved and invalid extension names, rejection of non-JSON values, nesting depth 32, extras validation, `toError`, `HttpProblem` messages, member order and status fallback in `toResponse`.
- `defineCatalog`: invalid codes, statuses, `baseUri` values and entries; the 1000-entry limit; sorted `codes()`; isolation from later mutation of the input.
- `fromError`: no leakage of messages, strings or `toJSON` values; truncated `exposeDetails`; unchanged problem for `HttpProblem`.
- `parseProblem`: ignored standard members of the wrong type, status range handling, member order, `maxBytes` in UTF-8 bytes, rejected roots and BOM, prototype-pollution keys, nesting depth, and error messages that do not echo input.
- `round trip`: a parsed problem re-serialises with `toResponse`.
- `catalogToMarkdown`: byte-exact golden table, backslash escaping and newline flattening, rejection of non-catalog values.
- `ProblemError`: stable code, name and 200-character message limit.

## Rules

- Coverage thresholds are set in `vitest.config.ts` and must not be lowered.
- Test through the public entry point (`src/index.ts`) and assert observable behavior: return values, thrown error codes and messages.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network, no real clock or randomness, no shared state between tests.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.

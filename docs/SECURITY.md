# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in
[../SECURITY.md](../SECURITY.md).

## Threat model

The library turns application errors into HTTP problem responses and parses problem documents from other services. The threats below are those the code addresses or leaves open.

### Defended

- Information leakage from unexpected errors: `fromError` returns a fixed `about:blank` / Internal Server Error / 500 problem for any non-`HttpProblem` value. It never includes stacks or causes. The message is included only with `exposeDetails: true`, and then truncated to 200 characters.
- Prototype pollution: `parseProblem` builds its output with `Object.defineProperty` and drops `__proto__`, `constructor` and `prototype` at every level. Extension names with these keys are rejected by `create` and `toResponse`.
- Oversized input: `parseProblem` rejects documents above `maxBytes` (default 65,536 UTF-8 bytes) with `too_large` before calling `JSON.parse`.
- Deep nesting: parsed and extension values deeper than 32 levels are rejected.
- Non-serialisable extension values: functions, symbols, bigints, non-finite numbers, class instances other than plain objects, cyclic structures and oversized extension trees are rejected.
- Template injection: placeholders are expanded in one left-to-right pass, so a parameter value that contains `{name}` is inserted literally.
- Shared mutable state: caller-supplied extension values and catalog entries are copied and frozen, so later mutation does not change a problem or catalog.
- Error message echo: `ProblemError` messages are truncated to 200 characters, and lookups echo at most 50 characters of the offending input.

### Not defended

- Sensitive content passed deliberately: `exposeDetails: true` copies the whole error message, truncated to 200 characters, into the response. The library cannot know whether that text is sensitive.
- Sensitive extensions or details supplied by the caller: `create` and `toResponse` send whatever extension members and parameters the caller provides. The library does not redact them.
- HTML or script injection in consumers: the body is JSON with standard escaping, but `detail` and `title` strings are not sanitised for HTML contexts.
- Malicious but valid problem documents: `parseProblem` does not fetch the `type` URI, does not verify the origin of the document and does not authenticate the sender.
- Authentication, authorisation and rate limiting: outside the scope of the library.
- Resource use beyond the limits: the byte limit bounds parsing, but the library does not limit the time spent by callers that handle the returned values.
- Status code semantics: the library does not decide whether an error should be exposed to a particular client; that decision belongs to the application.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The library has no runtime dependencies. Development dependencies are limited to the toolchain listed in [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction, `node:` imports or shelling out from library code.
- Inputs from callers are validated and rejected with a `ProblemError` that has a stable code.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.

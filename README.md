# problem-details

[![npm version](https://img.shields.io/npm/v/@trysac/problem-details.svg)](https://www.npmjs.com/package/@trysac/problem-details)
[![license: MIT](https://img.shields.io/npm/l/@trysac/problem-details.svg)](LICENSE)
[![CI](https://github.com/Trysac/u053-problem-details/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u053-problem-details/actions/workflows/ci.yml)

RFC 9457 problem+json errors from a typed catalog with templated details, leak-safe error mapping, spec-compliant parsing and Markdown docs.

## Problem

HTTP APIs return errors in ad-hoc shapes, leak stack traces in 500 responses and document error codes nowhere. RFC 9457 defines a standard body, but teams still need a catalog of stable codes, templated messages and a safe default for unexpected exceptions. This library makes one catalog the source for responses, client parsing and documentation.

## Install

```sh
npm install @trysac/problem-details
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies.

## Usage

```ts
import { catalogToMarkdown, defineCatalog, fromError, parseProblem, toResponse } from "@trysac/problem-details";

const catalog = defineCatalog(
  { "not-found": { status: 404, title: "Not found", detailTemplate: "No {item}." } },
  { baseUri: "https://example.com/probs/" },
);
const problem = catalog.create("not-found", { item: "user" }, { instance: "/users/1" });
const response = toResponse(problem); // { status, headers, body }
const safe = toResponse(fromError(new Error("db password"))); // 500, no message leaked
const parsed = parseProblem(response.body); // client side
console.log(catalogToMarkdown(catalog));
```

## API

| Export | Signature | Description |
|---|---|---|
| `defineCatalog` | `(entries, { baseUri }) => ProblemCatalog` | Validates and builds an immutable catalog of problem codes. |
| `ProblemCatalog` | `create(code, params?, extras?)`, `toError(code, params?, extras?)`, `codes()`, `describe(code)` | Creates frozen problem details, wraps them in `HttpProblem`, lists codes sorted alphabetically. |
| `HttpProblem` | `class extends Error { readonly problem }` | Error carrying a ready-to-send problem. |
| `toResponse` | `(problem) => { status, headers, body }` | Serialises a problem as `application/problem+json`. A missing status becomes 500. |
| `fromError` | `(error, { exposeDetails? }) => ProblemDetails` | Maps any thrown value to `about:blank` / Internal Server Error / 500. |
| `parseProblem` | `(text, { maxBytes? }) => ProblemDetails` | Parses an untrusted problem document for clients. |
| `catalogToMarkdown` | `(catalog) => string` | Markdown table `Code, Status, Title, Type` sorted by code, pipes escaped. |
| `ProblemError` | `class extends Error { readonly code }` | The only error type thrown by the library. |

Types exported with the API: `ProblemDetails`, `CatalogEntry`, `CatalogOptions`, `CreateExtras`, `ProblemResponse`, `FromErrorOptions`, `ParseOptions`, `ProblemErrorCode`.

### Errors

`ProblemError.code` is one of:

- `unknown_code`: `describe`, `create` or `toError` received a code not in the catalog.
- `missing_param`: a `{name}` placeholder has no string or finite number value in `params`.
- `invalid_extension`: an extension name or value is invalid, a standard member has the wrong type in `toResponse`, or `extras` is malformed.
- `invalid_catalog`: a code, status, title, template, entry count or `baseUri` violates the rules below.
- `parse_error`: `parseProblem` received invalid JSON, a non-object root, nesting deeper than 32 levels or an invalid `maxBytes`.
- `too_large`: the document exceeds `maxBytes`.

### Limits and options

- Catalog: at most 1000 entries; codes match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and are at most 100 characters.
- Status in catalog entries: integers 400 to 599.
- Titles and detail templates: at most 2000 characters.
- `baseUri`: absolute `https://` URI ending in `/`, at most 2048 characters, without whitespace, `?` or `#`.
- `instance`: at most 2048 characters.
- Extension names: `^[A-Za-z][A-Za-z0-9_]{2,}$`, never a standard member, `__proto__`, `constructor` or `prototype`.
- Extension values: JSON-serialisable, finite numbers only, plain objects or arrays, nesting at most 32 levels, at most 10,000 values per `create` call.
- Error messages: at most 200 characters, and they never echo more than 50 characters of caller input.
- `fromError` option `exposeDetails` (default off): copies the `Error` message, truncated to 200 characters, into `detail`. Stack and cause are never exposed.
- `parseProblem` option `maxBytes` (default 65,536): limit in UTF-8 bytes.
- Behavior difference: `parseProblem` ignores standard members of the wrong type, while `toResponse` rejects them with `invalid_extension`.

## Why not http-problem-details

`http-problem-details` models only the response body. This library adds a typed catalog of stable codes, templated details, leak-safe mapping of unexpected exceptions and tolerant client parsing, so one catalog serves responses, clients and documentation.

## Security

The threat model, including what the library does not defend against, is in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez

# Architecture

## Overview

`@trysac/problem-details` is a small, dependency-free TypeScript library published to npm as ES modules with type declarations. It provides RFC 9457 problem+json errors from a typed catalog, with templated details, leak-safe error mapping, spec-compliant parsing and Markdown documentation.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Every exported class, function and type is defined in this single file. Internal helpers are not exported. |

The package has one source module. Any new module must be listed here and re-exported from `src/index.ts` only if it is part of the public API.

## Boundaries

- No runtime dependencies and no `node:` imports; the code uses only ES2022 language features and the standard `URL`, `TextEncoder` and `JSON` globals.
- No I/O at import time. Functions are pure: they build or parse values and do not touch the network, file system or clock.
- Every failure is thrown as `ProblemError` with a stable `code`. `HttpProblem` is a separate error type that carries a ready-to-send problem object.
- Caller-supplied values are cloned and frozen before they enter a problem, so later mutation by the caller does not change it.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

No architecture decision records are included in this repository snapshot. Decisions that shape the code are visible in the rules above: zero dependencies, pure functions, and a single error type.

# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript (strict) | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | Maintained LTS lines with native ES modules. |
| Vitest + `@vitest/coverage-v8` | Tests and coverage | Fast, ESM-native, runs TypeScript without a build step. |
| Biome | Lint and format | One fast tool for both, single config file. |
| gitleaks | Secret scanning | Standard scanner; runs locally and in CI. |
| GitHub Actions + Dependabot | CI wrapper and updates | Runs the same local gates on Linux and Windows. |

The library itself has no runtime dependencies. The tools above are development dependencies only.

## Discarded

| Tool | Why not |
|---|---|
| ESLint + Prettier | Two tools and several configs where Biome covers both. |
| Jest | Needs extra transforms for ESM and TypeScript; slower. |
| Shell scripts for gates | Not portable to Windows; the gate runner is a Node script. |
| Bundlers (tsup, Rollup) | Unneeded for a small ESM library; `tsc` emits what is published. |

A new dependency or tool is recorded in the Used table with its purpose and reason, or in the Discarded table if it was evaluated and rejected.

# Contributing to flowstate-web

Conventions for the Vue chat frontend. Keep this short and practical.

## Test file naming

**Use `*.test.ts`. Do not use `*.spec.ts`.**

Both suffixes are picked up by Vitest, but mixing them in the same package
caused real confusion (two files for the same store, no rule for what
went where). Pick `.test.ts` because it matches the larger of the two
existing files (`chatStore.test.ts` was ~1600 LoC vs `chatStore.spec.ts`
~220 LoC) and survives a search-and-replace.

If you add a new test, name it `${subject}.test.ts` next to the source.
For multiple test files for one subject, use a topical infix:
`${subject}.${topic}.test.ts` (e.g. `chatStore.dispatch.test.ts`).

## Mocks

The chatStore tests use a single file-scoped `vi.mock('../api', ...)`
factory in `chatStore.test.ts`. Don't introduce a second factory in a
parallel test file — keep the file's mocks colocated so the per-test
overrides via `vi.mocked(...)` keep working.

## End-to-end tests

E2E lives in `e2e/*.spec.ts` (Playwright convention; this is the one
exception to the `.test.ts` rule). Stage the spec under the matching
`playwright.*.config.ts` if it needs a non-default backend.

## Type-drift

`src/types/index.ts` is hand-mirrored against
`internal/api/session_response.go`, which lives in the separate
**FlowState backend** repository. The contract spec at
`src/types/contract.spec.ts` enumerates every JSON tag the Go
SessionResponse emits and asserts each is mirrored. Adding a backend
field requires updating both files (and coordinating across repos).

## Commits

This is a standalone repository; commit with plain `git commit`. If a
change is AI-assisted, add an attribution trailer, e.g.
`AI-Generated-By: <tool> (<model>)`.

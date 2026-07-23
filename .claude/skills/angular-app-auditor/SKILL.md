---
name: angular-app-auditor
description: Deep production-readiness and security audit for Angular applications. Use this skill whenever the user asks to review, audit, check, or harden an Angular app or Angular/TypeScript code — including requests about security flaws, XSS, auth issues, leaked secrets, race conditions, RxJS bugs, memory leaks, subscription leaks, runtime errors, null/undefined crashes, change-detection problems, performance issues, or "is my app ready for production". Also trigger when the user shares Angular components, services, templates, guards, or interceptors and asks "what's wrong with this" or "find bugs", even if they don't say the word "audit".
---

# Angular App Auditor

Audit an Angular codebase for security flaws, race conditions, runtime errors, and production-readiness problems — then produce a severity-ranked report **and** apply fixes.

## Why this skill exists

Angular apps fail in production in predictable ways: an unsanitized `[innerHTML]` becomes stored XSS, an unswitched `valueChanges` subscription creates a race where stale search results overwrite fresh ones, a forgotten `takeUntil` leaks subscriptions until the tab crashes, a missing null guard throws `Cannot read properties of undefined` the first time an API returns an empty payload. Individually these look minor in code review; collectively they are the top causes of Angular production incidents. This skill front-loads that institutional knowledge so nothing gets missed.

## Workflow

Follow these phases in order. Do not skip Phase 1 — findings without codebase context produce false positives.

### Phase 1 — Recon (understand before judging)

1. Locate the project root (`angular.json` or `project.json` for Nx). If the user uploaded a zip, extract it first.
2. Read `package.json`: note the Angular major version, RxJS version, state-management libraries (NgRx, Akita, signals-only), HTTP client usage, and any security-relevant deps (`jwt-decode`, `crypto-js`, etc.). Version matters: `takeUntilDestroyed` only exists in v16+, standalone APIs in v14+, signals in v16+, zoneless in v18+. Never recommend an API the project's version doesn't have.
3. Read `angular.json` / environment files / `main.ts` to understand build configuration and how environments are wired.
4. Skim the directory tree to map the app: where services, guards, interceptors, and feature modules live.

### Phase 2 — Automated scan

Run the bundled scanner to flag suspicious patterns fast:

```bash
python scripts/scan.py <project-root> --json /tmp/scan-results.json
```

The scanner is intentionally noisy — it finds *candidates*, not confirmed issues. Every hit must be verified by reading the surrounding code in Phase 3. Never copy scanner hits straight into the report.

### Phase 3 — Deep review

Work through the four review areas. For each area, read the matching reference file **before** reviewing — they contain the specific patterns, the reasoning behind them, and correct fixes per Angular version:

| Area | Reference | Read when |
|---|---|---|
| Security (XSS, auth, secrets, CSRF, deps) | `references/security.md` | Always |
| Race conditions & RxJS misuse | `references/race-conditions.md` | Always |
| Runtime errors & null safety | `references/runtime-errors.md` | Always |
| Performance & production config | `references/performance-prod.md` | Always |

Prioritize reading, in order: interceptors and guards (they touch every request), services doing HTTP or state, components flagged by the scanner, templates using `innerHTML`/`bypassSecurity`, then everything else as time permits. For large codebases (>200 source files), tell the user you're sampling: cover all security-critical files fully, and a representative sample of components.

Verification discipline: a finding goes in the report only if you can point to the exact file, line, and a concrete failure scenario ("when X happens, Y breaks"). "This could theoretically be a problem" is not a finding — it's noise that erodes the user's trust in the real findings.

### Phase 4 — Report

Write the report to `audit-report.md` in the output directory. ALWAYS use this exact structure:

```markdown
# Angular Production Audit — <app name>
Angular <version> · <date> · <N> files reviewed

## Executive summary
2-4 sentences: overall risk posture, the single most urgent issue, and what "ready for production" would take.

## Findings

### 🔴 Critical — fix before any production deploy
### 🟠 High — fix this sprint
### 🟡 Medium — plan the fix
### 🔵 Low / hardening

Each finding:
#### [SEVERITY-N] Short title
- **File**: `path/to/file.ts:42`
- **Category**: Security | Race condition | Runtime error | Performance
- **What happens**: concrete failure scenario in production
- **Evidence**: the offending code, quoted briefly
- **Fix**: what to change (reference the patch you applied, if you applied one)

## What's done well
Brief — genuine good practices you observed. This calibrates the report: a review that only criticizes reads as a pattern-matcher, not a reviewer.

## Fixes applied
Table: finding ID → file changed → one-line description of the change.
```

Severity calibration:
- **Critical**: exploitable security flaw (XSS with user-controlled input, secrets in the bundle, broken auth) or a guaranteed runtime crash on a common path.
- **High**: race conditions with user-visible wrong behavior, memory/subscription leaks, auth logic that fails unsafe.
- **Medium**: crashes on plausible-but-uncommon paths, missing error handling on HTTP calls, performance issues users will feel.
- **Low**: hardening, missing headers, `any` types on external data, style-level risk.

### Phase 5 — Fixes

Apply fixes directly to the code for **Critical and High** findings, unless the user said report-only. For Medium/Low, apply fixes only when they are mechanical and safe (adding a null guard, `takeUntilDestroyed`); describe the fix in the report otherwise.

Rules for fixing:
- Fix the pattern the codebase already uses. If the app uses `takeUntil(this.destroy$)` everywhere, don't introduce `takeUntilDestroyed` in one file — consistency beats novelty.
- Never change public APIs, method signatures, or behavior beyond the fix itself.
- After editing, run `npx tsc --noEmit -p tsconfig.json` if dependencies are installed (or install with `npm ci` if quick) to confirm the project still type-checks. If you can't build, say so in the report and mark the patches "unverified — please build locally".
- Deliver changed files to the output directory preserving relative paths, plus the report. If many files changed, also produce a single `fixes.patch` (`git diff` format) so the user can apply everything at once.

## Scope boundaries

- This is static review. Do not claim an app is "secure" — say the reviewed code contains or doesn't contain the audited flaw classes. Recommend a dependency audit (`npm audit`) and note its results if node_modules/lockfile is available, but don't treat npm audit output as the review.
- Backend code (NestJS/Express APIs in the same repo) is out of scope unless the user asks; but DO flag frontend code that *trusts* the backend unsafely (e.g., rendering API HTML unsanitized).
- If the user pastes a single component rather than an app, skip Phases 1-2, review the snippet against all four reference files, and answer inline with the same severity framing — no report file needed unless asked.

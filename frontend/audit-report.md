# Angular Production Audit — my-app-frontend
Angular 16.2 · 2026-07-16 · 10 files reviewed (entire `frontend/` app)

## Executive summary

The Angular app under `frontend/` is a bare scaffold — one component, no services, HTTP calls, routing, guards, or interceptors — so the classic Angular incident classes (XSS, RxJS races, subscription leaks, null-safety crashes) have no code surface yet and none were found. What the audit did find is that the project **could not be installed or built at all**: the declared dependency versions were mutually incompatible, and `angular.json` contained a removed build option plus references to files that don't exist. All build blockers are fixed and verified with a passing production build. "Ready for production" now requires a real API URL in `environment.prod.ts` and, medium-term, an upgrade off Angular 16 (out of security support since late 2024).

## Findings

### 🔴 Critical — fix before any production deploy

*None. There is no exploitable code path or runtime-crash path in the current codebase — the blockers below fail loudly at install/build time rather than shipping broken.*

### 🟠 High — fix this sprint

#### [HIGH-1] Declared dependencies are mutually incompatible — `npm install` fails
- **File**: `package.json:23` (`zone.js`), `package.json:31` (`typescript`)
- **Category**: Performance / production config
- **What happens**: Anyone cloning the project and running `npm install` gets a hard ERESOLVE failure. `@angular/core@16.2` requires `zone.js@~0.13.0` (project declared `^0.14.0`) and `@angular/compiler-cli@16.2` requires `typescript >=4.9.3 <5.2` (project declared `^5.5.4`). There was also no lockfile, so nothing pinned a working resolution.
- **Evidence**: `npm error ERESOLVE unable to resolve dependency tree … peer zone.js@"~0.13.0" from @angular/core@16.2.12` and `peer typescript@">=4.9.3 <5.2" from @angular/compiler-cli@16.2.12`
- **Fix**: Pinned `zone.js` to `~0.13.0` and `typescript` to `~5.1.6`. Applied; install now succeeds and `package-lock.json` is generated. Commit the lockfile.

#### [HIGH-2] `extractCss` is a removed build option — production build fails
- **File**: `angular.json:35` (production configuration)
- **Category**: Performance / production config
- **What happens**: `ng build --configuration production` fails schema validation — `extractCss` was removed from `@angular-devkit/build-angular` in Angular 12 (it became the default behavior). Every production deploy is blocked.
- **Evidence**: `"extractCss": true` inside `configurations.production`
- **Fix**: Removed the option. Applied and verified with a passing production build.

#### [HIGH-3] `assets` references files that don't exist — build fails
- **File**: `angular.json:20`
- **Category**: Performance / production config
- **What happens**: The builder errors because `src/favicon.ico` and `src/assets` are listed as assets but neither exists on disk. Build blocked.
- **Evidence**: `"assets": ["src/favicon.ico", "src/assets"]` — `ls src/favicon.ico src/assets` → No such file or directory
- **Fix**: Set `"assets": []`. Applied. When you add real assets, recreate `src/assets/` and restore the entry.

#### [HIGH-4] `enableProdMode()` never called — production runs in dev mode
- **File**: `frontend/src/main.ts:4`
- **Category**: Performance
- **What happens**: This NgModule-bootstrapped app never calls `enableProdMode()`, so even a production build runs with dev-mode assertions and double change-detection passes on every cycle — a permanent ~2× change-detection tax plus a console warning advertising dev mode.
- **Evidence**: `main.ts` bootstrapped `AppModule` with no reference to `environment` or `enableProdMode`
- **Fix**: Added the standard `if (environment.production) { enableProdMode(); }` guard. Applied and build-verified.

#### [HIGH-5] Production API URL is a placeholder
- **File**: `frontend/src/environments/environment.prod.ts:3`
- **Category**: Security / production config
- **What happens**: The first service that uses `environment.apiUrl` will send every production request — potentially including auth credentials — to `https://example.com/api`, a third-party domain. Nothing consumes it yet, which is the only reason this isn't Critical.
- **Evidence**: `apiUrl: 'https://example.com/api'`
- **Fix**: **Not applied** — requires your real API origin. Replace before the first deploy; treat it as a release checklist item.

### 🟡 Medium — plan the fix

#### [MED-1] TypeScript strict mode and strict templates disabled
- **File**: `frontend/tsconfig.json`
- **Category**: Runtime error
- **What happens**: Without `strict`/`strictNullChecks`/`strictTemplates`, every future null-safety bug (`Cannot read properties of undefined` when an API returns an empty payload) and template type error surfaces at runtime in front of users instead of at compile time. With ~10 lines of app code, this is the cheapest moment it will ever be to enable.
- **Evidence**: `compilerOptions` had no `strict` flags and no `angularCompilerOptions` block at all
- **Fix**: Enabled the full Angular-CLI-default strict suite (`strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`) plus `angularCompilerOptions` with `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers`. Applied and build-verified.

#### [MED-2] Angular 16 is out of security support
- **File**: `package.json:13-23`
- **Category**: Security
- **What happens**: Angular 16 LTS ended November 2024 — no security patches for over 18 months. `npm audit` currently reports 48 advisories (28 high) in the toolchain, including webpack SSRF advisories, all requiring a major `@angular-devkit/build-angular` bump to clear. These are build-time (dev machine / CI) exposures, not shipped-bundle exploits, which keeps this Medium.
- **Evidence**: `npm audit` → “48 vulnerabilities (7 low, 13 moderate, 28 high) … fix available … @angular-devkit/build-angular@21 (breaking change)”
- **Fix**: **Not applied** (major-version migration, out of audit scope). Plan `ng update` stepwise 16→17→18+ before this app grows; it's dramatically cheaper now, at one component, than later.

### 🔵 Low / hardening

#### [LOW-1] No bundle budgets configured
- **File**: `angular.json` (production configuration)
- **Category**: Performance
- **What happens**: Bundle bloat lands unnoticed until users feel slow loads.
- **Fix**: Added standard budgets (initial 500 kB warn / 1 MB error; component styles 2 kB / 4 kB). Applied — current initial bundle is 130 kB raw / 40 kB transfer, comfortably inside.

#### [LOW-2] Deprecated `defaultProject` key in angular.json
- **File**: `angular.json:57`
- **Category**: Performance / config hygiene
- **What happens**: Harmless today (the CLI prints “Workspace extension with invalid name (defaultProject) found”), but it's removed in newer CLI majors and will become an upgrade papercut. Not fixed — one-line deletion whenever convenient.

## What's done well

- The production configuration already had the important flags right: `outputHashing: "all"` (no stale-cache-after-deploy incidents), `sourceMap: false`, `optimization` + `buildOptimizer` on, and the `environment.prod.ts` file replacement correctly wired.
- The API base URL lives in environment files rather than hardcoded in code, and there are no secrets, tokens, or credentials anywhere in the source.
- No `innerHTML`, no `bypassSecurityTrust*`, no `eval`/`new Function`, no direct DOM manipulation — the scaffold contains none of the audited XSS/injection anti-patterns.

## Fixes applied

All fixes verified: `npm install` succeeds and `ng build --configuration production` completes cleanly (130 kB initial bundle, hash `3f0af4c7`).

| Finding | File | Change |
|---|---|---|
| HIGH-1 | `package.json` | Pinned `zone.js` → `~0.13.0`, `typescript` → `~5.1.6` to match Angular 16 peer ranges |
| HIGH-2 | `angular.json` | Removed the removed-in-v12 `extractCss` option |
| HIGH-3 | `angular.json` | Emptied `assets` array (referenced files didn't exist) |
| HIGH-4 | `src/main.ts` | Added `enableProdMode()` guarded by `environment.production` |
| MED-1 | `tsconfig.json` | Enabled strict TypeScript + `strictTemplates` compiler suite |
| LOW-1 | `angular.json` | Added production bundle budgets |

Changes are in your working tree (5 files, `git diff -- frontend` to review). Note: this audit covered the Angular app in `frontend/` only — the Vite/React app at the repo root and the `backend/` code are out of scope. This is a static review of the flaw classes listed above, not a certification that the app is secure.

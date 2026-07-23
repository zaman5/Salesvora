# Performance & production-readiness review — Angular

Two halves: (A) will the app be *slow* in ways users feel, and (B) is the *build/deploy configuration* actually production-grade. Config problems are cheap to find and high-value — check them first.

## A. Production configuration (read angular.json + environments + main.ts)

- **Production build config**: `optimization`, `buildOptimizer` (or esbuild builder), `outputHashing: "all"` present; `sourceMap: false` (or hidden); `namedChunks: false`. Missing hashing → users get stale cached JS after deploys, the classic "it's broken until hard-refresh" incident → **High**.
- **Budgets**: `budgets` section present with meaningful limits. Absent → bundle bloat lands unnoticed → **Low/Medium**.
- **enableProdMode / environment wiring** (pre-standalone apps): confirm the prod environment file replacement actually happens and `enableProdMode()` is called — dev mode in prod means double change-detection runs → **High**.
- **API URLs**: environment.prod pointing at localhost/staging → **Critical** (ship-stopper).
- **console.log noise**: widespread console logging of data objects in prod (no stripping) → info leak + perf. **Low**, **Medium/High** if logging tokens, PII, or request bodies.
- **Service worker / caching**: if `@angular/service-worker` is used, check `ngsw-config.json` doesn't cache API calls with `performance` strategy where freshness matters (stale data forever) → **Medium**.
- **polyfills / target**: absurdly old browser targets ship large bundles → **Low**.

## B. Runtime performance

### Change detection
- Default CD strategy everywhere is fine for small apps — only flag when there's evidence of pressure: big tables, frequent updates, mouse/scroll handlers. Then suggest `ChangeDetectionStrategy.OnPush` (or signals in v16+) on the hot components → **Medium**.
- **Function calls in templates** — `{{ compute(row) }}`, `[disabled]="isValid()"` — run on *every* CD cycle. A `compute()` doing filtering/sorting inside `*ngFor` over N rows is O(N × CD frequency) → **Medium/High** on lists. Fix: pure pipes, memoized signals/computed, or precompute in TS on data change.
- Getters in templates hiding heavy work — same class of problem; grep `get ` in components used in hot templates.
- Event streams without throttling: `(scroll)`, `(mousemove)`, `window:resize` host listeners doing real work per event → CD storm → **Medium**. Fix: `runOutsideAngular` + throttle, or `fromEvent().pipe(throttleTime)`.

### Lists
- `*ngFor` on lists that get replaced by fresh arrays (typical after HTTP refetch) without `trackBy` → full DOM teardown/rebuild per refresh, flicker + lost focus/scroll → **Medium**, **High** on large lists (>100 rows) or frequent refresh.
- Rendering unbounded lists (no pagination/virtual scroll) where data can grow → **Medium**; suggest CDK virtual scroll.

### Bundling & loading
- **All routes eagerly loaded** (no `loadChildren`/`loadComponent` anywhere in a multi-feature app) → giant initial bundle → **Medium/High** depending on app size.
- Heavy libraries imported at top level for one-off use (`moment`, whole `lodash`, chart libs) — check imports; `import * as _ from 'lodash'` → **Medium**; suggest `lodash-es` per-function imports or lazy import().
- Barrel files (`index.ts` re-exporting everything) can defeat tree-shaking when combined with side-effectful modules → note only if bundle evidence exists.
- Images: no `NgOptimizedImage`/lazy loading on media-heavy pages → **Low/Medium**.

### Memory & long sessions
- Subscription leaks are covered in race-conditions.md — cross-reference, don't duplicate findings.
- Growing arrays/caches in root-provided services with no eviction (e.g., appending every websocket message forever) → tab death in long sessions → **Medium/High** for dashboard-style always-open apps.
- Detached DOM via manual `document.createElement`/listener registration without cleanup in `ngOnDestroy` → **Medium**.

### HTTP
- No caching of static reference data (same GET fired by every component that needs it) → suggest `shareReplay({bufferSize:1, refCount:true})` in the service or an interceptor cache → **Low/Medium**.
- Sequential dependent requests that could be parallel (`forkJoin`) → **Low**.
- Missing debounce on typeahead inputs (`valueChanges` → HTTP without `debounceTime`) → request storm → **Medium**.

## C. Report framing for this area

Perf findings need evidence proportional to severity: don't claim "this will be slow" for a 20-item list. Tie each finding to a user-visible symptom (jank while typing, stale page after deploy, white flash on refresh) — config findings to an operational incident ("next deploy, returning users get a broken app until hard refresh"). If you can't articulate the symptom, downgrade to Low or drop it.

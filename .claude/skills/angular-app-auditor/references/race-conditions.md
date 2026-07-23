# Race conditions & RxJS review — Angular

RxJS races are the hardest Angular bugs to reproduce and the most common source of "it showed the wrong data once" reports. The core question for every subscription: **what happens if this fires again before the previous emission finished its async work?**

## 1. The stale-response race (flattening operator misuse)

The classic: a source that re-fires (typeahead, route params, filter changes, refresh button) mapped to an HTTP call with `mergeMap` — or worse, a nested `subscribe`. Responses return out of order; the slow old request overwrites the fresh one.

```ts
// HIGH: type "ab", then "abc" — if "ab"'s response arrives last, UI shows results for "ab"
this.search.valueChanges.subscribe(term => {
  this.api.search(term).subscribe(r => this.results = r);  // nested subscribe = unswitchable
});
```

Correct operator per intent — check the *intent*, don't blanket-recommend switchMap:
| Intent | Operator | Wrong choice symptom |
|---|---|---|
| Only latest matters (search, route params, GET on param change) | `switchMap` | mergeMap/nested → stale overwrite |
| Every event must complete, order matters (queued saves) | `concatMap` | switchMap → **lost writes** (cancelled POSTs!) |
| Every event, order irrelevant (parallel independent fetches) | `mergeMap` | concatMap → needless serialization |
| Ignore while busy (submit button) | `exhaustMap` | switchMap → duplicate submits, cancelled first POST |

Severity guide: nested subscribes with reads → **High**. `switchMap` around a **mutation** (POST/PUT/DELETE) → **High**, it cancels the HTTP *subscription* mid-flight while the server may still apply the write — the user retries and duplicates it. Double-submit on buttons without `exhaustMap`/disable → **High** for payment/order flows, **Medium** otherwise.

## 2. Subscription leaks

Every `.subscribe()` in a component must have a completion story. Long-lived sources (subjects, stores, `valueChanges`, `interval`, router events) subscribed in components without teardown keep the component alive after destroy: memory grows, and destroyed components keep reacting (double navigation, duplicate toasts).

Acceptable completion stories:
- `takeUntilDestroyed()` (v16+; in constructor/injection context, or pass `DestroyRef`)
- `takeUntil(this.destroy$)` with `destroy$.next()` **and** `.complete()` in `ngOnDestroy` — flag if `next()` is missing or destroy$ is never fired
- Storing `Subscription` and `unsubscribe()` in `ngOnDestroy`
- `async` pipe (best — prefer suggesting this in fixes)
- Genuinely finite: `HttpClient` calls, `take(1)`, `first()` — do NOT flag these as leaks; that's a false positive that erodes trust.

`takeUntil` placement matters: it must be the **last** operator before subscribe (or at least after any `switchMap` to a long-lived inner) — `takeUntil` before a `shareReplay` or before a switch to a long-lived observable doesn't kill the inner. **Medium** when misplaced.

Severity: leak on a frequently created/destroyed component (list items, dialogs, routed pages) → **High**. Root/singleton component → **Low** (leaks once).

## 3. Shared state races

- **Parallel token refresh**: interceptor catches 401 → calls refresh → retries. If N requests 401 simultaneously and each triggers its own refresh, refresh-token rotation invalidates all but one → user logged out randomly. Look for a guard (`shareReplay`'d refresh in flight, or a `refreshing` subject queueing). Missing guard → **High**.
- **Guards/resolvers with shared service state**: two resolvers writing the same service field; last write wins nondeterministically → **Medium/High**.
- **`shareReplay` without `refCount: true`** (`shareReplay(1)`): keeps the source alive forever after all unsubscribe; with an HTTP source it also caches errors permanently — every later subscriber gets the stale error. **Medium**; **High** if it caches auth/user state across logout.
- **Cold observable double-execution**: an HTTP observable subscribed twice (e.g., once in TS, once via `async` pipe, or two async pipes on the same unshared source) fires **two network requests** — a correctness bug for non-idempotent calls, perf bug for GETs. Look for the same observable property used by multiple `| async` without `share()`/`shareReplay`. **Medium**, **High** if the call is a mutation.

## 4. Effects / NgRx-specific (when NgRx present)

- Effects using `switchMap` on save/delete actions → lost writes (**High**, same logic as above).
- Effects without `catchError` **inside** the flattening operator: one HTTP error kills the effect stream permanently — every subsequent action of that type is silently ignored until reload. **High**. The `catchError` must be on the inner observable, not the outer pipe.
- Selectors doing heavy work without memoization args, or effects dispatching actions that re-trigger themselves (infinite loop) → **Medium/Critical** respectively.

## 5. Zone / change-detection timing

- `setTimeout(..., 0)` used to "wait for Angular" or fix `ExpressionChangedAfterItHasBeenChecked` → symptom of a structural ordering bug; the race remains under load. **Medium**, and find the real cause (writing to parent state in `ngAfterViewInit`, etc.).
- Code running outside the zone (third-party callbacks, `runOutsideAngular`) that mutates bound state without `NgZone.run`/`ChangeDetectorRef` → UI updates "sometimes". **Medium**.
- Signals (v16+): `effect()` writing other signals without `allowSignalWrites` (throws), or circular signal updates → **Medium/High**.

## 6. Promise/async-await races

- `async ngOnInit` with sequential `await`s for independent data → not a race but a waterfall; suggest `Promise.all`/`forkJoin` (**Low/perf**).
- Un-awaited floating promises whose completion order matters (`this.save(); this.reload();` where save is async) → **High**.
- `Promise` results assigned to state after component may be destroyed (no cancellation story — promises can't be cancelled) → same leak/late-write class as §2, **Medium**.

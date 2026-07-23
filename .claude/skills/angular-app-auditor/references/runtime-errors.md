# Runtime errors & null safety review — Angular

The goal: find every place the app *will* throw `TypeError: Cannot read properties of undefined` or fail silently on a path a real user will hit. The most productive mindset: **assume every API response can be null, empty, missing fields, or an error** — then check whether the code survives.

## 1. Strictness config (check first — it sets the base rate)

Read `tsconfig.json`:
- `"strict": true` (or at least `strictNullChecks` + `strictTemplates` in `angularCompilerOptions`). If `strictNullChecks` is **off**, the whole codebase's null-safety is unverified by the compiler — report as **High** with a migration note, and weight your manual review toward null paths.
- `strictTemplates: false` means template type errors (wrong input types, null bindings) compile fine and throw at runtime → **Medium/High**.

## 2. The non-null assertion lie

Search `!\.` and `!;` (postfix `!`). Every `!` is a promise to the compiler that the developer must keep at runtime. Classify each:
- `@ViewChild('x') el!: ElementRef` used only after view init → fine.
- `route.snapshot.paramMap.get('id')!` → **Medium/High**: user edits the URL, gets `null`, app throws.
- `array.find(...)!` → **High**: empty result throws on the next property access.
- `user!.profile!.settings!` chains on async-loaded data → **High**: guaranteed crash before load completes if change detection runs first.

Fix pattern: replace with narrowing (`if (!x) return;`), `?.` + template `@if`/`*ngIf`, or proper typing. Don't just swap `!` for `?.` when downstream code needs the value — `?.` silently produces `undefined` and moves the crash (or a silent no-op) elsewhere. A silent no-op on a save button is *worse* than a crash.

## 3. API-boundary trust

- HTTP responses typed as interfaces are **assertions, not validation** — `this.http.get<User>(...)` does zero runtime checking. Look for code indexing into deep response paths (`res.data.items[0].name`) with no guards → **High** when the path includes arrays or optional server fields.
- `JSON.parse` without try/catch on anything from localStorage, query params, or websockets → **Medium** (corrupted storage = white screen on every load until cleared — a particularly nasty class because it persists).
- `localStorage.getItem(...)` returns `string | null`; direct `JSON.parse(localStorage.getItem('x'))` → throws on first visit. **Medium/High** if in an initializer/guard (blocks app boot).

## 4. Missing error handling on subscriptions

An HTTP subscribe without an error callback/`catchError`:
- In a component: error goes to the global handler; the UI just... doesn't update. Spinner spins forever. **Medium** generally, **High** when a loading flag is set before the call and only cleared in `next` (search for `loading = true` patterns — the cleanup belongs in `finalize()`).
- In `combineLatest`/`forkJoin`: one inner error kills the whole combination → all-or-nothing screens. **Medium/High**; fix = per-source `catchError(() => of(fallback))`.
- Global `ErrorHandler`: check whether one is provided and whether it reports somewhere (Sentry etc.). None in a production app → **Medium** (errors vanish; the team can't see production breakage).

## 5. Lifecycle & template crashes

- Accessing `@ViewChild`/`@ContentChild` in `ngOnInit` (before `AfterViewInit`) → undefined. With `{ static: true }` on a query inside `*ngIf` → always undefined. **High**.
- `@Input` used in constructor (inputs not set yet) → **High**.
- `ngOnChanges` reading `changes.someInput.currentValue` without checking the key exists (fires per changed input, not all) → **Medium**.
- Template calls to methods on possibly-null objects without guard: `{{ user.name }}` where `user: User | undefined` and `strictTemplates` off → **High**.
- `| async` on an observable that can error → template just stops updating; combine with §4.
- `trackBy` absent on big `*ngFor` lists isn't a crash (that's performance-prod.md), but `*ngFor` over a possibly-undefined array throws in older Angular / is silently empty in newer — verify which behavior their version has before flagging severity.

## 6. Unsafe casts & `any` laundering

- `as unknown as T`, `<T>` casts, `$any()` in templates on external data: each is a place where runtime shape can diverge from compile-time type. Flag clusters of these around API/storage boundaries → **Medium**, escalate if the cast feeds security decisions.
- `catch (e)` then `e.message` — `e` is `unknown` (or `any`); non-Error throws break the error handler itself → **Low/Medium**.

## 7. Silent-failure patterns worth naming in the report

- Empty `catch {}` or `catchError(() => EMPTY)` with no logging/user feedback → data loss the user never learns about. **Medium**, **High** on save paths.
- `filter(x => !!x)` used to "fix" a null emission upstream — verify nothing awaits an emission that now never comes (spinner-forever). **Medium**.
- Optional chaining on function calls `this.callback?.()` where the callback being unset indicates a wiring bug — silently doing nothing. Case-by-case.

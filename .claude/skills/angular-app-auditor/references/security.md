# Security review — Angular

Angular sanitizes interpolated values by default, so most Angular XSS comes from code that *opts out* of that protection or runs outside Angular's rendering. Hunt for the opt-outs.

## 1. XSS

### bypassSecurityTrust* — the #1 source of Angular XSS
Search: `bypassSecurityTrustHtml|bypassSecurityTrustUrl|bypassSecurityTrustResourceUrl|bypassSecurityTrustScript|bypassSecurityTrustStyle`

A bypass is only safe when the input is a compile-time constant or provably app-controlled. It is a **Critical** finding when the bypassed value contains anything user-influenced: route params, query strings, form input, API responses containing user-generated content, localStorage.

```ts
// CRITICAL: userBio came from the API = stored XSS for every viewer
this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(user.bio);
```
Fix: remove the bypass and let `[innerHTML]` sanitize; if rich text is required, sanitize server-side with an allowlist (DOMPurify) *then* bind normally. `DomSanitizer.sanitize(SecurityContext.HTML, value)` is the in-Angular option.

### [innerHTML] binding
`[innerHTML]="x"` is auto-sanitized (scripts stripped) but still allows content injection: attacker-controlled links, images (tracking/CSP probing), CSS-ish layout abuse, and phishing content. Flag as **Medium** when bound to user/API content without explicit sanitization strategy; **Critical** if combined with a bypass.

### Direct DOM manipulation — sanitizer never runs
Search: `\.innerHTML\s*=`, `insertAdjacentHTML`, `document.write`, `outerHTML\s*=`, jQuery `.html(`
Any of these with dynamic input is **Critical** — Angular's sanitizer only covers template bindings. Also flag `ElementRef.nativeElement` writes of dynamic strings.

### URL-context injections
- `<a [href]="userUrl">` — Angular blocks `javascript:` here, OK.
- But `window.location.href = userInput`, `window.open(userInput)` are NOT protected → **High** (open redirect / `javascript:` in old browsers). Validate protocol allowlist (`http:`/`https:`) first.
- `<iframe [src]>` requires `bypassSecurityTrustResourceUrl` — treat any dynamic iframe src as **Critical** unless origin-allowlisted.

## 2. Secrets in the frontend

Everything shipped to the browser is public. Search source + environment files for:
- `apiKey`, `api_key`, `secret`, `password`, `private`, `token` assignments with literal values
- `environment.ts` / `environment.prod.ts` containing anything beyond public config (API base URLs, public keys like Stripe publishable / Firebase config are fine)
- Hardcoded JWTs, basic-auth headers (`Authorization: 'Basic ...'` with literal creds)

A private key, service-account secret, or password literal is **Critical** regardless of file. Note: moving it to an environment file does NOT fix it — the fix is a backend proxy that holds the secret. Also remind the user to rotate the leaked credential; deleting it from the code doesn't un-leak it from git history.

## 3. Authentication & authorization

### Guards are UX, not security
A route guard hides UI; the API must enforce authz. Flag (**High**) when the app clearly relies on guards alone — e.g., admin API endpoints called with no evidence of server-side checks, or role checks done by decoding the JWT client-side and *trusting* the result for data access decisions. Client-side role checks for *display* purposes are fine.

### Token storage & handling
- Tokens in `localStorage`/`sessionStorage`: XSS-readable. This is common practice, so alone it's **Low/Medium** hardening advice (prefer httpOnly cookies), but it *escalates any XSS finding to account takeover* — say so in the report.
- JWT decoded without validation is fine client-side (server validates), but flag **High** if expiry isn't checked before use, causing silent 401 loops, or if the refresh flow has a race (see race-conditions.md — concurrent 401s triggering parallel refreshes).

### Interceptor mistakes (read every interceptor fully)
- Attaching the auth header to **all** requests including third-party origins → token leak to external hosts. **Critical**. Fix: allowlist your API origin(s).
- Catch-all error interceptor that swallows 401/403 without redirect/refresh → users silently see broken screens. **Medium**.
- Logging interceptors that log full request bodies (passwords on login!) to console or a logging endpoint. **High**.

## 4. CSRF
If auth uses cookies, Angular's `HttpClientXsrfModule`/`withXsrfConfiguration` only auto-attaches the XSRF token for **relative** URLs and non-GET requests. Absolute URLs to the API bypass it silently — **High** if found. Token-in-header auth (Bearer) is inherently CSRF-resistant; don't flag CSRF there.

## 5. Template & compiler dangers
- Any use of `$any()` casts on external data, `eval(`, `new Function(` with dynamic strings → **Critical** for the latter two.
- JIT compilation of user-provided templates (rare; `Compiler` usage, dynamic `ComponentFactory` from strings) → **Critical**, equivalent to eval.

## 6. Dependencies & config
- If a lockfile exists and network allows: `npm audit --omit=dev --json` and summarize high/critical advisories. Do not paste the whole output.
- Angular version itself: majors older than the two currently-supported ones no longer receive security patches → **High** with the version noted.
- Check `index.html`/server config mentions of CSP. Absence of CSP is **Low** hardening advice, but if the team uses `unsafe-inline`+`unsafe-eval` in an existing CSP, note it undermines the CSP (**Medium**).
- Source maps shipped to prod (`"sourceMap": true` in production build config) → **Low** (aids attackers, leaks source).

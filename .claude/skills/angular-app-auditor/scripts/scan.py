#!/usr/bin/env python3
"""
Angular audit pattern scanner.

Flags CANDIDATE issues for human/LLM verification. High recall, low precision
by design — every hit must be verified in context before reporting.

Usage:
    python scan.py <project-root> [--json out.json]
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

SKIP_DIRS = {"node_modules", "dist", ".git", ".angular", "coverage", "out-tsc", ".nx"}
EXTS = {".ts", ".html", ".htm"}

# (category, pattern, note). Patterns applied per-line, case-sensitive unless noted.
PATTERNS = [
    # --- Security ---
    ("security", r"bypassSecurityTrust\w+", "Sanitizer bypass — verify input is not user-influenced"),
    ("security", r"\[innerHTML\]\s*=", "innerHTML binding — sanitized but allows content injection"),
    ("security", r"\.innerHTML\s*=", "Direct innerHTML write — sanitizer does NOT run"),
    ("security", r"insertAdjacentHTML|document\.write\(|\.outerHTML\s*=", "Raw DOM HTML injection"),
    ("security", r"\beval\s*\(|new\s+Function\s*\(", "Dynamic code execution"),
    ("security", r"window\.open\s*\([^'\")]|location\.href\s*=\s*[^'\"]", "Dynamic navigation — open-redirect risk"),
    ("security", r"(?i)(api[_-]?key|secret|password|passwd)\s*[:=]\s*['\"][^'\"]{6,}", "Possible hardcoded secret"),
    ("security", r"Authorization.{0,20}Basic\s+['\"a-zA-Z0-9+/=]", "Possible hardcoded basic-auth credentials"),
    ("security", r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}", "Hardcoded JWT-looking literal"),
    # --- Race conditions / RxJS ---
    ("race", r"\.subscribe\([^)]*=>\s*\{?[^}]*\.subscribe\(", "Nested subscribe (same line) — unswitchable race"),
    ("race", r"\bmergeMap\(", "mergeMap — verify out-of-order responses are acceptable"),
    ("race", r"\bswitchMap\([^)]*\.(post|put|delete|patch)\b", "switchMap over a mutation — cancelled writes"),
    ("race", r"shareReplay\(\s*1\s*\)", "shareReplay without refCount — permanent source / cached errors"),
    ("race", r"setTimeout\(\s*(\(\)\s*=>)?[^,]*,\s*0?\s*\)", "setTimeout(0) — often masking a CD ordering race"),
    ("race", r"ExpressionChangedAfterItHasBeenChecked", "Known CD-order issue referenced in code/comments"),
    # --- Subscriptions / leaks (verified in context vs takeUntil etc.) ---
    ("leak", r"\.subscribe\(", "Subscription — verify a completion story exists"),
    ("leak", r"\binterval\(|\bfromEvent\(|router\.events", "Infinite source — must be torn down"),
    # --- Runtime / null safety ---
    ("runtime", r"!\s*[.;,)\]]", "Non-null assertion — verify the promise holds at runtime"),
    ("runtime", r"JSON\.parse\(\s*localStorage", "JSON.parse(localStorage...) — throws on null/corrupt"),
    ("runtime", r"as\s+unknown\s+as\s+\w+|\$any\(", "Type laundering — runtime shape unverified"),
    ("runtime", r"catch\s*\(\s*\w*\s*\)\s*\{\s*\}", "Empty catch — silent failure"),
    ("runtime", r"catchError\(\s*\(\)?\s*(\w+)?\s*(=>)?\s*(EMPTY|of\(\s*(null|undefined|\[\])?\s*\))", "Swallowed error — verify user feedback exists"),
    ("runtime", r"\.snapshot\.paramMap\.get\([^)]*\)\s*!", "Route param asserted non-null — URL editing crashes"),
    # --- Performance / prod ---
    ("perf", r"\*ngFor\s*=\s*\"[^\"]*\"(?![^>]*trackBy)", "ngFor — check trackBy on large/refreshed lists"),
    ("perf", r"\{\{\s*\w+\([^)]*\)\s*", "Function call in interpolation — runs every CD cycle"),
    ("perf", r"import\s+\*\s+as\s+_\s+from\s+'lodash'|from\s+'moment'", "Heavy library import — bundle size"),
    ("perf", r"console\.(log|debug|info)\(", "Console logging — noise/leak in production"),
]

COMPILED = [(cat, re.compile(pat), note) for cat, pat, note in PATTERNS]

# Lines matching these reduce leak false-positives (reported as 'has_teardown_hint')
TEARDOWN_HINT = re.compile(r"takeUntil|takeUntilDestroyed|take\(1\)|first\(\)|toPromise|firstValueFrom|lastValueFrom|\.unsubscribe\(")


def scan_file(path):
    hits = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return hits
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        for cat, rx, note in COMPILED:
            if rx.search(line):
                hit = {"file": path, "line": i, "category": cat,
                       "note": note, "code": stripped[:200]}
                if cat == "leak" and TEARDOWN_HINT.search(line):
                    hit["has_teardown_hint"] = True
                hits.append(hit)
    return hits


def check_configs(root, findings):
    """Project-level config checks."""
    tsconfig = os.path.join(root, "tsconfig.json")
    if os.path.exists(tsconfig):
        try:
            txt = open(tsconfig, encoding="utf-8").read()
            compact = re.sub(r"\s", "", txt)
            strict_on = '"strict":true' in compact or '"strictNullChecks":true' in compact
            strict_off = '"strict":false' in compact or '"strictNullChecks":false' in compact
            if strict_off or not strict_on:
                findings.append({"file": tsconfig, "line": 0, "category": "runtime",
                                 "note": "strict/strictNullChecks disabled or missing — null safety unverified by compiler",
                                 "code": ""})
            if '"strictTemplates": true' not in txt.replace(" ", '" ').replace(" ", ""):
                if "strictTemplates" not in txt:
                    findings.append({"file": tsconfig, "line": 0, "category": "runtime",
                                     "note": "strictTemplates not enabled — template type errors surface at runtime",
                                     "code": ""})
        except OSError:
            pass
    ang = os.path.join(root, "angular.json")
    if os.path.exists(ang):
        try:
            txt = open(ang, encoding="utf-8").read()
            if '"outputHashing"' not in txt:
                findings.append({"file": ang, "line": 0, "category": "perf",
                                 "note": "No outputHashing config found — verify cache-busting on deploy",
                                 "code": ""})
            if '"budgets"' not in txt:
                findings.append({"file": ang, "line": 0, "category": "perf",
                                 "note": "No bundle budgets configured", "code": ""})
        except OSError:
            pass
    for env in ("src/environments/environment.prod.ts", "src/environments/environment.ts"):
        p = os.path.join(root, env)
        if os.path.exists(p):
            txt = open(p, encoding="utf-8", errors="replace").read()
            if "prod" in env and ("localhost" in txt or "127.0.0.1" in txt):
                findings.append({"file": p, "line": 0, "category": "perf",
                                 "note": "PROD environment points at localhost — ship-stopper",
                                 "code": ""})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()

    findings = []
    n_files = 0
    for dirpath, dirnames, filenames in os.walk(args.root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if os.path.splitext(fn)[1] in EXTS and not fn.endswith((".spec.ts", ".test.ts")):
                n_files += 1
                findings.extend(scan_file(os.path.join(dirpath, fn)))
    check_configs(args.root, findings)

    by_cat = defaultdict(list)
    for h in findings:
        by_cat[h["category"]].append(h)

    print(f"Scanned {n_files} source files — {len(findings)} candidate hits "
          f"(candidates, not confirmed findings)\n")
    for cat in ("security", "race", "leak", "runtime", "perf"):
        hits = by_cat.get(cat, [])
        if not hits:
            continue
        print(f"== {cat.upper()} ({len(hits)}) ==")
        for h in hits[:60]:
            tail = "  [teardown hint on line]" if h.get("has_teardown_hint") else ""
            loc = f"{h['file']}:{h['line']}" if h["line"] else h["file"]
            print(f"  {loc}  {h['note']}{tail}")
            if h["code"]:
                print(f"      {h['code'][:120]}")
        if len(hits) > 60:
            print(f"  ... and {len(hits) - 60} more")
        print()

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"files_scanned": n_files, "findings": findings}, f, indent=1)
        print(f"JSON written to {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Stamp index.html's asset URLs with their content hash.

Every server-rendered page gets ?v=<content hash> from assetV() in api/_seo.js, so a
changed file is automatically a changed URL. index.html is static and could not do
that, so its seven tokens were hand-picked integers — and twice in one session a file
changed while its number did not. /assets/* ships `immutable` for 30 days, so the old
bytes stay pinned at the edge and returning visitors keep running them.

Nobody picks a number now: the token IS the hash. scripts/render_health.py fails when
a token and its file disagree, and the fix is to run this.

    python3 scripts/stamp_assets.py [--check]
"""
import hashlib
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).resolve().parent.parent
# index.html's <link>/<script> tags, plus the hand-written data URLs in the client
# scripts: study.js's DECK_URL/ELEMENTS_URL fallbacks and the source-selection fetch,
# which is not a fallback at all. Same failure either way — a changed file behind an
# unchanged token is pinned at the edge for 30 days.
TARGETS = ["index.html", "assets/study.js", "assets/source-selection.js"]
# Same shape verify_deploy.py scrapes: /assets/<name>.<ext>?v=<token>
REF = re.compile(r"(/assets/([A-Za-z0-9._-]+\.(?:js|css|json))\?v=)([0-9a-f]+)")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def main():
    check = "--check" in sys.argv
    changed, missing, writes = [], [], []

    for rel in TARGETS:
        path = BASE / rel
        if not path.exists():
            continue
        text = path.read_text()

        def sub(m):
            name, token = m.group(2), m.group(3)
            f = BASE / "assets" / name
            if not f.exists():
                missing.append(name)
                return m.group(0)
            d = digest(f)
            # A file must not stamp its own URL: study.js referencing study.js would
            # chase a hash that changes the moment it is written.
            if f.resolve() == path.resolve():
                return m.group(0)
            if d != token:
                changed.append((rel, name, token, d))
            return m.group(1) + d

        out = REF.sub(sub, text)
        if out != text:
            writes.append((path, out))

    if missing:
        print("MISSING from assets/: " + ", ".join(sorted(set(missing))))
        return 1
    if not changed:
        print("Every asset token matches its content hash (%s)." % ", ".join(TARGETS))
        return 0
    for rel, name, old, new in changed:
        print(f"  {rel}: {name}: {old} -> {new}")
    if check:
        print("\nFAIL: asset tokens are stale. Run: python3 scripts/stamp_assets.py")
        return 1
    for path, out in writes:
        path.write_text(out)
    print(f"\nStamped {len(changed)} asset reference(s) across {len(writes)} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

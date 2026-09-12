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
INDEX = BASE / "index.html"
# Same shape verify_deploy.py scrapes: /assets/<name>.<ext>?v=<token>
REF = re.compile(r"(/assets/([A-Za-z0-9._-]+\.(?:js|css|json))\?v=)([0-9a-f]+)")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def main():
    check = "--check" in sys.argv
    html = INDEX.read_text()
    changed, missing = [], []

    def sub(m):
        name, token = m.group(2), m.group(3)
        f = BASE / "assets" / name
        if not f.exists():
            missing.append(name)
            return m.group(0)
        d = digest(f)
        if d != token:
            changed.append((name, token, d))
        return m.group(1) + d

    out = REF.sub(sub, html)

    if missing:
        print("MISSING from assets/: " + ", ".join(sorted(set(missing))))
        return 1
    if not changed:
        print("index.html: every asset token matches its content hash.")
        return 0
    for name, old, new in changed:
        print(f"  {name}: {old} -> {new}")
    if check:
        print("\nFAIL: index.html asset tokens are stale. Run: python3 scripts/stamp_assets.py")
        return 1
    INDEX.write_text(out)
    print(f"\nStamped {len(changed)} asset reference(s) in index.html.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

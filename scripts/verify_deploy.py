#!/usr/bin/env python3
"""Post-deploy gate: every versioned asset the live site references must actually
serve the bytes in this repo.

    python3 scripts/verify_deploy.py            # after a deploy settles
    python3 scripts/verify_deploy.py --wait 300 # poll until it agrees, or give up

WHY THIS EXISTS. /assets/* ships as `public, max-age=2592000, immutable` and the
cache key includes the query string, so a bumped ?v is supposed to be a guaranteed
cache miss. It is not. On 2026-09-11 `/assets/study.js?v=101` served 194,008 bytes
of the PREVIOUS build with `x-vercel-cache: HIT`, `cf-cache-status: HIT` and
`last-modified` eleven minutes before the deploy, while the same path with any other
query string returned the correct 196,464 bytes. A request that lands on the new URL
during the deploy window pins the old file to it — and `immutable` means neither the
edge nor the browser will ever revalidate. Three shipped features were invisible to
every user while the HTML claimed they were there.

Bumping the version mints a fresh URL and fixes the instance. Nothing detects the
next one, which is what this script is for. A cache purge for the exact URL is the
other remedy; content-hashed filenames would remove the failure mode entirely.
"""
import argparse
import hashlib
import pathlib
import re
import sys
import time
import urllib.request

SITE = "https://www.acqvault.com"
ROOT = pathlib.Path(__file__).resolve().parent.parent
# Pages whose HTML carries the versioned references we care about.
PAGES = ["/", "/study", "/48cons", "/source-selection"]
# Tokens are content hashes now (hex) for the server-rendered pages, still integers
# in the SPA's static index.html. Accept both.
ASSET_RE = re.compile(r'/assets/([A-Za-z0-9._-]+\.(?:js|css|json))\?v=([0-9a-f]+)')


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "acqvault-deploy-check"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


def digest(b):
    return hashlib.sha256(b).hexdigest()[:12]


def check():
    """Returns (ok, findings). A finding is (asset, local_digest, served_digest, headers)."""
    referenced = {}
    for page in PAGES:
        try:
            html, _ = fetch(SITE + page)
        except Exception as e:  # noqa: BLE001
            print("  ! could not fetch {} ({})".format(page, e))
            continue
        for name, ver in ASSET_RE.findall(html.decode("utf-8", "replace")):
            referenced.setdefault((name, ver), set()).add(page)

    if not referenced:
        print("  ! no versioned assets found — did the page shapes change?")
        return False, []

    findings = []
    # A worklist, not a flat loop: the HTML is not the only place a versioned asset is
    # referenced from. assets/study.js fetches /assets/study-deck.json?v=N and
    # study-elements.json?v=N from its own source, and those carry the SAME immutable
    # caching and the same stale-pin risk while being invisible to a scan of the pages.
    # A deck edit shipped behind a forgotten bump is silent: the HTML and the bundle both
    # look current. So every .js we verify gets scanned for further references, and those
    # get verified too, until nothing new turns up.
    seen = set()
    queue = sorted(referenced)
    while queue:
        name, ver = queue.pop(0)
        if (name, ver) in seen:
            continue
        seen.add((name, ver))
        local_path = ROOT / "assets" / name
        if not local_path.exists():
            findings.append((name + "?v=" + ver, "MISSING LOCALLY", "-", {}))
            continue
        local = digest(local_path.read_bytes())
        try:
            body, headers = fetch("{}/assets/{}?v={}".format(SITE, name, ver))
        except Exception as e:  # noqa: BLE001
            findings.append((name + "?v=" + ver, local, "FETCH FAILED: %s" % e, {}))
            continue
        served = digest(body)
        mark = "ok " if served == local else "STALE"
        print("  {}  /assets/{}?v={}  local {}  served {}".format(mark, name, ver, local, served))
        if served != local:
            findings.append((name + "?v=" + ver, local, served, headers))
            continue  # a stale bundle's references are the stale bundle's, not this repo's
        if name.endswith(".js"):
            for ref in ASSET_RE.findall(body.decode("utf-8", "replace")):
                if tuple(ref) not in seen:
                    queue.append(tuple(ref))
    return not findings, findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wait", type=int, default=0,
                    help="seconds to keep retrying while assets disagree")
    args = ap.parse_args()

    deadline = time.time() + args.wait
    while True:
        print("Deploy check — " + time.strftime("%H:%M:%S"))
        ok, findings = check()
        if ok:
            print("\nEvery versioned asset serves the bytes in this repo.")
            return 0
        if time.time() >= deadline:
            break
        print("  … disagreement; retrying in 20s")
        time.sleep(20)

    print("\n✗ STALE ASSETS SERVED — users are not running what was shipped.")
    for name, local, served, headers in findings:
        print("\n  {}\n    local  {}\n    served {}".format(name, local, served))
        for h in ("age", "last-modified", "x-vercel-cache", "cf-cache-status", "cache-control"):
            if headers.get(h):
                print("    {:16} {}".format(h + ":", headers[h]))
    print("\n  Fix: bump the version constant so the URL is new (STUDY_V / ANALYTICS_V /")
    print("  the ?v= in index.html), redeploy, and re-run. Purging that exact URL at the")
    print("  edge also works. The durable fix is content-hashed filenames.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Read-only upstream watch: has anything AcqVault mirrors moved since the corpus was built?

The site no longer shows a freshness banner, so staleness has to be caught here instead.
Runs every refresh.py probe in report-only mode, plus the RFO diff, and exits 1 when
something needs a supervised update. .github/workflows/upstream_watch.yml runs it weekly
and opens (or updates) a GitHub issue with the summary, so the owner gets an email.

    python3 scripts/upstream_watch.py            # exit 0 = current, 1 = needs attention
    python3 scripts/upstream_watch.py --md out   # also write the summary as markdown

Writes nothing in the repo except _local_archive/rfo-html (refresh_rfo's parse cache, git-ignored).
Not covered (sites block scripted access): DoD FMR (comptroller.war.gov), DAFI 63-138
(e-publishing.af.mil), DAF Contracting Compass (CAC). Those stay a manual check.
"""
import argparse
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh  # noqa: E402

VEHICLE_HORIZON_DAYS = 14   # a closing window this close needs a successor check now


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", help="write the summary as markdown to this path")
    args = ap.parse_args()

    findings, ok = [], []

    def probe(label, fn):
        try:
            msg, changed = fn()
        except Exception as e:  # noqa: BLE001 — a failed probe is a finding, not a pass
            msg, changed = "probe failed: {}".format(e), True
        (findings if changed else ok).append("**{}** — {}".format(label, msg))

    probe("R-DFARS memos (acquisition.gov hub)", refresh.check_rdfars)
    probe("R-DFARS vs DPCAP listing", refresh.check_dpcap)
    probe("R-DFARS coverage", refresh.check_rdfars_coverage)
    probe("FAR Companion PDF", lambda: refresh.check_static_pdf(
        "FAR Companion", refresh.SITE + "/sites/default/files/page_file_uploads/far-companion.pdf",
        "FAR Companion/*.pdf", download=False))
    probe("Category Management guide PDF", lambda: refresh.check_static_pdf(
        "Category Mgmt", refresh.SITE + "/sites/default/files/page_file_uploads/category-management-buying-guide.pdf",
        "Category Management/*.pdf", download=False))

    def rfo():
        existing = [d for d in refresh.load_docs() if d["source"] == "rfo"]
        _, added, modified, removed = refresh.refresh_rfo(existing)
        n = len(added) + len(modified) + len(removed)
        if not n:
            return "current", False
        names = ", ".join(d["title"].split(" ")[0] for d in (modified + added + removed)[:15])
        return "{} modified / {} added / {} removed ({}) — run python3 refresh.py".format(
            len(modified), len(added), len(removed), names), True
    probe("RFO text", rfo)

    def vehicles():
        w = refresh.vehicle_watch()
        soon = [s for s in w.get("closing_soon", [])
                if int(s.rsplit(", ", 1)[1].rstrip("d)")) <= VEHICLE_HORIZON_DAYS]
        bad = w.get("expired", []) + soon
        if w.get("parse_error"):
            return "vehicles.json does not parse: " + w["parse_error"], True
        if w.get("stale"):
            bad.append("directory last verified {}".format(w.get("verified_as_of")))
        return ("; ".join(bad), True) if bad else ("nothing closing within {} days".format(VEHICLE_HORIZON_DAYS), False)
    probe("Contract vehicles", vehicles)

    lines = ["# AcqVault upstream watch — {}".format(datetime.date.today().isoformat()), ""]
    if findings:
        lines += ["## Needs a supervised update", ""] + ["- " + f for f in findings] + [""]
    lines += ["## Current", ""] + ["- " + o for o in ok] + [""]
    lines += ["_Not machine-checkable (blocked or CAC): DoD FMR, DAFI 63-138, DAF Contracting Compass — check by hand._"]
    out = "\n".join(lines)
    print("\n" + out)
    if args.md:
        Path(args.md).write_text(out + "\n", encoding="utf-8")
    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()

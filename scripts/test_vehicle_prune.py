#!/usr/bin/env python3
"""Self-check for refresh.py's prune_expired_vehicles().

    python3 scripts/test_vehicle_prune.py

The prune deletes live site content, so the classes it must NOT touch matter as much
as the one it must: ordering_end null means "no published window" (GSA MAS, the ESI
agreements), not a closed one, and an unreadable date is a data bug rather than a
closure. Also asserts the ?v= cache key moves — without that the removal never
reaches a returning client, since /assets/* is immutable for 30 days.
"""
import datetime
import json
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import refresh  # noqa: E402

today = datetime.date.today()
past = (today - datetime.timedelta(days=1)).isoformat()
future = (today + datetime.timedelta(days=30)).isoformat()

tmp = pathlib.Path(tempfile.mkdtemp())
try:
    (tmp / "assets").mkdir()
    veh = {"verified_as_of": "2026-07-11", "vehicles": [
        {"id": "closed-yesterday", "name": "Closed", "ordering_end": past},
        {"id": "closes-today", "name": "Edge", "ordering_end": today.isoformat()},
        {"id": "open", "name": "Open", "ordering_end": future},
        {"id": "no-window", "name": "No window", "ordering_end": None},
        {"id": "garbage", "name": "Bad date", "ordering_end": "not-a-date"},
    ]}
    vpath = tmp / "assets" / "vehicles.json"
    vpath.write_text(json.dumps(veh, ensure_ascii=False, indent=2))
    wpath = tmp / "assets" / "widgets.js"
    wpath.write_text("fetch('/assets/vehicles.json?v=5').then(r => r.json())")

    refresh.VEHICLES_PATH = vpath
    refresh.BASE_DIR = tmp
    dropped = refresh.prune_expired_vehicles()

    ids = [d["id"] for d in dropped]
    assert ids == ["closed-yesterday"], "expected only the past entry dropped, got " + repr(ids)

    left = [v["id"] for v in json.loads(vpath.read_text())["vehicles"]]
    assert left == ["closes-today", "open", "no-window", "garbage"], repr(left)
    # a window that ends TODAY is still open for ordering — off-by-one here silently
    # deletes a vehicle on its last valid day
    assert "closes-today" in left
    assert "no-window" in left, "ordering_end null is 'no published window', not closed"
    assert "garbage" in left, "an unreadable date is a data bug, not a closure"

    assert "vehicles.json?v=6" in wpath.read_text(), "?v= key did not move — clients pin the old list"

    # no expired entries → no write, no bump
    wpath.write_text("fetch('/assets/vehicles.json?v=6').then(r => r.json())")
    assert refresh.prune_expired_vehicles() == []
    assert "vehicles.json?v=6" in wpath.read_text(), "bumped the cache key with nothing to prune"

    # formatting round-trips at indent=2 with no trailing newline, so real diffs stay
    # to the removed entries instead of reflowing all 1,753 lines
    real = (ROOT / "assets" / "vehicles.json").read_text()
    assert json.dumps(json.loads(real), ensure_ascii=False, indent=2) == real, \
        "assets/vehicles.json no longer round-trips — a prune would reflow the whole file"

    print("OK: prune drops only closed windows, keeps null/unreadable/last-day, bumps ?v=")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

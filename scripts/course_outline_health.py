#!/usr/bin/env python3
"""Gate: the course outline must cover the deck, exactly once each.

The Rise course layer (VOL1/VOL2 in assets/study.js) hand-authors section names and
lesson order. The cards come from the deck. Nothing at runtime notices when the two
drift: a topic missing from the outline is content no lesson ever shows, and a topic
listed twice inside one volume is a duplicate lesson with a colliding key. Both are
silent. This is the thing that fails instead.

    python3 scripts/course_outline_health.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = (ROOT / "assets" / "study.js").read_text()
DECK = json.loads((ROOT / "assets" / "study-deck.json").read_text())

# Thresholds enter recallPool() under a synthetic topic, not as a deck section.
SYNTHETIC = {"advanced": {"Thresholds & Numbers"}}


def outline(name):
    """Topic strings inside the `var <name> = [ ... ];` literal, in order."""
    m = re.search(r"\bvar %s = \[(.*?)\n  \];" % name, JS, re.S)
    if not m:
        sys.exit("FAIL: could not find `var %s = [...]` in assets/study.js" % name)
    # Each section is ['Section name', ['Topic', 'Topic', ...]] — topics are every
    # quoted string after the first one in each bracketed pair.
    topics = []
    for sec in re.findall(r"\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[(.*?)\]\s*\]", m.group(1), re.S):
        topics += [t.replace("\\'", "'") for t in re.findall(r"'((?:[^'\\]|\\.)*)'", sec[1])]
    return topics


def deck_topics(key):
    seen, order = set(), []
    for c in DECK[key]:
        t = c.get("topic", "")
        if t not in seen:
            seen.add(t)
            order.append(t)
    return order


bad = []
for vol, deck_key, level in (("VOL1", "recall_basic", "basic"), ("VOL2", "recall_advanced", "advanced")):
    listed = outline(vol)
    dupes = sorted({t for t in listed if listed.count(t) > 1})
    if dupes:
        bad.append("%s lists a topic twice, which collides on one lesson key: %s" % (vol, ", ".join(dupes)))
    have = set(listed)
    want = set(deck_topics(deck_key)) | SYNTHETIC.get(level, set())
    missing = sorted(want - have)
    extra = sorted(have - want)
    if missing:
        bad.append("%s is missing %d deck topic(s) — no lesson would ever show them:\n    %s"
                   % (vol, len(missing), "\n    ".join(missing)))
    if extra:
        bad.append("%s lists %d topic(s) the deck does not have — those lessons render empty and are dropped:\n    %s"
                   % (vol, len(extra), "\n    ".join(extra)))
    print("%s  %2d lessons listed, %2d topics in %s" % (vol, len(listed), len(want), deck_key))

if bad:
    print("\n".join("\nFAIL: " + b for b in bad))
    sys.exit(1)
print("\nCourse outline covers the deck, one lesson per topic per volume.")

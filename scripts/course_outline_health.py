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

# Threshold cards carry no topic of their own: recallPool() assigns one per card from
# THRESH_GROUPS, so those names are synthetic topics the deck never contains. Read them
# from the literal rather than restating them — restating is how this gate went stale
# when the single "Thresholds & Numbers" lesson became seven.
def thresh_groups():
    m = re.search(r"var THRESH_GROUPS = \[(.*?)\n  \];", JS, re.S)
    if not m:
        sys.exit("FAIL: could not find `var THRESH_GROUPS = [...]` in assets/study.js")
    return [g for g in re.findall(r"\[\s*'((?:[^'\\]|\\.)*)'\s*,", m.group(1))]


SYNTHETIC = {"advanced": set(thresh_groups())}


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
    # VOL2's last section is ['Numbers You Must Know', THRESH_GROUPS.map(...)] — a call,
    # not a bracketed list of string literals, so outline() cannot see those seven.
    if vol == "VOL2":
        listed = listed + thresh_groups()
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

# api/_seo.js derives the lesson counts it publishes as Course structured data straight
# from the deck's distinct topics. That only equals what the outline renders while the
# checks above hold, so assert the number here rather than leaving SEO to drift silently.
n_basic = len(outline("VOL1"))
n_adv = n_basic + len(outline("VOL2")) + len(thresh_groups())
seo = (ROOT / "api" / "_seo.js").read_text()
if "courseCounts" not in seo:
    bad.append("api/_seo.js no longer defines courseCounts(); the published lesson counts "
               "are unverified.")
else:
    derived_basic = len(deck_topics("recall_basic"))
    derived_adv = (derived_basic + len(deck_topics("recall_advanced"))
                   + (len(thresh_groups()) if DECK["thresholds"] else 0))
    if (derived_basic, derived_adv) != (n_basic, n_adv):
        bad.append("courseCounts() would publish %d/%d lessons; the outline renders %d/%d."
                   % (derived_basic, derived_adv, n_basic, n_adv))
    else:
        print("Published counts  %d Basic, %d Advanced \u2014 matches the outline" % (n_basic, n_adv))

if bad:
    print("\n".join("\nFAIL: " + b for b in bad))
    sys.exit(1)
print("\nCourse outline covers the deck, one lesson per topic per volume.")

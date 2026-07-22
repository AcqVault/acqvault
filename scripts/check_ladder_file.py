#!/usr/bin/env python3
"""Validate ONE ladder authoring file against the corpus — read-only.

    python3 scripts/check_ladder_file.py study-tool/deck-ladder-sat.json
    python3 scripts/check_ladder_file.py study-tool/deck-ladder-board-5m.json

Exit 0 = the file would pass the build. Exit 1 = it would FATAL.
Exists so several authors can work different rungs at once without racing each
other on assets/study-deck.json.

WHY THIS IS A WRAPPER AND NOT A CHECKER
---------------------------------------
This used to be a 145-line reimplementation of the build's ladder_gate, and it
drifted until it reported the OPPOSITE of the truth in both directions:

  * Its section index required the doc's `part` field to equal the number parsed
    off the title, which silently dropped every "Subpart"-prefixed title and all
    of the SSP — it called 387 sections the build cites happily "no such section
    (exact match required)".
  * It returned `1 if fails else 0`, ignoring `unreviewed` entirely, so a card
    missing a required `dod` field passed here and FATALed in the build. Three
    synthetic items the build rejects — including test_ladder_gate.py's own
    negative #7 — exited 0 under "gate: all cites verify".
  * It never knew the board schema (ask/cites/follow_ups), so it exited 1 on all
    four board files in a way that read as "bad data" rather than "I cannot
    check this".
  * It checked none of: rung validity, duplicate ids, distractor sets, or the
    `part` a link needs.

An author trusting it got false confidence in both directions, which is worse
than no checker at all. So it now runs the REAL build with the gates on and the
write off (ACQVAULT_GATE_ONLY), pinned to the one file. One source of truth: if
the build's gate changes, this changes with it, because it IS the build's gate.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'study-tool', 'build_deck_v2.py')


def main(path):
    if not os.path.exists(path):
        print('no such file: %s' % path)
        return 1
    name = os.path.basename(path)
    if not name.startswith('deck-ladder'):
        print('%s: not a ladder authoring file (expected deck-ladder*.json)' % name)
        return 1
    is_board = name.startswith('deck-ladder-board-')

    env = dict(os.environ)
    env['ACQVAULT_GATE_ONLY'] = '1'
    # Pin the side being checked; leave the other side on its normal glob so the
    # build still assembles a complete deck and every gate still runs.
    env['ACQVAULT_BOARD_FILE' if is_board else 'ACQVAULT_LADDER_FILE'] = os.path.abspath(path)

    print('%s: running the real build gate (read-only)…\n' % name)
    r = subprocess.run([sys.executable, BUILD], cwd=ROOT, env=env,
                       capture_output=True, text=True)
    out = ((r.stdout or '') + (r.stderr or '')).strip()

    if r.returncode == 0:
        # Echo only the lines about the part being checked — a full build log
        # buries the answer.
        for line in out.splitlines():
            if any(k in line for k in ('ladder', 'board', 'DoD-overlay', 'gate-only')):
                print('  ' + line.strip())
        print('\n✓ %s would PASS the build.' % name)
        return 0

    print(out)
    print('\n✗ %s would FATAL the build (exit %d).' % (name, r.returncode))
    return 1


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))

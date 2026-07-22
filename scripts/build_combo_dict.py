#!/usr/bin/env python3
"""Build the Combination accept-list for word lengths 6-8 from the corpus itself.

Why not a full English dictionary: the shipped 5-letter Wordle list is already 74 KB.
Extending it to 8 letters with general English costs ~530 KB, which roughly doubles the
study deck — a bad trade for an offline-first PWA on a CAC-restricted network. The
regulations carry their own large vocabulary (8,542 distinct words at lengths 5-8), so
the accept list is drawn from the corpus. That is also on-brand: a rejected guess reads
"Not in the rulebook."

The 5-letter list ships unchanged in games.dict, so 5-letter days keep Wordle's generous
accept list. This writes games.dict_ext = {"5": extras, "6": .., "7": .., "8": ..}, where
"5" holds only corpus words the Wordle list does NOT already contain (keeps the delta small).

Answer words are force-included at every length — a target must always be guessable.

Output is a committed artifact, study-tool/mcq/wordlist_ext.json, mirroring how
wordlist5.txt already works: build_deck_v2.py reads it and ships it as games.dict_ext.
Writing the deck directly would not survive, because the build regenerates deck['games']
from games.json on every run.

Usage:  python3 scripts/build_combo_dict.py           # writes study-tool/mcq/wordlist_ext.json
        python3 scripts/build_combo_dict.py --check   # report only, write nothing
"""
import json, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'output', 'documents.json')
DECK = os.path.join(ROOT, 'assets', 'study-deck.json')
GAMES = os.path.join(ROOT, 'study-tool', 'mcq', 'games.json')
OUT = os.path.join(ROOT, 'study-tool', 'mcq', 'wordlist_ext.json')

LPREFIX = re.compile(r'^L\d+:\s?', re.M)   # corpus stores per-line L0:/L1: markers
WORD = re.compile(r'[A-Za-z]+')
MIN_LEN, MAX_LEN = 5, 8

# A word must appear at least this many times to make the list. 1 lets in OCR noise and
# one-off proper nouns; 2 is enough to establish the corpus actually uses the word.
MIN_COUNT = 2


def corpus_words():
    docs = json.load(open(DOCS))
    counts = collections.Counter()
    for d in docs:
        text = LPREFIX.sub('', d.get('content', '') or '')
        for m in WORD.finditer(text):
            w = m.group(0).upper()
            if MIN_LEN <= len(w) <= MAX_LEN:
                counts[w] += 1
    return counts


def unpack(packed, n):
    return {packed[i:i + n] for i in range(0, len(packed), n)} if packed else set()


def main():
    check = '--check' in sys.argv
    games = json.load(open(GAMES))

    counts = corpus_words()
    kept = {w for w, c in counts.items() if c >= MIN_COUNT}

    with open(os.path.join(ROOT, 'study-tool', 'mcq', 'wordlist5.txt')) as f:
        wordle5 = {w.strip() for w in f if w.strip()}
    answers = {e['w'].upper() for e in games['combination']}

    ext = {}
    for n in range(MIN_LEN, MAX_LEN + 1):
        pool = {w for w in kept if len(w) == n}
        pool |= {w for w in answers if len(w) == n}      # a target is always guessable
        if n == 5:
            pool -= wordle5                              # ship only the delta
        ext[str(n)] = ''.join(sorted(pool))

    missing = sorted(w for w in answers
                     if w not in wordle5 and w not in unpack(ext.get(str(len(w)), ''), len(w)))
    if missing:
        sys.exit(f'FATAL: answer word(s) not in any accept list: {missing}')

    total = sum(len(v) for v in ext.values())
    print(f'corpus words {MIN_LEN}-{MAX_LEN} letters, count>={MIN_COUNT}: {len(kept):,}')
    for n in range(MIN_LEN, MAX_LEN + 1):
        words = len(ext[str(n)]) // n
        note = ' (delta over the Wordle list)' if n == 5 else ''
        print(f'  len {n}: {words:5,} words · {len(ext[str(n)]):7,} bytes{note}')
    print(f'dict_ext total: {total:,} bytes ({total/1024:.1f} KB) '
          f'· answers covered: {len(answers)}/{len(answers)}')

    if check:
        print('\n--check: nothing written.')
        return

    with open(OUT, 'w') as f:
        json.dump(ext, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'\nwrote {os.path.relpath(OUT, ROOT)} — build_deck_v2.py ships it as games.dict_ext')


if __name__ == '__main__':
    main()

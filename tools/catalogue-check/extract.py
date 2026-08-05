#!/usr/bin/env python3
"""Extract the official Kanton Zürich Grundkenntnistest catalogue from its PDF.

Produces two files next to this script:
  official-catalogue.txt   raw extracted text (what validate.mjs reads — stable, robust)
  official-catalogue.json  a best-effort structured view: {n, section, level, question, options[], answer}

The correct answer is the option the catalogue prints with a check mark (✔); the
other three carry an empty checkbox glyph. A handful of picture questions (flag,
arms, portraits, map) have image options and won't structure cleanly — those are
flagged in the JSON `_meta.anomalies` and handled by validate.mjs's image allow-list.

Usage:
  pip install pymupdf
  python extract.py path/to/grundkenntnistest_kanton_zuerich.pdf

Source PDF (Canton of Zürich): see README.md.
"""
import sys, re, json, os
try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("Missing dependency: pip install pymupdf")

TICK = chr(0x2714)  # correct-option check mark
BOX  = chr(0xF072)  # wrong-option glyph (private-use char in catalogue font)
SEC = {'demokratie und föderalismus':1, 'sozialstaat und zivilgesellschaft':2,
       'geschichte':3, 'geografie':4, 'kultur und alltagskultur':5}
LVL = {'bund':'bund', 'kanton':'kanton', 'gemeinde':'gemeinde'}
STEM_END = ('?', '…', '...', ':')

def classify(raw):
    s = raw.strip()
    if not s: return ('blank', None, None)
    if TICK in raw: return ('opt', True,  raw.replace(TICK, '').strip())
    if BOX  in raw: return ('opt', False, raw.replace(BOX,  '').strip())
    low = s.lower().rstrip(' ?').strip()
    if re.fullmatch(r'seite\s*\d+\s*/\s*\d+', low): return ('struct', None, None)
    if re.fullmatch(r'\d+(\.\d+)?', s):             return ('struct', None, None)
    if low in SEC: return ('section', SEC[low], None)
    if low in LVL: return ('level', LVL[low], None)
    return ('text', None, s)

def stem_like(t): return t.rstrip().endswith(STEM_END)

def parse(lines):
    qs, anomalies = [], []
    sec = lvl = None
    stem, opts, mode = [], [], 'stem'
    def join(frags):
        r = ''
        for f in frags:
            r = r[:-1] + f if r.endswith('-') else (r + ' ' + f if r else f)
        return r.strip()
    def flush():
        nonlocal stem, opts
        if not stem: return
        q = join(stem)
        ans = [i for i, o in enumerate(opts) if o[0]]
        rec = {'n': len(qs)+1, 'section': sec, 'level': lvl, 'question': q,
               'options': [o[1] for o in opts], 'answer': ans[0] if len(ans) == 1 else -1}
        qs.append(rec)
        if len(opts) != 4 or rec['answer'] < 0 or not stem_like(q):
            anomalies.append({'n': rec['n'], 'options': len(opts), 'answer': rec['answer'], 'question': q[:70]})
        stem, opts = [], []
    for raw in lines:
        k, a, t = classify(raw)
        if k in ('blank', 'struct'): continue
        if k == 'section': sec = a; continue
        if k == 'level':   lvl = a; continue
        if k == 'opt':
            if mode == 'stem': mode = 'opt'
            opts.append([a, t]); continue
        # k == 'text'
        if mode == 'stem':
            stem.append(t)
        elif len(opts) >= 4:
            flush(); stem, opts, mode = [t], [], 'stem'
        elif opts and opts[-1][1].endswith('-'):
            opts[-1][1] = opts[-1][1][:-1] + t
        elif not stem_like(t):
            opts.append([False, t])                 # option whose checkbox glyph didn't extract
        else:
            flush(); stem, opts, mode = [t], [], 'stem'
    flush()
    return qs, anomalies

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pdf = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    doc = fitz.open(pdf)
    lines = []
    for pg in doc:
        lines += pg.get_text().split('\n')
    raw_text = '\n'.join(lines)
    with open(os.path.join(here, 'official-catalogue.txt'), 'w', encoding='utf-8') as f:
        f.write(raw_text)
    qs, anomalies = parse(lines)
    out = {'_meta': {'source_pdf': os.path.basename(pdf), 'count': len(qs),
                     'ticks': raw_text.count(TICK), 'boxes': raw_text.count(BOX),
                     'anomalies': anomalies},
           'questions': qs}
    with open(os.path.join(here, 'official-catalogue.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"extracted {len(qs)} questions  ({raw_text.count(TICK)} correct marks)  "
          f"anomalies: {len(anomalies)}  → official-catalogue.txt / .json")

if __name__ == '__main__':
    main()

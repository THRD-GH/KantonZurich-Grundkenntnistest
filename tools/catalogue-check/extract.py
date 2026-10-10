#!/usr/bin/env python3
"""Extract the official Kanton Zürich Grundkenntnistest catalogue from its PDF.

By default this downloads the catalogue straight from the canton's own source
(the `pdf_url` in source.json — zh.ch), so the snapshot is always taken from the
authoritative Zürich source rather than a mirror or a stray local copy. Pass a
local path to extract from a file you already have instead.

Produces two files next to this script:
  official-catalogue.txt   raw extracted text (kept for reference / diffing)
  official-catalogue.json  structured view {n, section, level, question, options[],
                           answer, image} + a `_meta` block recording exactly where the
                           PDF came from: source_url, sha256, bytes, http_last_modified,
                           extracted_at. validate.mjs reads this file.

Answer format: the current catalogue states the correct option explicitly as a line
"Richtige Antwort: a|b|c|d" after each question's four options (a)…d)). Picture
questions (flag / arms / map) print their options as images on one combined label
line and carry no option text — they are flagged `"image": true` and checked by
answer index instead of wording.

Usage:
  pip install pymupdf
  python extract.py                 # download from the official zh.ch source (recommended)
  python extract.py path/to/cat.pdf # extract from a local file instead

Source of truth for the URL: source.json (next to this script).
"""
import sys, re, json, os, hashlib, tempfile, datetime, urllib.request

try:
    import pymupdf as fitz          # PyMuPDF >= 1.24 preferred spelling
except ImportError:
    try:
        import fitz                 # older PyMuPDF
    except ImportError:
        sys.exit("Missing dependency: pip install pymupdf")

HERE = os.path.dirname(os.path.abspath(__file__))

SEC = {'demokratie und föderalismus': 1, 'sozialstaat und zivilgesellschaft': 2,
       'geschichte': 3, 'geografie': 4, 'kultur und alltagskultur': 5}
LVL = {'bund', 'kanton', 'gemeinde'}


def load_source():
    with open(os.path.join(HERE, 'source.json'), encoding='utf-8') as f:
        return json.load(f)


def download(url):
    """Fetch the catalogue PDF from the official source; return (path, last_modified)."""
    print(f"Downloading official catalogue from the Zürich source:\n  {url}")
    req = urllib.request.Request(url, headers={'User-Agent': 'gkt-catalogue-check/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        last_mod = r.headers.get('Last-Modified')
    fd, path = tempfile.mkstemp(prefix='gkt-catalogue-', suffix='.pdf')
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
    return path, last_mod


def classify(line):
    s = line.strip()
    if not s:
        return ('blank',)
    m = re.match(r'Richtige Antwort:\s*([a-dA-D])\b', s)
    if m:
        return ('answer', m.group(1).lower())
    labels = re.findall(r'(?<![A-Za-z])([a-d])\)', s)
    m2 = re.match(r'^([a-d])\)\s*(.*)$', s)
    if m2 and labels:
        if len(labels) >= 2:                      # combined image-option line "a) b) c) d)"
            return ('imgopts',)
        return ('opt', m2.group(2).strip())
    if re.fullmatch(r'seite\s*\d+\s*/\s*\d+', s.lower()):
        return ('struct',)
    if re.fullmatch(r'\d+(\.\d+)?', s):
        return ('struct',)
    low = s.lower().rstrip(' ?').strip()
    if low in SEC:
        return ('section', SEC[low])
    if low in LVL:
        return ('level', low)
    return ('text', s)


def join(frags):
    r = ''
    for f in frags:
        if r.endswith('­') or r.endswith('-'):   # soft hyphen / hyphen wrap
            r = r[:-1] + f
        else:
            r = (r + ' ' + f) if r else f
    return r.strip()


def parse(lines):
    # drop cover + table of contents: ignore everything up to the first page marker
    start = 0
    for i, l in enumerate(lines):
        if re.fullmatch(r'\s*seite\s*\d+\s*/\s*\d+\s*', l.lower()):
            start = i + 1
            break

    qs, anomalies = [], []
    sec = lvl = None
    stem, opts, ans, img, cur = [], [], None, False, None
    mode = 'stem'

    def push_opt():
        nonlocal cur
        if cur is not None:
            opts.append(join(cur)); cur = None

    def flush():
        nonlocal stem, opts, ans, img, cur, mode
        push_opt()
        if stem and ans is not None:
            rec = {'n': len(qs) + 1, 'section': sec, 'level': lvl,
                   'question': join(stem), 'options': opts[:],
                   'answer': 'abcd'.index(ans), 'image': img}
            qs.append(rec)
            if not img and len(opts) != 4:
                anomalies.append({'n': rec['n'], 'options': len(opts), 'question': rec['question'][:70]})
        stem, opts, ans, img, cur, mode = [], [], None, False, None, 'stem'

    for line in lines[start:]:
        k = classify(line)
        t = k[0]
        if t in ('blank', 'struct'):
            continue
        if t == 'section': sec = k[1]; continue
        if t == 'level':   lvl = k[1]; continue
        if t == 'answer':  ans = k[1]; flush(); continue
        if t == 'imgopts': push_opt(); img = True; mode = 'opt'; continue
        if t == 'opt':     push_opt(); cur = [k[1]]; mode = 'opt'; continue
        if t == 'text':
            if mode == 'stem':      stem.append(k[1])
            elif cur is not None:   cur.append(k[1])
            else:                   stem.append(k[1])
    flush()
    return qs, anomalies


def main():
    src = load_source()
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    last_mod = source_url = None
    if args:
        pdf = args[0]                                   # extract from a local file
    else:
        pdf, last_mod = download(src['pdf_url'])        # download from the official source
        source_url = src['pdf_url']

    with open(pdf, 'rb') as f:
        pdf_bytes = f.read()
    sha = hashlib.sha256(pdf_bytes).hexdigest()

    doc = fitz.open(pdf)
    lines = []
    for pg in doc:
        lines += pg.get_text().split('\n')
    raw_text = '\n'.join(lines)
    with open(os.path.join(HERE, 'official-catalogue.txt'), 'w', encoding='utf-8') as f:
        f.write(raw_text)

    qs, anomalies = parse(lines)
    images = [q['n'] for q in qs if q['image']]
    meta = {
        'source': src.get('label'),
        'source_url': source_url,                       # null when extracted from a local file
        'source_page': src.get('page_url'),
        'from_local_file': source_url is None,
        'source_pdf': os.path.basename(args[0]) if args else os.path.basename(src['pdf_url']),
        'sha256': sha,
        'bytes': len(pdf_bytes),
        'http_last_modified': last_mod,
        'extracted_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'count': len(qs),
        'image_questions': images,
        'anomalies': anomalies,
    }
    out = {'_meta': meta, 'questions': qs}
    with open(os.path.join(HERE, 'official-catalogue.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"extracted {len(qs)} questions  (image: {len(images)}  anomalies: {len(anomalies)})")
    print(f"  source:  {source_url or pdf}")
    print(f"  sha256:  {sha}")
    print(f"  bytes:   {len(pdf_bytes)}  last-modified: {last_mod or '(local file)'}")
    print("  -> official-catalogue.txt / official-catalogue.json")


if __name__ == '__main__':
    main()

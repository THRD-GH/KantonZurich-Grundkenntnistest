# Catalogue check

Keeps `src/questions.js` honest against the **official Kanton Zürich Grundkenntnistest
question catalogue** — bound to the canton's *own* current PDF, so we can re-verify
quickly whenever they republish it without re-inventing the comparison each time.

Two steps: **extract** the official PDF into a stable format, then **validate** our
question set against it. A third command confirms the snapshot is still the live file.

## Files

| file | what it is |
| --- | --- |
| `source.json` | Single source of truth for *where* the catalogue lives: the canton's own `pdf_url` (zh.ch) and the human `page_url`. Both scripts read it. |
| `extract.py` | Downloads the PDF from `source.json` (or takes a local path) and writes `official-catalogue.txt` (raw text) + `official-catalogue.json` (structured `{n, section, level, question, options[], answer, image}` plus a `_meta` provenance block: `source_url`, `sha256`, `bytes`, `http_last_modified`, `extracted_at`). |
| `validate.mjs` | Walks `official-catalogue.json` in lock-step with `ALL_QUESTIONS`, matching by German stem (in order, so repeated stems align) and checking that **our marked answer is the one the catalogue marks**. Exits non-zero on any un-accepted discrepancy. Prints the snapshot's provenance header so every run shows which Zürich source it is bound to. |
| `check-source.mjs` | Fetches the live PDF at `source.json`'s `pdf_url` and compares it to the snapshot's recorded fingerprint (size + last-modified, or sha256 with `--hash`). Tells you if the canton has republished the catalogue. |
| `official-catalogue.txt` / `.json` | The committed snapshot of the official catalogue (regenerate with `extract.py`). |

## How the catalogue marks answers

Each question has four options `a) … b) … c) … d)` followed by a line
`Richtige Antwort: a|b|c|d` giving the correct one. A few picture questions
(flag / arms / map) print their options as images on one combined `a) b) c) d)` label
line and carry no option text — they are flagged `"image": true` and validated by
**answer index** rather than wording.

> Note: an older/mirror edition of the catalogue instead marked the correct option with
> a check mark (✔, U+2714) and the others with a private-use checkbox glyph. The current
> canton PDF (this tool's source) uses the explicit `Richtige Antwort:` line, which is
> what `extract.py` parses.

## Refresh + run

```bash
pip install pymupdf
# 1. Extract straight from the official zh.ch source (no argument needed):
python tools/catalogue-check/extract.py          # Windows: py tools\catalogue-check\extract.py
#    (or pass a local PDF path to extract from a file you already have)
# 2. Validate our question set against it:
npm run check:catalogue
# 3. Confirm the snapshot is still the live official file:
npm run check:catalogue:source            # add -- --hash for a byte-exact sha256 check
```

`validate.mjs` prints five buckets and exits `1` if `DISCREPANCIES > 0`:

- **matched** — our answer equals the official one.
- **image (index)** — picture questions; verified by the catalogue's explicit answer index.
- **accepted diffs** — our option wording is a known, accepted paraphrase of the official
  text (same correct answer). Ids + reasons in the `ACCEPTED` map.
- **not located** — a stem the matcher couldn't line up; inspect by hand.
- **DISCREPANCIES** — our marked answer does **not** match the official one. Real; fix the
  data, or — if you've confirmed it's an accepted paraphrase — add the id to `ACCEPTED`.

## Source

- Official page: <https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html>
- Catalogue PDF (canton's own, canonical — also in `source.json`):
  <https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/migration-integration/einbuergerung/gkt/grundkenntnistest_kanton_zuerich.pdf>

## Current known state (snapshot in this repo)

Verified against the canton's current PDF (last-modified 2025-05-15) on 2026-10-10.
350 questions, structure identical (5 sections × Bund/Kanton/Gemeinde). Answer keys:
**340 matched, 3 image (answer-index verified), 7 accepted paraphrases, 0 discrepancies.**

- **id175 (retirement age)** uses the catalogue's `65 Jahre bei Frauen und Männern`
  (options 63/64/65/66, correct = 65). The AHV 21 reform raises women's reference age to
  65, so the equalised wording matches the current official set.
- Accepted paraphrases: ids 129, 144, 173, 200, 201, 242 (wording reworded, same answer)
  and 212 (stem carries `sogenannte «Schwarzenbach-Initiative»`; answer verified by hand).

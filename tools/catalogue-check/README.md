# Catalogue check

Keeps `src/questions.js` honest against the **official Kanton Zürich Grundkenntnistest
question catalogue** — so we can re-verify quickly whenever the canton republishes it,
without re-inventing the comparison each time.

Two steps: **extract** the official PDF into a stable format, then **validate** our
question set against it.

## Files

| file | what it is |
| --- | --- |
| `extract.py` | Parses the official catalogue PDF → `official-catalogue.txt` (raw text) + `official-catalogue.json` (structured `{n, section, level, question, options[], answer}`). |
| `validate.mjs` | Walks the raw text in lock-step with `ALL_QUESTIONS`, matching each question by its German text (in order, so repeated stems align) and checking that **our marked answer is the one the catalogue ticks (✔)**. Exits non-zero on any un-accepted discrepancy. |
| `official-catalogue.txt` / `.json` | The committed snapshot of the official catalogue (regenerate with `extract.py`). |

## How the catalogue marks answers

Each question has exactly four options: the correct one is printed with a check mark
(`✔`, `U+2714`); the other three carry an empty-checkbox glyph (`U+F072`, a private-use
character in the catalogue's font). `extract.py`/`validate.mjs` key off those two marks —
they're derived from their code points in-source (`chr(0x2714)` / `chr(0xF072)`) so no
invisible characters live in the code.

## Refresh + run

```bash
# 1. Download the current official catalogue PDF (see "Source" below) to e.g. catalogue.pdf
# 2. Extract it (needs PyMuPDF):
pip install pymupdf
python tools/catalogue-check/extract.py catalogue.pdf
# 3. Validate our question set against it:
node tools/catalogue-check/validate.mjs      # or: npm run check:catalogue
```

`validate.mjs` prints five buckets and exits `1` if `DISCREPANCIES > 0`:

- **matched** — our answer equals the official ✔.
- **image (manual)** — picture questions (flag / arms / portraits / map); options are
  images, not text, so they're verified by hand. Ids in the `IMAGE` set.
- **accepted diffs** — our option wording is a known, accepted paraphrase of the official
  text (same correct answer). Ids + reasons in the `ACCEPTED` map.
- **not located** — a stem the matcher couldn't line up (usually `«guillemets»` or
  extraction drift); inspect by hand.
- **DISCREPANCIES** — our marked answer does **not** match the official ✔. Real; fix the
  data, or — if you've confirmed it's an accepted paraphrase — add the id to `ACCEPTED`.

When the canton changes wording and you've checked it's still the same answer, move the id
into `ACCEPTED` with a one-line reason. When a genuine answer changes, fix `questions.js`.

## Source

- Official info + catalogue: <https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html>
- Direct catalogue PDF (Kanton Zürich, mirrored by the city of Wetzikon):
  <https://www.wetzikon.ch/de/verwaltung/dokumente/Gesellschaft-Soziales/Beschaeftigung-Integration/grundkenntnistest_kanton_zuerich.pdf>

## Current known state (snapshot in this repo)

350 questions, structure identical (5 sections × Bund/Kanton/Gemeinde). Answer keys:
337 matched, 3 image (verified by hand), 8 accepted paraphrases, and **1 open discrepancy**:

- **id175 — retirement age.** Ours: "65 Jahre bei Frauen und Männern". Official catalogue:
  "64 Jahre bei Frauen und 65 Jahre bei Männern" (pre-AHV21 wording; our four options don't
  even include the official's correct one). Needs a decision: match the official catalogue,
  or keep the equalised "65/65" if the catalogue is behind the AHV21 reform.

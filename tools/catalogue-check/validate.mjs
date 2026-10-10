// Validate src/questions.js against the official Kanton Zürich catalogue snapshot.
//
//   node tools/catalogue-check/validate.mjs          (npm run check:catalogue)
//
// Reads official-catalogue.json (produced by extract.py straight from the canton's
// own PDF) and walks its questions in lock-step with ALL_QUESTIONS, matching each by
// its German stem (in order, so repeated stems align) and checking that OUR marked
// answer is the option the catalogue marks "Richtige Antwort". Image questions (flag /
// arms / map) carry no option text, so they're cross-checked by answer index instead.
// Exits non-zero on any un-accepted discrepancy, so it can gate a commit or a schedule.
//
// To confirm the snapshot itself is still the current official file:
//   node tools/catalogue-check/check-source.mjs --hash   (npm run check:catalogue:source)

import { ALL_QUESTIONS } from '../../src/questions.js';
import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync(new URL('./official-catalogue.json', import.meta.url), 'utf8'));
const CAT = snap.questions, m = snap._meta;

// Picture questions (flag / arms / map): options are images, not text — checked by
// the explicit answer index the catalogue gives, not by wording.
const IMAGE = new Set([55, 110, 289]);
// Questions where our option wording is a known, accepted paraphrase of the official
// text (same correct answer, different words), plus one matcher limitation. Kept here
// so they don't re-alarm; each was confirmed by hand against the official catalogue.
const ACCEPTED = new Map([
  [129, 'paraphrase of the official Arbeitszeugnis wording'],
  [144, 'paraphrase (Fristenlösung / 12.-Woche wording)'],
  [173, 'paraphrase (Berufsbildungszentrum wording)'],
  [200, 'paraphrase (Quartierverein wording)'],
  [201, 'paraphrase (Finanzausgleich wording)'],
  [242, 'paraphrase (Bilaterale Verträge wording)'],
  [212, 'matcher limitation: "sogenannte «Schwarzenbach-Initiative»" in the stem; answer verified by hand'],
]);

const LETTERS = '0-9a-z\\u00df\\u00e0-\\u00ff';
const norm = s => (s || '').toLowerCase().normalize('NFC').replace(new RegExp(`[^${LETTERS}]`, 'g'), '');
const catNorm = CAT.map(c => ({ ...c, nstem: norm(c.question) }));

let pos = 0, matched = 0;
const mismatch = [], accepted = [], images = [], notfound = [];
for (let i = 0; i < ALL_QUESTIONS.length; i++) {
  const q = ALL_QUESTIONS[i], nq = norm(q.de), key = nq.slice(0, 40), key2 = nq.slice(0, 24);
  let ci = -1;
  for (let j = pos; j < catNorm.length; j++) {
    if (catNorm[j].nstem.includes(key) || catNorm[j].nstem.includes(key2)) { ci = j; break; }
  }
  if (ci < 0) {
    if (ACCEPTED.has(q.id)) { accepted.push(q); } else { notfound.push(q); }
    continue;
  }
  pos = ci + 1;
  const cat = catNorm[ci];
  if (cat.image || IMAGE.has(q.id)) {
    if (q.a === cat.answer) { images.push(q); } else { mismatch.push([q, `image answer index ${cat.answer}`]); }
    continue;
  }
  const ourC = norm(q.opts[q.a].de), catC = norm(cat.options[cat.answer] || '');
  const ck = ourC.slice(0, Math.min(34, ourC.length));
  const good = ourC && catC && (catC.startsWith(ck) || ourC.startsWith(catC.slice(0, 34)) || catC === ourC);
  if (good) { matched++; }
  else if (ACCEPTED.has(q.id)) { accepted.push(q); }
  else { mismatch.push([q, cat.options[cat.answer]]); }
}

const short = s => s.length > 50 ? s.slice(0, 49) + '…' : s;
console.log(`\nSource: ${m.source || 'official catalogue'}`);
console.log(`  ${m.source_url || m.source_pdf}`);
console.log(`  sha256 ${(m.sha256 || '?').slice(0, 16)}… · ${m.bytes ?? '?'} bytes · last-modified ${m.http_last_modified || '(n/a)'} · extracted ${m.extracted_at || '(n/a)'}`);
console.log(`\nCatalogue answer-key check — ${ALL_QUESTIONS.length} questions vs ${CAT.length} in the official catalogue`);
console.log(`  matched:        ${matched}`);
console.log(`  image (index):  ${images.length}  [${images.map(q => q.id).join(', ')}]`);
console.log(`  accepted diffs: ${accepted.length}  [${accepted.map(q => q.id).join(', ')}]`);
console.log(`  not located:    ${notfound.length}${notfound.length ? '  [' + notfound.map(q => q.id).join(', ') + ']' : ''}`);
console.log(`  DISCREPANCIES:  ${mismatch.length}`);
if (mismatch.length) {
  console.log('\n  Answer differs from the official catalogue:');
  for (const [q, off] of mismatch) {
    console.log(`   - id${q.id}: "${short(q.de)}"`);
    console.log(`       ours:      "${q.opts[q.a].de}"`);
    console.log(`       official:  ${typeof off === 'string' ? '"' + off.slice(0, 70) + '"' : '(image)'}`);
  }
}
if (notfound.length) console.log('\n  Not located (wording drift or extraction gap - inspect manually).');
console.log(mismatch.length ? `\nFAIL - ${mismatch.length} discrepancy(ies) to resolve.\n`
                            : '\nPASS - every answer matches the official catalogue (image/accepted aside).\n');
process.exit(mismatch.length ? 1 : 0);

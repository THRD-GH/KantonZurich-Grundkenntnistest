// Validate src/questions.js against the official Kanton Zürich catalogue snapshot.
//
//   node tools/catalogue-check/validate.mjs
//
// Reads official-catalogue.txt (produced by extract.py) and walks it in lock-step
// with ALL_QUESTIONS, matching each question by its German text (in order, so
// repeated stems align correctly) and checking that OUR marked answer is the option
// the catalogue ticks. Exits non-zero if any un-accepted answer discrepancy is
// found, so it can gate a commit or run on a schedule.
//
// Refresh the snapshot when the canton republishes the catalogue:
//   1. download the PDF (see README.md)   2. python extract.py <pdf>   3. re-run this.

import { ALL_QUESTIONS } from '../../src/questions.js';
import fs from 'node:fs';

const raw = fs.readFileSync(new URL('./official-catalogue.txt', import.meta.url), 'utf8');

const TICK = String.fromCharCode(0x2714);   // correct-option check mark
const BOX  = String.fromCharCode(0xF072);   // wrong-option glyph (private-use in catalogue font)
const C = String.fromCharCode(1), W = String.fromCharCode(2);   // internal markers

// Picture questions (flag / arms / portraits / map): options are images, not text —
// can't be checked by wording, verified by hand instead.
const IMAGE = new Set([55, 110, 241, 289]);
// Questions where our option wording is a known, accepted paraphrase of the official
// text (same correct answer, different words) — kept here so they don't re-alarm.
// id212 is a matcher limitation (guillemets in the stem), not a data issue.
const ACCEPTED = new Map([
  [129, 'paraphrase of the official Arbeitszeugnis option'],
  [144, 'paraphrase (Fristenloesung wording)'],
  [173, 'paraphrase (Berufsbildungszentrum wording)'],
  [181, 'paraphrase (erwerbstaetige Frau <-> Frau, die arbeitet)'],
  [186, 'same answer, different phrasing (das verlobte Paar <-> Frau und Mann)'],
  [200, 'paraphrase (Quartierverein wording)'],
  [201, 'paraphrase (Finanzausgleich wording)'],
  [242, 'paraphrase (Bilaterale Vertraege wording)'],
  [212, 'matcher limitation: guillemets in the stem'],
]);

const LETTERS = '0-9a-z\\u00df\\u00e0-\\u00ff';
const offm = raw.replace(new RegExp(TICK, 'g'), C).replace(new RegExp(BOX, 'g'), W)
  .toLowerCase().normalize('NFC').replace(new RegExp(`[^${LETTERS}${C}${W}]`, 'g'), '');
const norm = s => (s || '').toLowerCase().normalize('NFC').replace(new RegExp(`[^${LETTERS}]`, 'g'), '');
const SPLIT = new RegExp(`[${C}${W}]`);
const find = (s, from) => { const i = offm.indexOf(s.slice(0, 42), from); return i < 0 ? offm.indexOf(s.slice(0, 24), from) : i; };

let pos = 0, matched = 0;
const mismatch = [], accepted = [], images = [], notfound = [];
for (let i = 0; i < ALL_QUESTIONS.length; i++) {
  const q = ALL_QUESTIONS[i], nq = norm(q.de);
  const qp = find(nq, pos);
  if (qp < 0) { notfound.push(q); continue; }
  let np = offm.length;
  if (i + 1 < ALL_QUESTIONS.length) { const x = find(norm(ALL_QUESTIONS[i + 1].de), qp + nq.length); if (x > 0) np = x; }
  pos = qp + Math.max(8, Math.floor(nq.length * 0.6));
  const block = offm.slice(qp + Math.min(nq.length, offm.length - qp), np);
  const ci = block.indexOf(C);
  const offCorrect = ci < 0 ? '' : block.slice(ci + 1).split(SPLIT)[0];
  const ourC = norm(q.opts[q.a].de);
  const key = ourC.slice(0, Math.min(34, ourC.length));
  const good = ourC && offCorrect && (offCorrect.startsWith(key) || (key.length < 34 && offCorrect.startsWith(ourC)));
  if (good) { matched++; continue; }
  if (IMAGE.has(q.id)) { images.push(q); continue; }
  if (ACCEPTED.has(q.id)) { accepted.push(q); continue; }
  mismatch.push([q, offCorrect]);
}

const short = s => s.length > 46 ? s.slice(0, 45) + '…' : s;
console.log(`\nCatalogue answer-key check - ${ALL_QUESTIONS.length} questions`);
console.log(`  matched:        ${matched}`);
console.log(`  image (manual): ${images.length}  [${images.map(q => q.id).join(', ')}]`);
console.log(`  accepted diffs: ${accepted.length}  [${accepted.map(q => q.id).join(', ')}]`);
console.log(`  not located:    ${notfound.length}${notfound.length ? '  [' + notfound.map(q => q.id).join(', ') + ']' : ''}`);
console.log(`  DISCREPANCIES:  ${mismatch.length}`);
if (mismatch.length) {
  console.log('\n  Answer differs from the official catalogue:');
  for (const [q, off] of mismatch) {
    console.log(`   - id${q.id}: "${short(q.de)}"`);
    console.log(`       ours:      "${q.opts[q.a].de}"`);
    console.log(`       official:  ${off ? '"' + off.slice(0, 60) + '"' : '(not found - image?)'}`);
  }
}
if (notfound.length) console.log('\n  Not located (wording drift or extraction gap - inspect manually).');
console.log(mismatch.length ? `\nFAIL - ${mismatch.length} discrepancy(ies) to resolve.\n` : '\nPASS - every answer matches the official catalogue (image/accepted aside).\n');
process.exit(mismatch.length ? 1 : 0);

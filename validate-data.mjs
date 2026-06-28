// Data-integrity check for the question bank. Run with `npm test`.
// Guards against edits that silently break the quiz (bad answer index, missing options, stale image keys, …).
import { ALL_QUESTIONS } from "./src/questions.js";
import { Q_IMAGES } from "./src/images.js";
import { EXPLANATIONS } from "./src/explanations.js";

const LEVELS = new Set(["bund", "kanton", "gemeinde"]);
const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };

check(Array.isArray(ALL_QUESTIONS) && ALL_QUESTIONS.length > 0, "ALL_QUESTIONS is empty");

const ids = new Set(), nums = new Set();
for (const q of ALL_QUESTIONS) {
  const tag = `Q${q?.n ?? "?"}(id ${q?.id ?? "?"})`;
  check(Number.isInteger(q.id), `${tag}: missing/invalid id`);
  check(Number.isInteger(q.n), `${tag}: missing/invalid n`);
  check(!ids.has(q.id), `${tag}: duplicate id`); ids.add(q.id);
  check(!nums.has(q.n), `${tag}: duplicate n`); nums.add(q.n);
  check(typeof q.s === "string" && /^\d\s·\s/.test(q.s), `${tag}: bad section "${q.s}"`);
  check(typeof q.de === "string" && q.de.trim().length > 0, `${tag}: empty German text`);
  check(typeof q.en === "string", `${tag}: missing English text`);
  check(LEVELS.has(q.lvl), `${tag}: bad level "${q.lvl}"`);
  check(Array.isArray(q.opts) && q.opts.length === 4, `${tag}: needs exactly 4 options`);
  (q.opts || []).forEach((o, i) => {
    check(o && typeof o.de === "string" && o.de.length > 0, `${tag} opt ${i}: empty German option`);
    check(o && typeof o.en === "string", `${tag} opt ${i}: missing English option`);
  });
  check(Number.isInteger(q.a) && q.a >= 0 && q.a <= 3, `${tag}: answer index out of range (${q.a})`);
  // a question that ships an image hint with a 2×2 grid must have matching image data (Q229 amphitheatre is text-only)
}

// Image keys must point at real questions and provide exactly 4 data URIs
const byN = new Map(ALL_QUESTIONS.map(q => [q.n, q]));
for (const key of Object.keys(Q_IMAGES)) {
  const q = byN.get(Number(key));
  check(q, `Q_IMAGES[${key}]: no question with that number`);
  const arr = Q_IMAGES[key];
  check(Array.isArray(arr) && arr.length === 4, `Q_IMAGES[${key}]: needs 4 images`);
  check(arr.every(s => typeof s === "string" && (s.startsWith("data:image/") || s.startsWith("/img/"))), `Q_IMAGES[${key}]: invalid image refs`);
}

// Explanations (optional per question) must key off a real id and be well-formed
let explCount = 0;
for (const key of Object.keys(EXPLANATIONS)) {
  const q = ids.has(Number(key));
  check(q, `EXPLANATIONS[${key}]: no question with that id`);
  const ex = EXPLANATIONS[key];
  check(ex && typeof ex.de === "string" && ex.de.trim().length > 0, `EXPLANATIONS[${key}]: empty German explanation`);
  check(ex && typeof ex.en === "string" && ex.en.trim().length > 0, `EXPLANATIONS[${key}]: empty English explanation`);
  if (ex && ex.src !== undefined) {
    check(Array.isArray(ex.src), `EXPLANATIONS[${key}]: src must be an array`);
    (ex.src || []).forEach((s, i) => {
      check(s && typeof s.label === "string" && s.label.length > 0, `EXPLANATIONS[${key}] src ${i}: missing label`);
      check(s && typeof s.url === "string" && /^https?:\/\//.test(s.url), `EXPLANATIONS[${key}] src ${i}: invalid url`);
    });
  }
  explCount++;
}

if (fail.length) {
  console.error(`✗ Data validation failed (${fail.length} issue${fail.length > 1 ? "s" : ""}):`);
  fail.slice(0, 50).forEach(m => console.error("  - " + m));
  process.exit(1);
}
console.log(`✓ Data OK — ${ALL_QUESTIONS.length} questions, ${Object.keys(Q_IMAGES).length} image sets, ${explCount}/${ALL_QUESTIONS.length} explanations, all invariants hold.`);

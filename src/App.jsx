import { useState, useEffect, useCallback, useMemo } from "react";
import { ALL_QUESTIONS } from "./questions";
import { Q_IMAGES } from "./images";
import { EXPLANATIONS } from "./explanations";

const SECTION_NAMES = [...new Set(ALL_QUESTIONS.map(q => q.s))];
const LETTERS = ["a","b","c","d"];
// Five question-class (section) colours — keyed by the leading number of q.s ("1 · …")
const secNum = (s) => { const m = /^(\d)/.exec(s || ""); return m ? +m[1] : 0; };
const secName = (s) => (s ? (s.split("·")[1] || s).trim() : s);
// Keyed by stable question id (v2) so a future renumber can't desync saved progress
const DIFF_KEY     = "gkt_difficulty_v2";  // { [id]: "easy"|"medium"|"hard" }
const HISTORY_KEY  = "gkt_history_v2";      // [ { ts, label, correct, total, wrong:[id], bestStreak } ]
const PROGRESS_KEY = "gkt_progress_v2";     // { [id]: { seen, correct, box } }  — powers dashboard + spaced repetition
const RESUME_KEY   = "gkt_resume_v2";       // in-progress quiz/exam snapshot
const CONTRAST_KEY = "gkt_contrast_v1";     // "normal" | "high"
const EXPL_KEY     = "gkt_expl_v1";          // "on" | "off" — show explanations during quiz (off by default)
const SIZE_KEY     = "gkt_textsize_v1";      // "s" | "m" | "l" | "xl" — global text/zoom size
const TEXT_SIZES   = { s: 0.9, m: 1, l: 1.15, xl: 1.3 };
const SRS_MAX_BOX  = 5;                     // Leitner boxes: 1 = struggling … 5 = mastered
const DAY_MS = 86400000;
const SRS_DUE_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 30 }; // days until a box becomes due for review again
const DIFF_LABELS = { easy:"Easy", medium:"Medium", hard:"Hard" };
const LVL_LABELS  = { bund:"Federal", kanton:"Cantonal", gemeinde:"Municipal" };
// Real GKT exam parameters: 50 questions, 60 minutes, 60% to pass
const EXAM_COUNT    = 50;
const EXAM_MINUTES  = 60;
const EXAM_PASS_PCT = 60;
const DIFF_COLORS = {
  easy:   { bg:"var(--color-background-success)", text:"var(--color-text-success)", border:"var(--color-border-success)" },
  medium: { bg:"var(--color-background-warning)", text:"var(--color-text-warning)", border:"var(--color-border-warning)" },
  hard:   { bg:"var(--color-background-danger)",  text:"var(--color-text-danger)",  border:"var(--color-border-danger)"  },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BY_ID = new Map(ALL_QUESTIONS.map(q => [q.id, q]));

const readJSON  = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } };
const writeJSON = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function loadDifficulties() { return readJSON(DIFF_KEY, {}); }
function saveDifficulties(d) { writeJSON(DIFF_KEY, d); }
function loadHistory() { return readJSON(HISTORY_KEY, []); }
function saveHistory(h) { writeJSON(HISTORY_KEY, h.slice(0, 50)); } // keep last 50
function loadProgress() { return readJSON(PROGRESS_KEY, {}); }
function saveProgress(p) { writeJSON(PROGRESS_KEY, p); }
function loadResume() { return readJSON(RESUME_KEY, null); }
function saveResume(r) { writeJSON(RESUME_KEY, r); }
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch {} }
function loadContrast() { try { return localStorage.getItem(CONTRAST_KEY) || "normal"; } catch { return "normal"; } }
function loadExpl()     { try { return localStorage.getItem(EXPL_KEY) === "on"; } catch { return false; } }
function loadTextSize() { try { return TEXT_SIZES[localStorage.getItem(SIZE_KEY)] ? localStorage.getItem(SIZE_KEY) : "m"; } catch { return "m"; } }

// Build a pool from explicit question ids (retry-wrong / smart review / resume)
function poolFromIds(ids, doShuffle = true) {
  const seen = new Set();
  const out = [];
  ids.forEach(id => { const q = BY_ID.get(id); if (q && !seen.has(id)) { seen.add(id); out.push(q); } });
  return doShuffle ? shuffle(out) : out;
}

// Spaced repetition: apply a session's per-question results to the Leitner boxes and schedule the next review
function applyResults(progress, results, now) {
  const next = { ...progress };
  results.forEach(({ id, correct }) => {
    const r = next[id] ? { ...next[id] } : { seen: 0, correct: 0, box: 1 };
    r.seen += 1;
    if (correct) { r.correct += 1; r.box = Math.min(SRS_MAX_BOX, (r.box || 1) + 1); }
    else { r.box = 1; }
    r.due = now + (SRS_DUE_DAYS[r.box] || 0) * DAY_MS;
    next[id] = r;
  });
  return next;
}

// Ids whose scheduled review is due (due time has passed), most overdue first.
// Entries from before scheduling existed (no `due`) are treated as due now.
function dueForReview(progress, now) {
  return Object.keys(progress).map(Number)
    .filter(id => BY_ID.has(id) && (progress[id].due ?? 0) <= now)
    .sort((a, b) => (progress[a].due ?? 0) - (progress[b].due ?? 0));
}

// Aggregate progress by a question attribute (section or level) → { key: {seen, correct, total, mastered} }
function statsBy(progress, keyFn) {
  const agg = {};
  ALL_QUESTIONS.forEach(q => {
    const k = keyFn(q);
    const a = (agg[k] ||= { seen: 0, correct: 0, total: 0, mastered: 0 });
    a.total += 1;
    const r = progress[q.id];
    if (r && r.seen) { a.seen += r.seen; a.correct += r.correct; if ((r.box || 1) >= SRS_MAX_BOX) a.mastered += 1; }
  });
  return agg;
}

// Exam-realistic mix: 70% federal / 20% cantonal / 10% municipal, mirroring the real GKT composition
function buildExamMixPool(count) {
  const byLvl = { bund:[], kanton:[], gemeinde:[] };
  ALL_QUESTIONS.forEach(q => { if (byLvl[q.lvl]) byLvl[q.lvl].push(q); });
  const want = { bund: Math.round(count * 0.7), kanton: Math.round(count * 0.2) };
  want.gemeinde = count - want.bund - want.kanton;
  const pick = (arr, n) => shuffle(arr).slice(0, n);
  let pool = [...pick(byLvl.bund, want.bund), ...pick(byLvl.kanton, want.kanton), ...pick(byLvl.gemeinde, want.gemeinde)];
  if (pool.length < count) { // top up if a level was short
    const have = new Set(pool.map(q => q.id));
    pool = [...pool, ...shuffle(ALL_QUESTIONS.filter(q => !have.has(q.id))).slice(0, count - pool.length)];
  }
  return shuffle(pool);
}

function buildQuickTestPool(difficulties, targetDiff, count) {
  if (targetDiff === "random") {
    return shuffle(ALL_QUESTIONS).slice(0, count);
  }
  const tagged   = ALL_QUESTIONS.filter(q => difficulties[q.id] === targetDiff);
  const untagged = ALL_QUESTIONS.filter(q => !difficulties[q.id]);
  const pool = shuffle(tagged);
  if (pool.length < count) {
    return shuffle([...pool, ...shuffle(untagged).slice(0, count - pool.length)]);
  }
  return pool.slice(0, count);
}

function countByDiff(difficulties) {
  const c = { easy:0, medium:0, hard:0, unrated:0 };
  ALL_QUESTIONS.forEach(q => { const d = difficulties[q.id]; if (d) c[d]++; else c.unrated++; });
  return c;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })
    + " " + d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const S = {
  card:    { background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-lg)", padding:"1.25rem", marginBottom:"1rem" },
  badge:   { padding:"2px 8px", borderRadius:99, background:"var(--color-background-secondary)", fontSize:11, color:"var(--color-text-tertiary)", border:"0.5px solid var(--color-border-tertiary)" },
  qDe:     { fontSize:16, fontWeight:500, color:"var(--color-text-primary)", lineHeight:1.45, marginBottom:".35rem" },
  qEn:     { fontSize:13, color:"var(--color-text-secondary)", fontStyle:"italic", lineHeight:1.4, marginBottom:".85rem" },
  optBase: { display:"flex", alignItems:"flex-start", gap:10, padding:"9px 12px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-tertiary)", cursor:"pointer", background:"var(--color-background-secondary)", userSelect:"none", font:"inherit", color:"inherit", textAlign:"left", width:"100%", appearance:"none", margin:0 },
  optKey:  { fontSize:12, fontWeight:500, minWidth:18, color:"var(--color-text-tertiary)", paddingTop:1, flexShrink:0 },
  optDe:   { fontSize:14, color:"var(--color-text-primary)", lineHeight:1.35 },
  btn:     { fontSize:13, padding:"7px 14px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)", cursor:"pointer" },
  btnPrim: { fontSize:13, padding:"7px 18px", borderRadius:"var(--border-radius-md)", border:"1px solid var(--color-border-info)", background:"var(--color-background-info)", color:"var(--color-text-info)", cursor:"pointer", fontWeight:500 },
  sectionHdr: { fontSize:12, fontWeight:500, color:"var(--color-text-tertiary)", padding:"8px 0 4px", borderBottom:"0.5px solid var(--color-border-tertiary)", marginBottom:6 },
};

// ── Small reusables ───────────────────────────────────────────────────────────
function DiffBadge({ diff, small }) {
  const sz = small ? 10 : 11;
  if (!diff) return <span style={{ ...S.badge, fontSize:sz }}>Unrated</span>;
  const c = DIFF_COLORS[diff];
  return <span style={{ padding: small?"1px 6px":"2px 9px", borderRadius:99, fontSize:sz, background:c.bg, color:c.text, border:`0.5px solid ${c.border}`, fontWeight:500 }}>{DIFF_LABELS[diff]}</span>;
}

function LvlBadge({ lvl, small }) {
  if (!lvl || !LVL_LABELS[lvl]) return null;
  return <span style={{ fontSize: small ? 10 : 11, fontWeight:500, padding: small ? "1px 7px" : "2px 9px", borderRadius:99, whiteSpace:"nowrap",
    background:`var(--lvl-${lvl}-bg)`, color:`var(--lvl-${lvl})`, border:`0.5px solid var(--lvl-${lvl}-bd)` }}>{LVL_LABELS[lvl]}</span>;
}

// Text-to-speech (German) for pronunciation practice
const TTS_OK = typeof window !== "undefined" && "speechSynthesis" in window;
if (TTS_OK) { try { window.speechSynthesis.getVoices(); } catch {} } // warm up the voice list
function speakDE(text, onEnd) {
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // stop anything already playing
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    const v = synth.getVoices().find(voice => /^de/i.test(voice.lang));
    if (v) u.voice = v;
    u.rate = 0.95;
    if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
    synth.speak(u);
  } catch { onEnd && onEnd(); }
}
function stopSpeak() { try { window.speechSynthesis.cancel(); } catch {} }
function SpeakButton({ text, small }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => stopSpeak(), []); // stop audio if this button unmounts (e.g. navigating questions)
  if (!TTS_OK) return null;
  const toggle = (e) => {
    e.stopPropagation();
    if (speaking) { stopSpeak(); setSpeaking(false); }
    else { setSpeaking(true); speakDE(text, () => setSpeaking(false)); }
  };
  return (
    <button type="button" aria-pressed={speaking}
      aria-label={speaking ? "Stop reading" : "Read aloud in German"} title={speaking ? "Stop" : "Read aloud (German)"}
      onClick={toggle}
      style={{ ...S.badge, cursor:"pointer", lineHeight:1, padding: small ? "1px 6px" : "3px 8px", fontSize: small ? 11 : 12,
        ...(speaking ? { background:"var(--color-background-info)", color:"var(--color-text-info)", border:"0.5px solid var(--color-border-info)" } : {}) }}>
      {speaking ? "⏹" : "🔊"}
    </button>
  );
}
// Compose the German text read aloud for a question (prompt + all options)
// Read the question, then the options in the order they appear on screen (the quiz shuffles them).
const sayText = (q, order = [0, 1, 2, 3]) => q.de + ". " + order.map(oi => q.opts[oi]?.de).filter(Boolean).join(". ");

// Resolve an absolute "/img/..." asset path under Vite's base (so it works on GitHub Pages sub-paths)
const asset = (p) => (typeof p === "string" && p.startsWith("/")) ? import.meta.env.BASE_URL + p.slice(1) : p;
// Small decorative Canton-Zürich flag pinned to the top-right corner of every page.
// Diagonal (per bend): white upper-right, blue lower-left — matching the canton arms.
function ZurichFlag() {
  return (
    <div aria-hidden="true" title="Kanton Zürich" style={{ position:"fixed", top:8, right:8, width:22, height:22, zIndex:50, pointerEvents:"none", borderRadius:4, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.35)" }}>
      <svg viewBox="0 0 32 32" width="22" height="22" style={{ display:"block" }}>
        <rect width="32" height="32" fill="#ffffff"/>
        <path d="M0,0 L0,32 L32,32 Z" fill="#1668b3"/>
      </svg>
    </div>
  );
}

// Floating text-size control (bottom-right) — smaller / larger, like reader apps.
function ZoomControl({ textSize, setTextSize }) {
  const order = ["s", "m", "l", "xl"];
  const i = order.indexOf(textSize);
  const set = (j) => setTextSize(order[Math.min(order.length - 1, Math.max(0, j))]);
  const btn = (size, disabled) => ({ background:"none", border:"none", lineHeight:1, padding:"6px 12px", fontWeight:600, fontSize:size, color:"var(--color-text-secondary)", opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer" });
  return (
    <div role="group" aria-label="Text size" style={{ position:"fixed", bottom:12, right:12, zIndex:50, display:"flex", alignItems:"center",
      background:"var(--color-background-primary)", border:"1px solid var(--color-border-secondary)", borderRadius:99, boxShadow:"0 2px 10px rgba(0,0,0,0.28)" }}>
      <button onClick={() => set(i - 1)} disabled={i <= 0} aria-label="Smaller text" title="Smaller text" style={btn(12, i <= 0)}>A</button>
      <div style={{ width:1, height:18, background:"var(--color-border-tertiary)" }}/>
      <button onClick={() => set(i + 1)} disabled={i >= order.length - 1} aria-label="Larger text" title="Larger text" style={btn(19, i >= order.length - 1)}>A</button>
    </div>
  );
}

// A single illustrative image shown above the options (for "what is this?" picture questions)
function QImage({ src, maxHeight = 200 }) {
  if (!src) return null;
  return <img src={asset(src)} alt="" style={{ width:"100%", maxHeight, objectFit:"contain", borderRadius:"var(--border-radius-md)", display:"block", margin:"2px 0 10px", background:"var(--color-background-secondary)" }} />;
}

// Colour-coded section ("class") chip: a tinted pill with a coloured dot and the section name.
function SecBadge({ s, small }) {
  const n = secNum(s);
  if (!n) return <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{s}</span>;
  return (
    <span title={s} style={{ display:"inline-flex", alignItems:"center", gap:5, flexShrink:0,
      fontSize: small ? 10 : 11, fontWeight:500, padding: small ? "1px 7px" : "2px 9px", borderRadius:99,
      background:`var(--sec-${n}-bg)`, color:`var(--sec-${n})`, border:`0.5px solid var(--sec-${n}-bd)` }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:`var(--sec-${n}-bd)`, flexShrink:0 }}/>
      {secName(s)}
    </span>
  );
}

// A small on/off toggle switch
function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ display:"inline-flex", alignItems:"center", gap:7, background:"none", border:"none", padding:0, cursor:"pointer", font:"inherit", color:"inherit" }}>
      {label && <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{label}</span>}
      <span style={{ width:34, height:20, borderRadius:99, flexShrink:0, position:"relative", transition:"background .15s",
        background: on ? "var(--color-border-success)" : "var(--color-border-tertiary)" }}>
        <span style={{ position:"absolute", top:2, left: on ? 16 : 2, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left .15s", boxShadow:"0 1px 2px rgba(0,0,0,0.35)" }}/>
      </span>
    </button>
  );
}

function DiffPicker({ current, onChange }) {
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>Rate:</span>
      {["easy","medium","hard"].map(d => {
        const c = DIFF_COLORS[d]; const active = current === d;
        return (
          <button key={d} onClick={() => onChange(active ? null : d)}
            style={{ fontSize:12, padding:"3px 12px", borderRadius:99, cursor:"pointer",
              background: active ? c.bg : "var(--color-background-secondary)",
              color: active ? c.text : "var(--color-text-secondary)",
              border: active ? `1.5px solid ${c.border}` : "0.5px solid var(--color-border-tertiary)",
              fontWeight: active ? 500 : 400 }}>
            {DIFF_LABELS[d]}
          </button>
        );
      })}
      {current && <button onClick={() => onChange(null)} style={{ fontSize:11, padding:"3px 8px", borderRadius:99, cursor:"pointer", background:"transparent", color:"var(--color-text-tertiary)", border:"0.5px solid var(--color-border-tertiary)" }}>✕</button>}
    </div>
  );
}

function PctBar({ pct, color }) {
  return (
    <div style={{ height:4, borderRadius:99, background:"var(--color-background-secondary)", overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${pct}%`, background: color || "var(--color-border-info)", borderRadius:99 }}/>
    </div>
  );
}

function NavBar({ onHome, title, right }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"1rem", flexWrap:"wrap" }}>
      <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>← Home</button>
      <span style={{ fontSize:15, fontWeight:500, flex:1 }}>{title}</span>
      {right}
    </div>
  );
}

// English-translation display toggle (none / question only / question + options) — shared by Home and Quiz
function EnToggle({ enMode, setEnMode, prefix = "EN" }) {
  return (
    <div style={{ display:"flex", gap:4, alignItems:"center" }}>
      {prefix && <span style={{ fontSize:11, color:"var(--color-text-tertiary)", marginRight:2 }}>{prefix}:</span>}
      {[["none","Off"],["question","Question"],["full","Full"]].map(([v,l]) => (
        <button key={v} onClick={() => setEnMode(v)}
          style={{ fontSize:11, padding:"3px 8px", borderRadius:99, cursor:"pointer",
            background: enMode===v ? "var(--color-background-info)" : "var(--color-background-secondary)",
            color: enMode===v ? "var(--color-text-info)" : "var(--color-text-secondary)",
            border: enMode===v ? "1px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
            fontWeight: enMode===v ? 500 : 400 }}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────
function HomeScreen({ difficulties, history, progress, dueCount, resume, onResume, onStart, onQuickTest, onMockExam, onHistory, onBrowser, onHelp, onSettings, onResetRatings, onSmartReview }) {
  const counts = countByDiff(difficulties);
  const [qtDiff, setQtDiff]   = useState("random");
  const [qtCount, setQtCount] = useState(20);
  const [secCount, setSecCount] = useState(20);
  // Full-quiz filters combine: section AND level, with a count and order
  const [fqSection, setFqSection] = useState("all"); // "all" | section string
  const [fqLevel,   setFqLevel]   = useState("all"); // "all" | "bund" | "kanton" | "gemeinde"
  const [fqOrder,   setFqOrder]   = useState("random"); // "random" | "sequential"
  const [confirmReset, setConfirmReset] = useState(false);
  const pill = (active) => ({ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
    background: active ? "var(--color-background-info)" : "var(--color-background-secondary)",
    color: active ? "var(--color-text-info)" : "var(--color-text-secondary)",
    border: active ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    fontWeight: active ? 500 : 400 });
  const fqAvail = ALL_QUESTIONS.filter(q =>
    (fqSection === "all" || q.s === fqSection) &&
    (fqLevel === "all" || q.lvl === fqLevel)).length;
  const fqCount = secCount === "all" ? fqAvail : Math.min(secCount, fqAvail);
  const fqLabel = `${fqCount} question${fqCount === 1 ? "" : "s"} · ${fqSection === "all" ? "all sections" : secName(fqSection)} · ${fqLevel === "all" ? "all levels" : LVL_LABELS[fqLevel]} · ${fqOrder}`;
  const pct = Math.round(((ALL_QUESTIONS.length - counts.unrated) / ALL_QUESTIONS.length) * 100);
  const lastSession = history[0];
  // Weakest attempted section, for a quick study nudge (needs a few answers to be meaningful)
  const weakest = Object.entries(statsBy(progress, q => q.s))
    .filter(([, a]) => a.seen >= 3)
    .map(([s, a]) => ({ s, acc: Math.round(a.correct / a.seen * 100) }))
    .sort((a, b) => a.acc - b.acc)[0];

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, marginBottom:"1.25rem", paddingRight:34 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:500, margin:"0 0 4px" }}>Zürich Grundkenntnistest</h2>
          <p style={{ fontSize:13, color:"var(--color-text-secondary)", margin:0 }}>{ALL_QUESTIONS.length} questions · 5 sections</p>
        </div>
        <button onClick={onSettings} aria-label="Settings" title="Settings & display options"
          style={{ ...S.btn, flexShrink:0, fontSize:18, lineHeight:1, padding:"5px 9px" }}>⚙</button>
      </div>

      {/* Resume an unfinished session */}
      {resume && (
        <div style={{ ...S.card, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", padding:"0.85rem 1.25rem", border:"1px solid var(--color-border-warning)", background:"var(--color-background-warning)" }}>
          <div style={{ fontSize:13, color:"var(--color-text-warning)" }}>
            ⏸ Unfinished {resume.kind === "exam" ? "mock exam" : "quiz"} — question {(resume.idx ?? 0) + 1} of {resume.ids.length}
          </div>
          <button style={S.btnPrim} onClick={onResume}>Resume →</button>
        </div>
      )}

      {/* Mock exam — the real-test simulation */}
      <div style={{ ...S.card, border:"1px solid var(--color-border-info)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600 }}>🎓 Mock exam</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:3 }}>
              {EXAM_COUNT} questions · {EXAM_MINUTES} min · pass at {EXAM_PASS_PCT}% · exam mix, no feedback until the end
            </div>
          </div>
          <button style={S.btnPrim} onClick={onMockExam}>Start mock exam →</button>
        </div>
      </div>

      {/* Ratings summary */}
      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem", gap:8 }}>
          <div style={{ fontSize:13, fontWeight:500 }}>Difficulty ratings</div>
          {counts.unrated < ALL_QUESTIONS.length && (
            confirmReset
              ? <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <span style={{ fontSize:11, color:"var(--color-text-danger)", fontWeight:500 }}>Reset all {ALL_QUESTIONS.length - counts.unrated} ratings? This can’t be undone.</span>
                  <button style={{ ...S.btn, fontSize:11, padding:"2px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)", fontWeight:500 }}
                    onClick={() => { onResetRatings(); setConfirmReset(false); }}>Yes, reset</button>
                  <button style={{ ...S.btn, fontSize:11, padding:"2px 8px" }} onClick={() => setConfirmReset(false)}>Cancel</button>
                </div>
              : <button style={{ ...S.btn, fontSize:11, padding:"3px 10px" }} onClick={() => setConfirmReset(true)}>Reset ratings</button>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:".75rem" }}>
          {[["easy","Easy",counts.easy],["medium","Medium",counts.medium],["hard","Hard",counts.hard],["unrated","Unrated",counts.unrated]].map(([k,l,n]) => {
            const c = k==="unrated" ? null : DIFF_COLORS[k];
            return (
              <div key={k} style={{ padding:".6rem .75rem", borderRadius:"var(--border-radius-md)", background: c ? c.bg : "var(--color-background-secondary)", border:`0.5px solid ${c ? c.border : "var(--color-border-tertiary)"}` }}>
                <div style={{ fontSize:20, fontWeight:500, color: c ? c.text : "var(--color-text-secondary)" }}>{n}</div>
                <div style={{ fontSize:11, color: c ? c.text : "var(--color-text-tertiary)", marginTop:2 }}>{l}</div>
              </div>
            );
          })}
        </div>
        <PctBar pct={pct} />
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:4 }}>{pct}% rated · {counts.unrated} unrated</div>
      </div>

      {/* Quick test */}
      <div style={S.card}>
        <div style={{ fontSize:13, fontWeight:500, marginBottom:".75rem" }}>Quick test</div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-start", marginBottom:".75rem" }}>
          <div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>Focus on</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={() => setQtDiff("random")}
                style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                  background: qtDiff==="random" ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  color: qtDiff==="random" ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: qtDiff==="random" ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: qtDiff==="random" ? 500 : 400 }}>
                Random mix
              </button>
              <button onClick={() => setQtDiff("exam")}
                style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                  background: qtDiff==="exam" ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  color: qtDiff==="exam" ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: qtDiff==="exam" ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: qtDiff==="exam" ? 500 : 400 }}>
                Exam mix
              </button>
              {["easy","medium","hard"].map(d => {
                const c = DIFF_COLORS[d];
                return (
                  <button key={d} onClick={() => setQtDiff(d)}
                    style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                      background: qtDiff===d ? c.bg : "var(--color-background-secondary)",
                      color: qtDiff===d ? c.text : "var(--color-text-secondary)",
                      border: qtDiff===d ? `1.5px solid ${c.border}` : "0.5px solid var(--color-border-tertiary)",
                      fontWeight: qtDiff===d ? 500 : 400 }}>
                    {DIFF_LABELS[d]} ({counts[d]})
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>Questions</div>
            <div style={{ display:"flex", gap:6 }}>
              {[10,20,30,50].map(n => (
                <button key={n} onClick={() => setQtCount(n)}
                  style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                    background: qtCount===n ? "var(--color-background-info)" : "var(--color-background-secondary)",
                    color: qtCount===n ? "var(--color-text-info)" : "var(--color-text-secondary)",
                    border: qtCount===n ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                    fontWeight: qtCount===n ? 500 : 400 }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        {["easy","medium","hard"].includes(qtDiff) && counts[qtDiff] < qtCount && (
          <div style={{ fontSize:12, color:"var(--color-text-warning)", marginBottom:".5rem", background:"var(--color-background-warning)", padding:"6px 10px", borderRadius:"var(--border-radius-md)" }}>
            Only {counts[qtDiff]} {DIFF_LABELS[qtDiff]} questions rated — {qtCount - counts[qtDiff]} will be filled with unrated questions.
          </div>
        )}
        {qtDiff === "random" && (
          <div style={{ fontSize:12, color:"var(--color-text-info)", marginBottom:".5rem", background:"var(--color-background-info)", padding:"6px 10px", borderRadius:"var(--border-radius-md)" }}>
            Random mix — questions drawn from all {ALL_QUESTIONS.length} regardless of difficulty rating.
          </div>
        )}
        {qtDiff === "exam" && (
          <div style={{ fontSize:12, color:"var(--color-text-info)", marginBottom:".5rem", background:"var(--color-background-info)", padding:"6px 10px", borderRadius:"var(--border-radius-md)" }}>
            Exam mix — drawn ~70% federal / 20% cantonal / 10% municipal, like the real test (50 questions → 35 / 10 / 5).
          </div>
        )}
        <button style={S.btnPrim} onClick={() => onQuickTest(qtDiff, qtCount)}>Start quick test →</button>
      </div>

      {/* Full quiz — combine Section + Level + count + order, then press Start */}
      <div style={S.card}>
        <div style={{ fontSize:13, fontWeight:500, marginBottom:".75rem" }}>Full quiz</div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>Section</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          <button onClick={() => setFqSection("all")} style={pill(fqSection==="all")}>All sections</button>
          {SECTION_NAMES.map((s,i) => {
            const active = fqSection===s, n = secNum(s);
            return (
              <button key={i} onClick={() => setFqSection(s)}
                style={{ ...pill(active), display:"inline-flex", alignItems:"center", gap:6,
                  background: active ? `var(--sec-${n}-bg)` : "var(--color-background-secondary)",
                  color:      active ? `var(--sec-${n})`    : "var(--color-text-secondary)",
                  border:     active ? `1.5px solid var(--sec-${n}-bd)` : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:`var(--sec-${n}-bd)`, flexShrink:0 }}/>
                {secName(s)}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>Level</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          <button onClick={() => setFqLevel("all")} style={pill(fqLevel==="all")}>All levels</button>
          {[["bund","Federal"],["kanton","Cantonal"],["gemeinde","Municipal"]].map(([k,l]) => {
            const active = fqLevel===k;
            return (
              <button key={k} onClick={() => setFqLevel(k)}
                style={{ ...pill(active),
                  background: active ? `var(--lvl-${k}-bg)` : "var(--color-background-secondary)",
                  color:      active ? `var(--lvl-${k})`    : "var(--color-text-secondary)",
                  border:     active ? `1.5px solid var(--lvl-${k}-bd)` : "0.5px solid var(--color-border-tertiary)" }}>
                {l}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>How many?</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          {["all",10,20,30].map(n => (
            <button key={n} onClick={() => setSecCount(n)} style={pill(secCount===n)}>{n === "all" ? "All" : n}</button>
          ))}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>Order</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".85rem" }}>
          {[["random","Random"],["sequential","Sequential"]].map(([k,l]) => (
            <button key={k} onClick={() => setFqOrder(k)} style={pill(fqOrder===k)}>{l}</button>
          ))}
        </div>

        <div style={{ fontSize:12, color: fqCount ? "var(--color-text-secondary)" : "var(--color-text-danger)", marginBottom:".5rem" }}>
          {fqCount ? <>Selected: <b style={{ fontWeight:500 }}>{fqLabel}</b></> : "No questions match this section + level combination."}
        </div>
        <button disabled={!fqCount}
          style={{ ...S.btnPrim, opacity: fqCount ? 1 : .45, cursor: fqCount ? "pointer" : "default" }}
          onClick={() => onStart(fqSection, fqLevel, fqOrder, secCount === "all" ? null : secCount)}>
          Start quiz →
        </button>
      </div>

      {/* Bottom nav */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", paddingTop:"1rem", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
        <button style={S.btn} onClick={onBrowser}>
          📋 Browse all questions
        </button>
        <button style={{ ...S.btn, display:"flex", alignItems:"center", gap:6 }} onClick={onHistory}>
          📊 History & progress {history.length > 0 && <span style={{ ...S.badge, fontSize:10 }}>{history.length}</span>}
        </button>
        {dueCount > 0 && (
          <button style={{ ...S.btn, display:"flex", alignItems:"center", gap:6 }} onClick={onSmartReview}>
            🔁 Smart review <span style={{ ...S.badge, fontSize:10 }}>{dueCount}</span>
          </button>
        )}
        <button style={S.btn} onClick={onHelp}>❓ Help</button>
      </div>
      {weakest && (
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:8 }}>
          Weakest area so far: <span style={{ color:"var(--color-text-secondary)" }}>{weakest.s}</span> · {weakest.acc}% correct
        </div>
      )}
      {lastSession && (
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:4 }}>
          Last quiz: {formatDate(lastSession.ts)} · {lastSession.correct}/{lastSession.total} correct ({Math.round(lastSession.correct/lastSession.total*100)}%)
        </div>
      )}
    </div>
  );
}

// Explanation of why the answer is correct, with external source links. Shown once
// the answer is revealed. `en` controls whether the English translation is included.
function Explanation({ id, en }) {
  const ex = EXPLANATIONS[id];
  if (!ex) return null;
  return (
    <div style={{ marginTop:8, padding:"9px 11px", borderRadius:"var(--border-radius-md)",
      background:"var(--color-background-info)", border:"0.5px solid var(--color-border-info)" }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:.4, textTransform:"uppercase", color:"var(--color-text-info)", marginBottom:3 }}>ℹ Erklärung{en ? " · Explanation" : ""}</div>
      <div style={{ fontSize:12.5, color:"var(--color-text-primary)", lineHeight:1.45 }}>{ex.de}</div>
      {en && ex.en && <div style={{ fontSize:11.5, color:"var(--color-text-secondary)", fontStyle:"italic", lineHeight:1.45, marginTop:3 }}>{ex.en}</div>}
      {ex.src && ex.src.length > 0 && (
        <div style={{ marginTop:6, display:"flex", flexWrap:"wrap", gap:"3px 14px" }}>
          {ex.src.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:11, color:"var(--color-text-info)", textDecoration:"underline" }}>↗ {s.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quiz screen ───────────────────────────────────────────────────────────────
// Shared, accessible answer options (real <button>s) for both quiz and exam.
// `reveal` shows correct/wrong colouring; `disabled` locks the buttons after a quiz answer is submitted.
function OptionList({ q, order, enMode, pickCur, reveal, disabled, onPick }) {
  const optStyle = (oi) => {
    if (!reveal) {
      if (oi === pickCur) return { ...S.optBase, background:"var(--color-background-info)", border:"0.5px solid var(--color-border-info)" };
      return S.optBase;
    }
    if (oi === q.a)      return { ...S.optBase, background:"var(--color-background-success)", border:"0.5px solid var(--color-border-success)", cursor:"default" };
    if (oi === pickCur)  return { ...S.optBase, background:"var(--color-background-danger)",  border:"0.5px solid var(--color-border-danger)",  cursor:"default" };
    return { ...S.optBase, cursor:"default", opacity:.55 };
  };
  const keyColor = (oi) => reveal && oi === q.a ? "var(--color-text-success)"
    : reveal && oi === pickCur && oi !== q.a ? "var(--color-text-danger)" : "var(--color-text-tertiary)";

  if (Q_IMAGES[q.n]) {
    const imgs = Q_IMAGES[q.n];
    return (
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        {order.map((oi, p) => {
          const o = q.opts[oi];
          return (
            <button type="button" key={p} disabled={disabled} aria-pressed={oi === pickCur} aria-label={`${LETTERS[p]}) ${o.de}`}
              style={{ ...optStyle(oi), flexDirection:"column", alignItems:"center", padding:"8px", gap:6 }} onClick={() => onPick(oi)}>
              <img src={imgs[oi]} alt={o.de} style={{ width:"100%", maxHeight:80, objectFit:"contain", borderRadius:4 }}/>
              <div style={{ textAlign:"center", width:"100%" }}>
                <span style={{ fontSize:12, fontWeight:500, color:keyColor(oi), marginRight:4 }}>{LETTERS[p]})</span>
                <span style={{ fontSize:12, color:"var(--color-text-primary)" }}>{o.de}</span>
                {enMode === 'full' && o.en && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{o.en}</div>}
              </div>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {order.map((oi, p) => {
        const o = q.opts[oi];
        return (
          <button type="button" key={p} disabled={disabled} aria-pressed={oi === pickCur}
            style={optStyle(oi)} onClick={() => onPick(oi)}>
            <span style={{ ...S.optKey, color:keyColor(oi) }}>{LETTERS[p]})</span>
            <div>
              <div style={S.optDe}>{o.de}</div>
              {enMode === 'full' && o.en && <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{o.en}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function QuizScreen({ pool, difficulties, label, enMode, setEnMode, showExpl, setShowExpl, resume, onDiffChange, onHome, onSaveHistory, onRetryWrong, onRecordResults, onPersist }) {
  const [idx,       setIdx]       = useState(resume?.idx ?? 0);
  const [picks,     setPicks]     = useState(resume?.picks ?? {});      // { [questionIndex]: chosenOptionIndex } — tentative, before submit
  const [submitted, setSubmitted] = useState(resume?.submitted ?? {});  // { [questionIndex]: true } — confirmed/graded; kept so you can navigate back
  const [done,      setDone]      = useState(false);
  const [saved,     setSaved]     = useState(false);

  const q            = pool[idx];
  const pickCur      = picks[idx];               // chosen option index for this question, or undefined
  const hasPick      = pickCur !== undefined;
  const submittedCur = submitted[idx] === true;  // has this question been confirmed?
  const curDiff      = q ? difficulties[q.id] : null;

  // Per-question shuffled option order (display position -> original index), stable for the whole quiz so revisits match.
  const orders = useMemo(() => pool.map(() => shuffle([0,1,2,3])), [pool]);
  const order  = orders[idx] || [0,1,2,3];

  // Derived tallies — only submitted (confirmed) questions count, so navigating back/forward never double-counts
  const gradedIdx    = Object.keys(submitted).filter(i => submitted[i]).map(Number);
  const correct      = gradedIdx.reduce((n, i) => n + (picks[i] === pool[i].a ? 1 : 0), 0);
  const wrong        = gradedIdx.length - correct;
  const total        = correct + wrong;
  const pct          = total ? Math.round((correct / total) * 100) : 0;
  const sessionWrong = gradedIdx.filter(i => picks[i] !== pool[i].a).sort((a, b) => a - b).map(i => pool[i].id);
  const progress     = pool.length ? Math.round((idx / pool.length) * 100) : 0;

  // Best streak — longest run of consecutive correct (submitted) answers, in question order
  let bestStreak = 0;
  for (let i = 0, run = 0; i < pool.length; i++) {
    if (!submitted[i]) { run = 0; continue; }
    run = picks[i] === pool[i].a ? run + 1 : 0;
    if (run > bestStreak) bestStreak = run;
  }
  // Current streak — consecutive correct (submitted) answers ending at the current question
  let curStreak = 0;
  for (let i = idx; i >= 0; i--) {
    if (!submitted[i]) { if (i === idx) continue; break; }
    if (picks[i] === pool[i].a) curStreak++; else break;
  }

  const pick = useCallback((i) => {
    if (done || !q || submitted[idx]) return;     // can't change a confirmed answer
    setPicks(p => ({ ...p, [idx]: i }));
  }, [done, q, idx, submitted]);

  const submit = useCallback(() => {
    if (done || !q || picks[idx] === undefined || submitted[idx]) return;
    setSubmitted(s => ({ ...s, [idx]: true }));
  }, [done, q, idx, picks, submitted]);

  const goPrev = useCallback(() => {
    if (idx > 0) setIdx(idx - 1);
  }, [idx]);
  const goNext = useCallback(() => {
    if (idx + 1 >= pool.length) { setDone(true); return; }
    setIdx(idx + 1);
  }, [idx, pool.length]);

  // Primary action (big button / Enter / →): submit the current answer, then advance once it's confirmed
  const primary = useCallback(() => {
    if (submitted[idx]) goNext(); else submit();
  }, [submitted, idx, goNext, submit]);

  useEffect(() => {
    const h = (e) => {
      if (done) return;
      if (["1","2","3","4"].includes(e.key)) { if (!submitted[idx] && q) pick(order[+e.key - 1]); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); primary(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [done, submitted, idx, q, order, pick, goPrev, primary]);

  // Persist an in-progress snapshot so the quiz can be resumed after a refresh/close
  useEffect(() => {
    if (done) return;
    onPersist({ kind: "quiz", ids: pool.map(p => p.id), idx, picks, submitted, label, savedAt: Date.now() });
  }, [idx, picks, submitted, done, pool, label, onPersist]);

  // On completion: save history, feed the spaced-repetition progress, clear the resume snapshot
  useEffect(() => {
    if (done && !saved) {
      const results = gradedIdx.map(i => ({ id: pool[i].id, correct: picks[i] === pool[i].a }));
      const details = pool.map((qq, i) => ({ id: qq.id, picked: submitted[i] ? (picks[i] ?? null) : null }));
      onSaveHistory({ ts: Date.now(), label, correct, total, wrong: sessionWrong, bestStreak, details });
      onRecordResults(results);
      onPersist(null);
      setSaved(true);
    }
  }, [done, saved, correct, total, sessionWrong, bestStreak, label, gradedIdx, picks, pool, onSaveHistory, onRecordResults, onPersist]);

  if (done) {
    const emoji = pct>=90?"🏆":pct>=70?"👍":pct>=50?"📚":"💪";
    return (
      <div style={{ padding:"1rem" }}>
        <div style={{ ...S.card, textAlign:"center", padding:"2rem 1.5rem" }}>
          <div style={{ fontSize:48, fontWeight:500, marginBottom:4 }}>{emoji} {pct}%</div>
          <div style={{ fontSize:14, color:"var(--color-text-secondary)", marginBottom:"1.25rem" }}>{correct} correct out of {total} questions</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:"1.25rem" }}>
            {[["✓ "+correct,"Correct","var(--color-text-success)"],["✗ "+wrong,"Wrong","var(--color-text-danger)"],[bestStreak,"Best streak","var(--color-text-primary)"]].map(([n,l,c]) => (
              <div key={l} style={{ padding:".75rem", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)" }}>
                <div style={{ fontSize:22, fontWeight:500, color:c }}>{n}</div>
                <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
          {sessionWrong.length > 0 && (
            <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:"1rem", textAlign:"left", background:"var(--color-background-secondary)", padding:"8px 12px", borderRadius:"var(--border-radius-md)" }}>
              <div style={{ fontWeight:500, marginBottom:4 }}>Wrong answers:</div>
              Q{sessionWrong.join(", Q")}
            </div>
          )}
          <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
            {sessionWrong.length > 0 && <button style={S.btn} onClick={() => onRetryWrong(sessionWrong)}>↻ Retry wrong ({sessionWrong.length})</button>}
            <button style={S.btnPrim} onClick={onHome}>← Home</button>
          </div>
          <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:12 }}>Result saved to history</div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:".6rem", flexWrap:"wrap", gap:6, paddingRight:28 }}>
        <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>← Home</button>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
          <span style={S.badge}>{idx+1}/{pool.length}</span>
          <span style={{ ...S.badge, background:"var(--color-background-success)", color:"var(--color-text-success)", border:"0.5px solid var(--color-border-success)" }}>✓ {correct}</span>
          <span style={{ ...S.badge, background:"var(--color-background-danger)",  color:"var(--color-text-danger)",  border:"0.5px solid var(--color-border-danger)"  }}>✗ {wrong}</span>
          <span style={S.badge}>{pct}%</span>
          {curStreak >= 3 && <span style={{ ...S.badge, background:"var(--color-background-warning)", color:"var(--color-text-warning)", border:"0.5px solid var(--color-border-warning)" }}>🔥 {curStreak}</span>}
        </div>
      </div>

      <div style={{ height:3, borderRadius:99, background:"var(--color-background-secondary)", marginBottom:".75rem", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${progress}%`, background:"var(--color-border-info)", borderRadius:99, transition:"width .3s" }}/>
      </div>

      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:".5rem", flexWrap:"wrap", gap:6 }}>
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            <span style={S.badge}>Q{q.n}</span>
            <SecBadge s={q.s} />
          </div>
          <div style={{ display:"flex", gap:5, alignItems:"center" }}>
            <SpeakButton text={sayText(q, order)} />
            <LvlBadge lvl={q.lvl} />
            <DiffBadge diff={curDiff} />
          </div>
        </div>

        <div style={S.qDe}>{q.de}</div>
        {(enMode === 'question' || enMode === 'full') && q.en && <div style={S.qEn}>{q.en}</div>}


        <QImage src={q.img} />
        <OptionList q={q} order={order} enMode={enMode} pickCur={pickCur} reveal={submittedCur} disabled={submittedCur} onPick={pick} />

        {submittedCur && (
          <div style={{ marginTop:".75rem", padding:"10px 12px", borderRadius:"var(--border-radius-md)", fontSize:13, fontWeight:500,
            background: pickCur===q.a?"var(--color-background-success)":"var(--color-background-danger)",
            color:       pickCur===q.a?"var(--color-text-success)":"var(--color-text-danger)" }}>
            {pickCur===q.a ? <>✓ &nbsp;Richtig! — {q.opts[q.a].de}</> : <>✗ &nbsp;Antwort: {LETTERS[q.a]}) {q.opts[q.a].de}</>}
          </div>
        )}
        {submittedCur && showExpl && <Explanation id={q.id} en={enMode === 'question' || enMode === 'full'} />}

        <div style={{ marginTop:".85rem", paddingTop:".85rem", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
          <DiffPicker current={curDiff} onChange={(d) => onDiffChange(q.id, d)} />
        </div>
      </div>

      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={goPrev} disabled={idx === 0}
          style={{ ...S.btn, opacity: idx === 0 ? .4 : 1, cursor: idx === 0 ? "default" : "pointer" }}>
          ← Back
        </button>
        {submittedCur
          ? <button style={S.btnPrim} onClick={goNext}>{idx + 1 >= pool.length ? "Finish ✓" : "Next →"}</button>
          : <button onClick={submit} disabled={!hasPick}
              style={{ ...S.btnPrim, opacity: hasPick ? 1 : .45, cursor: hasPick ? "pointer" : "default" }}>Submit answer</button>}
        {!submittedCur && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{hasPick ? "Submit to confirm · ←/→ to navigate" : "Pick 1–4, then Submit · ←/→ to navigate"}</span>}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <Switch on={showExpl} onChange={setShowExpl} label="💡 Explain" />
          <EnToggle enMode={enMode} setEnMode={setEnMode} />
        </div>
      </div>
    </div>
  );
}

// ── Mock exam screen ──────────────────────────────────────────────────────────
function ExamScreen({ pool, difficulties, label, enMode, setEnMode, resume, onDiffChange, onHome, onSaveHistory, onRetryWrong, onRecordResults, onPersist }) {
  const [idx,         setIdx]         = useState(resume?.idx ?? 0);
  const [picks,       setPicks]       = useState(resume?.picks ?? {});  // changeable until the exam ends
  const [secondsLeft, setSecondsLeft] = useState(() => resume
    ? Math.max(0, (resume.secondsLeft ?? EXAM_MINUTES * 60) - Math.floor((Date.now() - (resume.savedAt ?? Date.now())) / 1000))
    : EXAM_MINUTES * 60);
  const [done,        setDone]        = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [confirmEnd,  setConfirmEnd]  = useState(false);

  const q      = pool[idx];
  const orders = useMemo(() => pool.map(() => shuffle([0,1,2,3])), [pool]);
  const order  = orders[idx] || [0,1,2,3];

  // Grading (only meaningful on the results screen) — unanswered counts as wrong, out of all questions
  const answeredCount = Object.keys(picks).length;
  const correct   = pool.reduce((n, qq, i) => n + (picks[i] === qq.a ? 1 : 0), 0);
  const total     = pool.length;
  const pct       = total ? Math.round((correct / total) * 100) : 0;
  const passed    = pct >= EXAM_PASS_PCT;
  const wrongQs   = pool.filter((qq, i) => picks[i] !== qq.a);
  const wrongNums = wrongQs.map(qq => qq.id);
  const results   = pool.map((qq, i) => ({ id: qq.id, correct: picks[i] === qq.a }));

  const pick   = useCallback((oi) => { if (!done) setPicks(p => ({ ...p, [idx]: oi })); }, [done, idx]);
  const goPrev = useCallback(() => { if (idx > 0) setIdx(idx - 1); }, [idx]);
  const goNext = useCallback(() => { if (idx + 1 >= pool.length) setDone(true); else setIdx(idx + 1); }, [idx, pool.length]);

  // Countdown — auto-finishes when time runs out
  useEffect(() => {
    if (done) return;
    if (secondsLeft <= 0) { setDone(true); return; }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, done]);

  useEffect(() => {
    if (done) return;
    const h = (e) => {
      if (["1","2","3","4"].includes(e.key)) { if (q) pick(order[+e.key - 1]); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [done, q, order, pick, goPrev, goNext]);

  // Persist a snapshot (incl. remaining time) so the exam can be resumed; secondsLeft+savedAt let us recompute elapsed
  useEffect(() => {
    if (done) return;
    onPersist({ kind: "exam", ids: pool.map(p => p.id), idx, picks, label, secondsLeft, savedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, picks, done, pool, label, onPersist]);

  useEffect(() => {
    if (done && !saved) {
      const details = pool.map((qq, i) => ({ id: qq.id, picked: picks[i] ?? null }));
      onSaveHistory({ ts: Date.now(), label, correct, total, wrong: wrongNums, bestStreak: 0, details });
      onRecordResults(results);
      onPersist(null);
      setSaved(true);
    }
  }, [done, saved, correct, total, wrongNums, results, label, onSaveHistory, onRecordResults, onPersist]);

  const fmt = s => `${Math.floor(Math.max(0,s)/60)}:${String(Math.max(0,s)%60).padStart(2,"0")}`;

  // ── Results ──
  if (done) {
    const usedSec = EXAM_MINUTES*60 - Math.max(0, secondsLeft);
    return (
      <div style={{ padding:"1rem" }}>
        <div style={{ ...S.card, textAlign:"center", padding:"1.75rem 1.5rem",
          background: passed ? "var(--color-background-success)" : "var(--color-background-danger)",
          borderColor: passed ? "var(--color-border-success)" : "var(--color-border-danger)" }}>
          <div style={{ fontSize:36, fontWeight:600, color: passed ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
            {passed ? "✓ Passed" : "✗ Not passed"}
          </div>
          <div style={{ fontSize:15, color: passed ? "var(--color-text-success)" : "var(--color-text-danger)", marginTop:4 }}>
            {correct}/{total} correct · {pct}% <span style={{ opacity:.7 }}>(pass mark {EXAM_PASS_PCT}%)</span>
          </div>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginTop:8 }}>
            Time used {fmt(usedSec)} of {EXAM_MINUTES}:00 · {answeredCount}/{total} answered
          </div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginBottom:"1rem" }}>
          {wrongNums.length > 0 && <button style={S.btn} onClick={() => onRetryWrong(wrongNums)}>↻ Retry wrong ({wrongNums.length})</button>}
          <button style={S.btnPrim} onClick={onHome}>← Home</button>
        </div>
        {wrongQs.length > 0 && (
          <>
            <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-tertiary)", marginBottom:8 }}>Review your {wrongQs.length} wrong answer{wrongQs.length!==1?"s":""}</div>
            <QuestionList questions={wrongQs} difficulties={difficulties} onDiffChange={onDiffChange} />
          </>
        )}
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:12, textAlign:"center" }}>Result saved to history</div>
      </div>
    );
  }

  if (!q) return null;
  const pickCur  = picks[idx];
  const lowTime  = secondsLeft <= 300;
  const timeProg = Math.round((1 - secondsLeft / (EXAM_MINUTES*60)) * 100);

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:".6rem", flexWrap:"wrap", gap:6, paddingRight:28 }}>
        <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>← Home</button>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ ...S.badge, fontVariantNumeric:"tabular-nums", fontWeight:500,
            background: lowTime ? "var(--color-background-danger)" : "var(--color-background-secondary)",
            color: lowTime ? "var(--color-text-danger)" : "var(--color-text-primary)",
            border: `0.5px solid ${lowTime ? "var(--color-border-danger)" : "var(--color-border-tertiary)"}` }}>⏱ {fmt(secondsLeft)}</span>
          <span style={S.badge}>{idx+1}/{pool.length}</span>
          <span style={S.badge}>{answeredCount} answered</span>
          {confirmEnd
            ? <span style={{ display:"flex", gap:4, alignItems:"center" }}>
                <span style={{ fontSize:11, color:"var(--color-text-danger)" }}>{answeredCount < total ? `${total-answeredCount} unanswered. End?` : "End now?"}</span>
                <button style={{ ...S.btn, fontSize:11, padding:"2px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)" }} onClick={() => setDone(true)}>Yes</button>
                <button style={{ ...S.btn, fontSize:11, padding:"2px 8px" }} onClick={() => setConfirmEnd(false)}>No</button>
              </span>
            : <button style={{ ...S.btn, fontSize:11, padding:"3px 10px" }} onClick={() => setConfirmEnd(true)}>End exam</button>}
        </div>
      </div>

      <div style={{ height:3, borderRadius:99, background:"var(--color-background-secondary)", marginBottom:".75rem", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${timeProg}%`, background: lowTime ? "var(--color-border-danger)" : "var(--color-border-info)", borderRadius:99, transition:"width 1s linear" }}/>
      </div>

      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:".5rem", flexWrap:"wrap", gap:6 }}>
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            <span style={S.badge}>Q{q.n}</span>
            <SecBadge s={q.s} />
          </div>
          <LvlBadge lvl={q.lvl} />
        </div>

        <div style={S.qDe}>{q.de}</div>
        {(enMode === 'question' || enMode === 'full') && q.en && <div style={S.qEn}>{q.en}</div>}

        <QImage src={q.img} />
        <OptionList q={q} order={order} enMode={enMode} pickCur={pickCur} reveal={false} disabled={false} onPick={pick} />
      </div>

      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={goPrev} disabled={idx === 0}
          style={{ ...S.btn, opacity: idx === 0 ? .4 : 1, cursor: idx === 0 ? "default" : "pointer" }}>← Back</button>
        <button style={S.btnPrim} onClick={goNext}>{idx + 1 >= pool.length ? "Finish ✓" : "Next →"}</button>
        {pickCur === undefined && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Pick 1–4 · ←/→ to navigate · answers stay changeable</span>}
        <div style={{ marginLeft:"auto" }}>
          <EnToggle enMode={enMode} setEnMode={setEnMode} />
        </div>
      </div>
    </div>
  );
}

// Accuracy bars grouped by some attribute (section / level), weakest first
function AccuracyBreakdown({ title, agg, labelFn }) {
  const rows = Object.entries(agg)
    .map(([k, a]) => ({ k, ...a, acc: a.seen ? Math.round(a.correct / a.seen * 100) : null }))
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999));
  return (
    <div style={S.card}>
      <div style={{ fontSize:13, fontWeight:500, marginBottom:".75rem" }}>{title}</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {rows.map(r => {
          const color = r.acc == null ? "var(--color-border-tertiary)"
            : r.acc >= 80 ? "var(--color-border-success)" : r.acc >= 60 ? "var(--color-border-warning)" : "var(--color-border-danger)";
          return (
            <div key={r.k}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3, gap:8 }}>
                <span style={{ color:"var(--color-text-secondary)" }}>{labelFn(r.k)}</span>
                <span style={{ color:"var(--color-text-tertiary)", flexShrink:0 }}>{r.acc == null ? "not attempted yet" : `${r.acc}% · ${r.mastered}/${r.total} mastered`}</span>
              </div>
              <PctBar pct={r.acc ?? 0} color={color} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Full per-question breakdown of one past session: every question with the chosen and correct answer.
// Each question has its own EN toggle to reveal the English translation on demand.
function SessionQuestions({ details }) {
  const [shown, setShown] = useState({}); // { [index]: true } — which questions currently show English
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8, paddingTop:8, borderTop:"0.5px solid var(--color-border-tertiary)" }}>
      {details.map(({ id, picked }, di) => {
        const q = BY_ID.get(id);
        if (!q) return null;
        const en = !!shown[di];
        return (
          <div key={di} style={{ border:"0.5px solid var(--color-border-tertiary)", borderLeft:`3px solid var(--sec-${secNum(q.s)}-bd)`, borderRadius:"var(--border-radius-md)", padding:"8px 10px" }}>
            <div style={{ display:"flex", gap:6, alignItems:"flex-start", marginBottom:5 }}>
              <span style={{ ...S.badge, fontSize:10, flexShrink:0, marginTop:1 }}>Q{q.n}</span>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-primary)", lineHeight:1.35 }}>{q.de}</div>
                {en && q.en && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{q.en}</div>}
              </div>
              {q.en && (
                <button type="button" onClick={() => setShown(s => ({ ...s, [di]: !s[di] }))}
                  aria-pressed={en} title="Show/hide English translation"
                  style={{ ...S.badge, cursor:"pointer", flexShrink:0, fontSize:10, padding:"2px 7px",
                    background: en ? "var(--color-background-info)" : "var(--color-background-secondary)",
                    color: en ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                    border: `0.5px solid ${en ? "var(--color-border-info)" : "var(--color-border-tertiary)"}` }}>
                  EN
                </button>
              )}
            </div>
            <QImage src={q.img} maxHeight={140} />
            {Q_IMAGES[q.n] ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                {q.opts.map((o, i) => {
                  const isCorrect = i === q.a, isPicked = i === picked;
                  const tone = isCorrect ? "success" : isPicked ? "danger" : null;
                  return (
                    <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"6px", borderRadius:"var(--border-radius-md)",
                      background: tone ? `var(--color-background-${tone})` : "var(--color-background-secondary)",
                      border: `0.5px solid ${tone ? `var(--color-border-${tone})` : "var(--color-border-tertiary)"}` }}>
                      <img src={Q_IMAGES[q.n][i]} alt={o.de} style={{ width:"100%", maxHeight:64, objectFit:"contain", borderRadius:4 }} />
                      <div style={{ textAlign:"center" }}>
                        <span style={{ fontSize:11, fontWeight:500, color: tone ? `var(--color-text-${tone})` : "var(--color-text-tertiary)" }}>{LETTERS[i]}) </span>
                        <span style={{ fontSize:11, color: tone ? `var(--color-text-${tone})` : "var(--color-text-primary)" }}>{o.de}</span>
                        {en && o.en && <div style={{ fontSize:10, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{o.en}</div>}
                        {(isCorrect || isPicked) && <div style={{ fontSize:10, marginTop:1, color: `var(--color-text-${tone})` }}>{isCorrect ? (isPicked ? "✓ your answer" : "✓ correct") : "✗ your answer"}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {q.opts.map((o, i) => {
                  const isCorrect = i === q.a, isPicked = i === picked;
                  const tone = isCorrect ? "success" : isPicked ? "danger" : null;
                  return (
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"baseline", padding:"4px 8px", borderRadius:"var(--border-radius-md)",
                      background: tone ? `var(--color-background-${tone})` : "var(--color-background-secondary)",
                      border: `0.5px solid ${tone ? `var(--color-border-${tone})` : "var(--color-border-tertiary)"}` }}>
                      <span style={{ fontSize:11, fontWeight:500, flexShrink:0, color: tone ? `var(--color-text-${tone})` : "var(--color-text-tertiary)" }}>{LETTERS[i]})</span>
                      <div style={{ minWidth:0 }}>
                        <span style={{ fontSize:12, color: tone ? `var(--color-text-${tone})` : "var(--color-text-primary)" }}>{o.de}</span>
                        {en && o.en && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{o.en}</div>}
                      </div>
                      <span style={{ marginLeft:"auto", fontSize:10, flexShrink:0, color: tone ? `var(--color-text-${tone})` : "transparent" }}>
                        {isCorrect ? (isPicked ? "✓ your answer" : "✓ correct") : (isPicked ? "✗ your answer" : "")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {picked == null && <div style={{ fontSize:11, color:"var(--color-text-warning)", marginTop:4 }}>Not answered</div>}
            <Explanation id={q.id} en={en} />
          </div>
        );
      })}
    </div>
  );
}

// ── History & progress screen ─────────────────────────────────────────────────
function HistoryScreen({ history, progress, onHome, onClear }) {
  const [openDetail, setOpenDetail] = useState(null);
  const [confirm, setConfirm] = useState(false);

  if (history.length === 0) {
    return (
      <div style={{ padding:"1rem" }}>
        <NavBar onHome={onHome} title="History & progress" />
        <div style={{ ...S.card, textAlign:"center", padding:"2rem", color:"var(--color-text-tertiary)", fontSize:14 }}>
          No quiz sessions yet. Complete a quiz to see your history and progress here.
        </div>
      </div>
    );
  }

  // Aggregate stats
  const totalSessions = history.length;
  const totalQs       = history.reduce((s, h) => s + h.total, 0);
  const totalCorrect  = history.reduce((s, h) => s + h.correct, 0);
  const avgPct        = Math.round(totalCorrect / totalQs * 100);
  const bestPct       = Math.max(...history.map(h => Math.round(h.correct/h.total*100)));
  const trend         = history.slice(0, 5).map(h => Math.round(h.correct/h.total*100));

  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title="History & progress"
        right={
          confirm
            ? <div style={{ display:"flex", gap:6 }}>
                <span style={{ fontSize:12, color:"var(--color-text-danger)" }}>Clear all?</span>
                <button style={{ ...S.btn, fontSize:12, padding:"3px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)" }} onClick={() => { onClear(); setConfirm(false); }}>Yes</button>
                <button style={{ ...S.btn, fontSize:12, padding:"3px 8px" }} onClick={() => setConfirm(false)}>No</button>
              </div>
            : <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={() => setConfirm(true)}>Clear history</button>
        }
      />

      {/* Summary stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:"1rem" }}>
        {[[totalSessions,"Sessions"],[totalQs,"Questions"],[avgPct+"%","Avg score"],[bestPct+"%","Best score"]].map(([n,l]) => (
          <div key={l} style={{ padding:".6rem .75rem", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize:18, fontWeight:500 }}>{n}</div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Recent trend */}
      {trend.length > 1 && (
        <div style={{ ...S.card, padding:"1rem" }}>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:8 }}>Recent scores (last {trend.length})</div>
          <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:48 }}>
            {trend.reverse().map((p, i) => (
              <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <div style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>{p}%</div>
                <div style={{ width:"100%", borderRadius:4,
                  height: Math.max(4, Math.round(p / 100 * 36)) + "px",
                  background: p>=80?"var(--color-border-success)":p>=60?"var(--color-border-warning)":"var(--color-border-danger)" }}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths & weaknesses dashboard */}
      {Object.keys(progress).length > 0 && (
        <>
          <AccuracyBreakdown title="Accuracy by section" agg={statsBy(progress, q => q.s)} labelFn={s => (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:`var(--sec-${secNum(s)}-bd)`, flexShrink:0 }}/>{secName(s)}
            </span>
          )} />
          <AccuracyBreakdown title="Accuracy by level"   agg={statsBy(progress, q => q.lvl)} labelFn={l => (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:`var(--lvl-${l}-bd)`, flexShrink:0 }}/>{LVL_LABELS[l] || l}
            </span>
          )} />
        </>
      )}

      {/* Session list */}
      <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-tertiary)", marginBottom:8 }}>Sessions</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {history.map((h, i) => {
          const p = Math.round(h.correct / h.total * 100);
          const scoreColor = p>=80?"var(--color-text-success)":p>=60?"var(--color-text-warning)":"var(--color-text-danger)";
          return (
            <div key={i} style={{ ...S.card, marginBottom:0, padding:"1rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{h.label}</div>
                  <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>{formatDate(h.ts)}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:20, fontWeight:500, color:scoreColor }}>{p}%</div>
                  <div style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{h.correct}/{h.total}</div>
                </div>
              </div>
              <PctBar pct={p} color={p>=80?"var(--color-border-success)":p>=60?"var(--color-border-warning)":"var(--color-border-danger)"} />
              {h.wrong && h.wrong.length > 0 && (
                <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:6 }}>
                  Wrong: Q{h.wrong.slice(0,10).join(", Q")}{h.wrong.length > 10 ? ` +${h.wrong.length-10} more` : ""}
                </div>
              )}
              {h.bestStreak > 1 && (
                <div style={{ fontSize:11, color:"var(--color-text-warning)", marginTop:3 }}>🔥 Best streak: {h.bestStreak}</div>
              )}
              {h.details && h.details.length > 0 && (
                <button style={{ ...S.btn, fontSize:11, padding:"3px 10px", marginTop:8 }}
                  onClick={() => setOpenDetail(openDetail === i ? null : i)}>
                  {openDetail === i ? "Hide questions ▲" : `View questions & answers (${h.details.length}) ▼`}
                </button>
              )}
              {openDetail === i && h.details && <SessionQuestions details={h.details} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Question list (shared) ───────────────────────────────────────────────────
function QuestionList({ questions, difficulties, onDiffChange, answersHidden = false }) {
  const [expanded, setExpanded] = useState(null);
  const [shown, setShown] = useState({});       // per-question English toggle: { [n]: true }
  const [shownAns, setShownAns] = useState({}); // per-question answer-reveal toggle (when answersHidden)
  if (questions.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"2rem", color:"var(--color-text-tertiary)", fontSize:13 }}>
        No questions here yet. Rate some questions to populate this tab.
      </div>
    );
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {questions.map(q => {
        const isOpen = expanded === q.n;
        const diff   = difficulties[q.id];
        const en     = !!shown[q.n];
        const reveal = !answersHidden || !!shownAns[q.n]; // whether to highlight the correct answer
        return (
          <div key={q.n} style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderLeft:`3px solid var(--sec-${secNum(q.s)}-bd)`, borderRadius:"var(--border-radius-md)", overflow:"hidden" }}>
            <div onClick={() => setExpanded(isOpen ? null : q.n)}
              style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 12px", cursor:"pointer" }}>
              <span style={{ ...S.badge, flexShrink:0, fontSize:10 }}>Q{q.n}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)", lineHeight:1.35 }}>{q.de}</div>
                {en && q.en && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{q.en}</div>}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                {(Q_IMAGES[q.n] || q.img) && <span style={{ ...S.badge, fontSize:11, padding:"1px 5px" }} title="Has a picture — expand to view">🖼</span>}
                {q.en && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setShown(s => ({ ...s, [q.n]: !s[q.n] })); }}
                    aria-pressed={en} title="Show/hide English translation"
                    style={{ ...S.badge, fontSize:10, padding:"1px 6px", cursor:"pointer",
                      background: en ? "var(--color-background-info)" : "var(--color-background-secondary)",
                      color: en ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                      border: `0.5px solid ${en ? "var(--color-border-info)" : "var(--color-border-tertiary)"}` }}>EN</button>
                )}
                <LvlBadge lvl={q.lvl} small />
                <DiffBadge diff={diff} small />
                <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{ padding:"0 12px 12px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
                <div style={{ paddingTop:10 }}><QImage src={q.img} maxHeight={160} /></div>
                {Q_IMAGES[q.n] ? (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, margin:"10px 0" }}>
                    {q.opts.map((o, i) => {
                      const isAns = reveal && i === q.a;
                      return (
                        <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"6px", borderRadius:"var(--border-radius-md)",
                          background: isAns ? "var(--color-background-success)" : "var(--color-background-secondary)",
                          border: `0.5px solid ${isAns ? "var(--color-border-success)" : "var(--color-border-tertiary)"}` }}>
                          <img src={Q_IMAGES[q.n][i]} alt={o.de} style={{ width:"100%", maxHeight:64, objectFit:"contain", borderRadius:4 }} />
                          <div style={{ textAlign:"center" }}>
                            <span style={{ fontSize:11, fontWeight:500, color: isAns ? "var(--color-text-success)" : "var(--color-text-tertiary)" }}>{LETTERS[i]}) </span>
                            <span style={{ fontSize:11, color: isAns ? "var(--color-text-success)" : "var(--color-text-primary)" }}>{o.de}</span>
                            {en && o.en && <div style={{ fontSize:10, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{o.en}</div>}
                            {isAns && <div style={{ fontSize:10, color:"var(--color-text-success)", marginTop:1 }}>✓ correct</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:4, margin:"10px 0 10px" }}>
                    {q.opts.map((o, i) => {
                      const isAns = reveal && i === q.a;
                      return (
                        <div key={i} style={{ display:"flex", gap:8, padding:"6px 10px", borderRadius:"var(--border-radius-md)",
                          background: isAns ? "var(--color-background-success)" : "var(--color-background-secondary)",
                          border: `0.5px solid ${isAns ? "var(--color-border-success)" : "var(--color-border-tertiary)"}` }}>
                          <span style={{ fontSize:12, fontWeight:500, color: isAns ? "var(--color-text-success)" : "var(--color-text-tertiary)", flexShrink:0 }}>
                            {LETTERS[i]})
                          </span>
                          <div style={{ minWidth:0 }}>
                            <span style={{ fontSize:13, color: isAns ? "var(--color-text-success)" : "var(--color-text-primary)", fontWeight: isAns ? 500 : 400 }}>{o.de}</span>
                            {en && o.en && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{o.en}</div>}
                          </div>
                          {isAns && <span style={{ fontSize:11, color:"var(--color-text-success)", marginLeft:"auto", flexShrink:0 }}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {reveal && <Explanation id={q.id} en={en} />}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8, marginTop:8, flexWrap:"wrap" }}>
                  <SecBadge s={q.s} />
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    {answersHidden && <Switch on={reveal} onChange={() => setShownAns(s => ({ ...s, [q.n]: !s[q.n] }))} label="Show answer" />}
                    <SpeakButton text={sayText(q)} small />
                  </div>
                </div>

                <DiffPicker current={diff} onChange={(d) => onDiffChange(q.id, d)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Question browser ──────────────────────────────────────────────────────────
function BrowserScreen({ difficulties, onDiffChange, onHome }) {
  const [tab,           setTab]           = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [filterLvl,     setFilterLvl]     = useState("all");
  const [search,        setSearch]        = useState("");

  const counts = countByDiff(difficulties);

  const TABS = [
    { key:"all",     label:"All",     count: ALL_QUESTIONS.length },
    { key:"easy",    label:"Easy",    count: counts.easy,    color: DIFF_COLORS.easy   },
    { key:"medium",  label:"Medium",  count: counts.medium,  color: DIFF_COLORS.medium },
    { key:"hard",    label:"Hard",    count: counts.hard,    color: DIFF_COLORS.hard   },
    { key:"unrated", label:"Unrated", count: counts.unrated  },
  ];

  const filtered = ALL_QUESTIONS.filter(q => {
    if (tab === "unrated" && difficulties[q.id]) return false;
    if (tab !== "all" && tab !== "unrated" && difficulties[q.id] !== tab) return false;
    if (filterSection !== "all" && q.s !== filterSection) return false;
    if (filterLvl !== "all" && q.lvl !== filterLvl) return false;
    if (search) {
      const s = search.toLowerCase();
      return q.de.toLowerCase().includes(s) || q.en.toLowerCase().includes(s);
    }
    return true;
  });

  const activeTab = TABS.find(t => t.key === tab);

  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title="Browse questions" />

      {/* Difficulty tab strip */}
      <div style={{ display:"flex", gap:0, marginBottom:"1rem", borderRadius:"var(--border-radius-lg)", overflow:"hidden", border:"0.5px solid var(--color-border-tertiary)" }}>
        {TABS.map((t, i) => {
          const active = tab === t.key;
          const c = t.color;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex:1, padding:"8px 4px", cursor:"pointer", border:"none",
                borderRight: i < TABS.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none",
                background: active && c ? c.bg : active ? "var(--color-background-info)" : "var(--color-background-secondary)",
                color: active && c ? c.text : active ? "var(--color-text-info)" : "var(--color-text-secondary)",
                fontWeight: active ? 500 : 400 }}>
              <div style={{ fontSize:15, fontWeight:500 }}>{t.count}</div>
              <div style={{ fontSize:10, marginTop:1 }}>{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* Search + section filter */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:"1rem" }}>
        <input type="text" placeholder="Search questions..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize:13, padding:"8px 12px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)", width:"100%" }}
        />
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[["all","All sections"], ...SECTION_NAMES.map(s => [s, secName(s)])].map(([k,l]) => {
            const active = filterSection===k, n = secNum(k);
            const accent = n ? `var(--sec-${n}-bd)` : "var(--color-border-info)";
            return (
              <button key={k} onClick={() => setFilterSection(k)}
                style={{ ...S.btn, fontSize:11, padding:"3px 10px", display:"inline-flex", alignItems:"center", gap:5,
                  background: active ? (n ? `var(--sec-${n}-bg)` : "var(--color-background-info)") : "var(--color-background-secondary)",
                  color:      active ? (n ? `var(--sec-${n})`    : "var(--color-text-info)")       : "var(--color-text-secondary)",
                  border:     active ? `1px solid ${accent}` : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: active ? 500 : 400 }}>
                {n > 0 && <span style={{ width:6, height:6, borderRadius:"50%", background:accent, flexShrink:0 }}/>}
                {l}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[["all","All levels"],["bund","Federal"],["kanton","Cantonal"],["gemeinde","Municipal"]].map(([k,l]) => {
            const active = filterLvl===k, isLvl = k !== "all";
            return (
              <button key={k} onClick={() => setFilterLvl(k)}
                style={{ ...S.btn, fontSize:11, padding:"3px 10px",
                  background: active ? (isLvl ? `var(--lvl-${k}-bg)` : "var(--color-background-info)") : "var(--color-background-secondary)",
                  color:      active ? (isLvl ? `var(--lvl-${k})`    : "var(--color-text-info)")       : "var(--color-text-secondary)",
                  border:     active ? `1px solid ${isLvl ? `var(--lvl-${k}-bd)` : "var(--color-border-info)"}` : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: active ? 500 : 400 }}>
                {l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result count */}
      <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:8 }}>
        {filtered.length} question{filtered.length !== 1 ? "s" : ""}
        {activeTab && tab !== "all" ? ` · ${activeTab.label}` : ""}
        {filterSection !== "all" ? ` · ${filterSection.split("·")[1]?.trim()}` : ""}
        {filterLvl !== "all" ? ` · ${LVL_LABELS[filterLvl]}` : ""}
        {search ? ` · "${search}"` : ""}
      </div>

      <QuestionList questions={filtered} difficulties={difficulties} onDiffChange={onDiffChange} answersHidden />
    </div>
  );
}

// ── Help & about screen ───────────────────────────────────────────────────────
const HELP_SECTIONS = [
  { t: "About this app", b: ["A study tool for the Zürich Grundkenntnistest — the basic-knowledge test for naturalisation. All " + ALL_QUESTIONS.length + " questions come from the canton's official catalogue, grouped into 5 sections and tagged Federal / Cantonal / Municipal."] },
  { t: "The real test", b: ["50 questions in 60 minutes; you pass at 60% (30 correct). The mix is roughly 70% federal, 20% cantonal, 10% municipal."] },
  { t: "Answering questions", b: ["Tap an option to select it, then press Submit to confirm — only then is it marked right or wrong. Use Back / Next to move around; your answers are kept. Options are shuffled each time, so you learn the content rather than the position. Rate each question Easy / Medium / Hard to organise your study."] },
  { t: "Quick test", b: ["Build a short set: Random mix, Exam mix (the real 70/20/10 split), or focus on your Easy / Medium / Hard rated questions — and choose how many."] },
  { t: "Section test", b: ["Practise a single section, and pick how many questions you want from it."] },
  { t: "Mock exam", b: ["A full timed simulation: 50 questions, a 60-minute countdown, no feedback until the end — then a pass/fail verdict and a review of what you missed."] },
  { t: "Smart review (spaced repetition)", b: ["Each question moves through 5 mastery boxes with growing review intervals (1, 3, 7, 30 days). Answer wrong and it comes back soon; answer right and it's scheduled further out as it climbs toward mastered. Smart review drills whatever is due, most overdue first."] },
  { t: "History & progress", b: ["Your past sessions plus accuracy broken down by section and by level, so you can see exactly where to focus."] },
  { t: "Browse questions", b: ["Read the whole catalogue, filter by difficulty / section / level, search the text, and reveal the correct answer for any question."] },
  { t: "Explanations", b: ["Every question has a short explanation (German + English) of why the answer is correct, with a link to an external source for more depth. Explanations are off by default during quizzes (so they don't spoil the test) — flip the “💡 Explain” switch to show them — and are always available in Browse and in review screens."] },
  { t: "Display & language", b: ["English translations can be shown for the question only, or for the question and every option. Text size (A / A / A / A) scales the whole app for easier reading on phones. High-contrast mode boosts legibility; dark mode follows your device setting. The five question classes (sections) are colour-coded throughout — Democracy & Federalism (blue), Welfare State & Civil Society (teal), History (orange), Geography (green), Culture & Everyday Life (violet)."] },
  { t: "Keyboard shortcuts", b: [["1 – 4", "choose an option"], ["Enter / Space / →", "submit, then go to next"], ["←", "previous question"]] },
  { t: "Your data", b: ["Difficulty ratings, history and progress are stored only in this browser — nothing is uploaded. Clearing your browser data resets them."] },
  { t: "Image credits", b: [
    "Matterhorn photo: “Zermatt photos” via Wikimedia Commons, CC BY-SA 3.0.",
    "Avenches amphitheatre photo: Nursangaion via Wikimedia Commons, CC BY-SA 4.0.",
    "Canton maps: adapted (recoloured) from “Suisse cantons.svg” by Pymouss44, Wikimedia Commons, CC BY-SA 4.0.",
    "Flag and coat-of-arms options (Swiss-flag and Zürich-arms questions) are simple SVGs drawn for this app to match the images in the official catalogue.",
    "Federal-Councillor portraits (Q241) via Wikimedia Commons: Ruth Dreifuss — Chatham House, CC BY 2.0; Elisabeth Kopp — Coralie Wenger, CC BY 3.0; Ruth Metzler-Arnold — Manuel Stettler, CC BY-SA 4.0; Micheline Calmy-Rey — IAEA Imagebank, CC BY-SA 2.0.",
    "Flag graphics are simplified illustrations made for this app.",
  ] },
];

// Settings & display options, reached from the gear icon on the home screen.
function SettingsScreen({ enMode, setEnMode, contrast, setContrast, showExpl, setShowExpl, onHome }) {
  const row = { display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" };
  const hint = { fontWeight:400, color:"var(--color-text-tertiary)", fontSize:11, marginLeft:6 };
  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title="Settings" />
      <div style={{ ...S.card, padding:"0.85rem 1.25rem", display:"flex", flexDirection:"column", gap:16 }}>
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>English translations<span style={hint}>shown in every test</span></div>
          <EnToggle enMode={enMode} setEnMode={setEnMode} />
        </div>
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>High contrast<span style={hint}>stronger colours &amp; borders</span></div>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {[["normal","Off"],["high","On"]].map(([v,l]) => (
              <button key={v} onClick={() => setContrast(v)}
                style={{ fontSize:11, padding:"3px 12px", borderRadius:99, cursor:"pointer",
                  background: contrast===v ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  color: contrast===v ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: contrast===v ? "1px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: contrast===v ? 500 : 400 }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>Explanations<span style={hint}>off during tests · always in Browse &amp; review</span></div>
          <Switch on={showExpl} onChange={setShowExpl} label={showExpl ? "On in quiz" : "Off in quiz"} />
        </div>
      </div>
      <div style={{ fontSize:12, color:"var(--color-text-tertiary)", margin:"8px 2px" }}>
        Text size: use the <b style={{ fontWeight:500 }}>A / A</b> buttons in the bottom-right corner — it scales the whole app and applies on every screen.
      </div>
    </div>
  );
}

function HelpScreen({ onHome }) {
  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title="Help & about" />
      <div style={{ ...S.card, border:"1px solid var(--color-border-info)" }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:".5rem" }}>Official information (Kanton Zürich)</div>
        <p style={{ fontSize:13, color:"var(--color-text-secondary)", lineHeight:1.5, margin:"0 0 8px" }}>
          This is an unofficial study aid. The authoritative questions, the canton's own digital practice test and the current rules are published by the Canton of Zürich — always check there for the latest version:
        </p>
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {[
            ["Grundkenntnistest — official info, catalogue & practice test", "https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html"],
            ["Einbürgerung (naturalisation) — overview", "https://www.zh.ch/de/migration-integration/einbuergerung.html"],
            ["Information brochure (PDF)", "https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/migration-integration/einbuergerung/gkt/broschuere_einbuergerung_grundkenntnistest.pdf"],
          ].map(([label, url]) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:13, color:"var(--color-text-info)", textDecoration:"underline", lineHeight:1.4 }}>↗ {label}</a>
          ))}
        </div>
      </div>
      {HELP_SECTIONS.map(sec => (
        <div key={sec.t} style={S.card}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:".5rem" }}>{sec.t}</div>
          {sec.b.map((line, i) => Array.isArray(line) ? (
            <div key={i} style={{ display:"flex", gap:10, fontSize:13, color:"var(--color-text-secondary)", padding:"2px 0" }}>
              <span style={{ ...S.badge, flexShrink:0 }}>{line[0]}</span>
              <span style={{ lineHeight:1.5 }}>{line[1]}</span>
            </div>
          ) : (
            <p key={i} style={{ fontSize:13, color:"var(--color-text-secondary)", lineHeight:1.5, margin:0 }}>{line}</p>
          ))}
        </div>
      ))}
      <div style={{ fontSize:11, color:"var(--color-text-tertiary)", textAlign:"center", margin:"4px 0 8px" }}>
        Questions sourced from the official Kanton Zürich Grundkenntnistest catalogue.
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [difficulties, setDifficulties] = useState(loadDifficulties);
  const [history,      setHistory]      = useState(loadHistory);
  const [progress,     setProgress]     = useState(loadProgress);  // { [id]: {seen,correct,box} } — dashboard + spaced repetition
  const [resume,       setResume]       = useState(loadResume);     // in-progress quiz/exam snapshot, or null
  const [screen,       setScreen]       = useState("home"); // home | quiz | exam | history | browser
  const [pool,         setPool]         = useState(null);
  const [quizLabel,    setQuizLabel]    = useState("");
  const [enMode,       setEnMode]       = useState("question"); // 'none' | 'question' | 'full' — set on Home, used in Quiz
  const [contrast,     setContrast]     = useState(loadContrast); // "normal" | "high"
  const [showExpl,     setShowExpl]     = useState(loadExpl);    // show explanations during quiz (off by default; always on in browse/review)
  const [textSize,     setTextSize]     = useState(loadTextSize); // "s" | "m" | "l" | "xl" — global zoom for readability

  useEffect(() => { try { localStorage.setItem(EXPL_KEY, showExpl ? "on" : "off"); } catch {} }, [showExpl]);
  // Apply (and persist) the text size by zooming the whole app — scales text and layout proportionally
  useEffect(() => {
    document.documentElement.style.zoom = String(TEXT_SIZES[textSize] || 1);
    try { localStorage.setItem(SIZE_KEY, textSize); } catch {}
  }, [textSize]);

  // Apply (and persist) the high-contrast theme via a document attribute that index.css overrides
  useEffect(() => {
    const root = document.documentElement;
    if (contrast === "high") root.setAttribute("data-contrast", "high");
    else root.removeAttribute("data-contrast");
    try { localStorage.setItem(CONTRAST_KEY, contrast); } catch {}
  }, [contrast]);

  const setDiff = useCallback((id, diff) => {
    setDifficulties(prev => {
      const next = { ...prev };
      if (diff === null) delete next[id]; else next[id] = diff;
      saveDifficulties(next);
      return next;
    });
  }, []);

  const resetDifficulties = useCallback(() => {
    setDifficulties({});
    try { localStorage.removeItem(DIFF_KEY); } catch {}
  }, []);

  // Persist (snap) or clear (null) the in-progress quiz/exam snapshot
  const persistResume = useCallback((snap) => {
    if (snap) { saveResume(snap); setResume(snap); }
    else { clearResume(); setResume(null); }
  }, []);

  // Fold a finished session's per-question results into the spaced-repetition / dashboard progress map
  const recordResults = useCallback((results) => {
    if (!results || !results.length) return;
    setProgress(prev => { const next = applyResults(prev, results, Date.now()); saveProgress(next); return next; });
  }, []);

  // Begin a fresh session — discards any prior in-progress snapshot
  const startNew = useCallback((newPool, label, scr) => {
    clearResume(); setResume(null);
    setPool(newPool); setQuizLabel(label); setScreen(scr);
  }, []);

  const startQuiz = useCallback((sectionSel, levelSel, order, count) => {
    const base = ALL_QUESTIONS.filter(q =>
      (sectionSel === "all" || q.s === sectionSel) &&
      (levelSel === "all" || q.lvl === levelSel));
    let p = order === "sequential" ? [...base] : shuffle(base);
    if (count) p = p.slice(0, count);
    const secPart = sectionSel === "all" ? "All sections" : sectionSel;
    const lvlPart = levelSel === "all" ? "" : ` · ${LVL_LABELS[levelSel]}`;
    startNew(p, `${secPart}${lvlPart} · ${p.length} questions (${order})`, "quiz");
  }, [startNew]);

  const startQuickTest = useCallback((diff, count) => {
    const p = diff === 'exam' ? buildExamMixPool(count) : buildQuickTestPool(difficulties, diff, count);
    const label = diff === 'random' ? `Quick test · Random mix · ${count} questions`
      : diff === 'exam' ? `Exam mix · ${count} questions`
      : `Quick test · ${DIFF_LABELS[diff]} · ${count} questions`;
    startNew(p, label, "quiz");
  }, [difficulties, startNew]);

  const startMockExam = useCallback(() => {
    startNew(buildExamMixPool(EXAM_COUNT), `Mock exam · ${EXAM_COUNT} questions`, "exam");
  }, [startNew]);

  // Start from explicit question ids (retry-wrong / smart review), preserving order
  const startQuizFromIds = useCallback((ids, label) => {
    if (!ids || !ids.length) return;
    startNew(poolFromIds(ids), label, "quiz");
  }, [startNew]);

  const handleSaveHistory = useCallback((entry) => {
    setHistory(prev => { const next = [entry, ...prev]; saveHistory(next); return next; });
  }, []);

  const goHome = useCallback(() => { setScreen("home"); setPool(null); }, []); // keeps resume snapshot so Home can offer to continue

  // Resume the saved in-progress session, rebuilding the pool in its original order
  const resumeSession = useCallback(() => {
    if (!resume) return;
    setPool(poolFromIds(resume.ids, false));
    setQuizLabel(resume.label || "Resumed session");
    setScreen(resume.kind === "exam" ? "exam" : "quiz");
  }, [resume]);

  const dueIds = useMemo(() => dueForReview(progress, Date.now()), [progress]);

  const view = (() => {
  if (screen === "quiz" && pool) {
    return <QuizScreen pool={pool} difficulties={difficulties} label={quizLabel}
      enMode={enMode} setEnMode={setEnMode} showExpl={showExpl} setShowExpl={setShowExpl}
      resume={resume && resume.kind === "quiz" ? resume : null}
      onDiffChange={setDiff} onHome={goHome} onSaveHistory={handleSaveHistory}
      onRetryWrong={(ids) => startQuizFromIds(ids, `Retry wrong · ${ids.length} questions`)}
      onRecordResults={recordResults} onPersist={persistResume} />;
  }
  if (screen === "exam" && pool) {
    return <ExamScreen pool={pool} difficulties={difficulties} label={quizLabel}
      enMode={enMode} setEnMode={setEnMode} resume={resume && resume.kind === "exam" ? resume : null}
      onDiffChange={setDiff} onHome={goHome} onSaveHistory={handleSaveHistory}
      onRetryWrong={(ids) => startQuizFromIds(ids, `Retry wrong · ${ids.length} questions`)}
      onRecordResults={recordResults} onPersist={persistResume} />;
  }
  if (screen === "history") {
    return <HistoryScreen history={history} progress={progress} onHome={goHome}
      onClear={() => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} }} />;
  }
  if (screen === "browser") {
    return <BrowserScreen difficulties={difficulties} onDiffChange={setDiff} onHome={goHome} />;
  }
  if (screen === "help") {
    return <HelpScreen onHome={goHome} />;
  }
  if (screen === "settings") {
    return <SettingsScreen enMode={enMode} setEnMode={setEnMode} contrast={contrast} setContrast={setContrast}
      showExpl={showExpl} setShowExpl={setShowExpl} onHome={goHome} />;
  }

  return (
    <HomeScreen
      difficulties={difficulties}
      history={history}
      progress={progress}
      dueCount={dueIds.length}
      resume={resume}
      onResume={resumeSession}
      onStart={startQuiz}
      onQuickTest={startQuickTest}
      onMockExam={startMockExam}
      onHistory={() => setScreen("history")}
      onBrowser={() => setScreen("browser")}
      onHelp={() => setScreen("help")}
      onSettings={() => setScreen("settings")}
      onResetRatings={resetDifficulties}
      onSmartReview={() => startQuizFromIds(dueIds, `Smart review · ${dueIds.length} questions`)}
    />
  );
  })();
  return <>{view}<ZurichFlag /><ZoomControl textSize={textSize} setTextSize={setTextSize} /></>;
}

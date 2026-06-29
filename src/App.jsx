import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { ALL_QUESTIONS } from "./questions";
import { Q_IMAGES } from "./images";
import { EXPLANATIONS } from "./explanations";
import { LANG_KEY, LANGS, PRIMARY_LANGS, OTHER_LABEL, MORE_LANGS_LABEL, HAS_TRANSLATION, UI, SECTION_NAMES as SECTION_I18N, LVL_LABELS_I18N, HELP_SECTIONS_BY_LANG, HELP_OFFICIAL } from "./i18n";
import { FR_CONTENT } from "./fr";
import { IT_CONTENT } from "./it";
import { PT_CONTENT } from "./pt";
import { SQ_CONTENT } from "./sq";
import { ES_CONTENT } from "./es";

const SECTION_NAMES = [...new Set(ALL_QUESTIONS.map(q => q.s))];
const LETTERS = ["a","b","c","d"];
// Five question-class (section) colours — keyed by the leading number of q.s ("1 · …")
const secNum = (s) => { const m = /^(\d)/.exec(s || ""); return m ? +m[1] : 0; };
const secName = (s, lang) => {
  const map = SECTION_I18N[lang];
  if (map) { const n = secNum(s); if (map[n]) return map[n]; }
  return s ? (s.split("·")[1] || s).trim() : s;
};
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

// ── i18n plumbing ───────────────────────────────────────────────────────────────
// German (q.de) is always shown. The *secondary* translation column + all UI chrome
// follow the selected language; English is the base/fallback. UI_FR maps English→French.
const LangContext = createContext("en");
const useLang = () => useContext(LangContext);
function tr(lang, s, vars) {
  const map = UI[lang];
  let out = (map && map[s] != null) ? map[s] : s;
  if (vars) for (const k in vars) out = out.split("{" + k + "}").join(vars[k]);
  return out;
}
const useT = () => { const lang = useLang(); return useCallback((s, vars) => tr(lang, s, vars), [lang]); };
function loadLang() { try { const v = localStorage.getItem(LANG_KEY); return LANGS[v] ? v : "en"; } catch { return "en"; } }
// Translated question content per language (English is q.en directly; German has none — see below).
const CONTENT = { fr: FR_CONTENT, it: IT_CONTENT, pt: PT_CONTENT, sq: SQ_CONTENT, es: ES_CONTENT };
// Secondary-translation lookups. German is the primary test content, so it has no secondary line
// (returns null → display sites and their toggles hide). Other languages use their translated
// content, falling back to the English baseline when an entry is missing.
const qText  = (q, lang)     => { if (!HAS_TRANSLATION[lang]) return null; const c = CONTENT[lang]; return (c && c.q[q.id] && c.q[q.id].q) || q.en; };
const oText  = (q, oi, lang) => { if (!HAS_TRANSLATION[lang]) return null; const c = CONTENT[lang]; return (c && c.q[q.id] && c.q[q.id].o && c.q[q.id].o[oi]) || (q.opts[oi] && q.opts[oi].en); };
const xText  = (id, lang)    => { if (!HAS_TRANSLATION[lang]) return null; const c = CONTENT[lang]; return (c && c.expl[id]) || (EXPLANATIONS[id] && EXPLANATIONS[id].en); };
const lvlLabel = (k, lang)   => (LVL_LABELS_I18N[lang] && LVL_LABELS_I18N[lang][k]) || LVL_LABELS[k];
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
  const T = useT();
  const sz = small ? 10 : 11;
  if (!diff) return <span style={{ ...S.badge, fontSize:sz }}>{T("Unrated")}</span>;
  const c = DIFF_COLORS[diff];
  return <span style={{ padding: small?"1px 6px":"2px 9px", borderRadius:99, fontSize:sz, background:c.bg, color:c.text, border:`0.5px solid ${c.border}`, fontWeight:500 }}>{T(DIFF_LABELS[diff])}</span>;
}

function LvlBadge({ lvl, small }) {
  const lang = useLang();
  if (!lvl || !LVL_LABELS[lvl]) return null;
  return <span style={{ fontSize: small ? 10 : 11, fontWeight:500, padding: small ? "1px 7px" : "2px 9px", borderRadius:99, whiteSpace:"nowrap",
    background:`var(--lvl-${lvl}-bg)`, color:`var(--lvl-${lvl})`, border:`0.5px solid var(--lvl-${lvl}-bd)` }}>{lvlLabel(lvl, lang)}</span>;
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
  const T = useT();
  const [speaking, setSpeaking] = useState(false);
  // Stop any audio and reset the toggle whenever the spoken text changes (navigating questions)
  // or the button unmounts (leaving the page). The component persists across Back/Next, so a
  // text-keyed effect — not just an unmount cleanup — is needed to catch in-quiz navigation.
  useEffect(() => { setSpeaking(false); return () => stopSpeak(); }, [text]);
  if (!TTS_OK) return null;
  const toggle = (e) => {
    e.stopPropagation();
    if (speaking) { stopSpeak(); setSpeaking(false); }
    else { setSpeaking(true); speakDE(text, () => setSpeaking(false)); }
  };
  return (
    <button type="button" aria-pressed={speaking}
      aria-label={speaking ? T("Stop reading") : T("Read aloud in German")} title={speaking ? T("Stop reading") : T("Read aloud in German")}
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
// Persistent top bar (in-flow, at the top of the column on every screen): a language dropdown,
// the settings gear, and the Canton-Zürich flag (opens Help). Always visible, so language can be
// switched from anywhere.
function TopBar({ lang, setLang, onSettings, onHelp }) {
  const T = useT();
  const iconBtn = { display:"flex", alignItems:"center", justifyContent:"center", width:34, height:32, padding:0,
    background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-secondary)",
    borderRadius:"var(--border-radius-md)", color:"var(--color-text-secondary)", cursor:"pointer" };
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8, padding:"10px 1rem 0" }}>
      <select value={lang} onChange={(e) => { const v = e.target.value; if (v === "__other__") onSettings(); else setLang(v); }}
        aria-label={T("Language")} title={T("Language")}
        style={{ height:32, padding:"0 28px 0 10px", fontSize:13, borderRadius:"var(--border-radius-md)",
          border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)",
          color:"var(--color-text-primary)", cursor:"pointer", font:"inherit", appearance:"none", WebkitAppearance:"none",
          backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23999' stroke-width='1.5'/%3E%3C/svg%3E\")",
          backgroundRepeat:"no-repeat", backgroundPosition:"right 10px center" }}>
        {!PRIMARY_LANGS.includes(lang) && <option value={lang}>{lang.toUpperCase()}</option>}
        {PRIMARY_LANGS.map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}
        <option value="__other__">{OTHER_LABEL[lang] || OTHER_LABEL.en}</option>
      </select>
      <button type="button" onClick={onSettings} aria-label={T("Settings")} title={T("Settings & display options")} style={iconBtn}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button type="button" onClick={onHelp} aria-label={T("Help & about")} title={T("Help & about (Kanton Zürich)")}
        style={{ ...iconBtn, overflow:"hidden" }}>
        <svg viewBox="0 0 32 32" width="20" height="20" style={{ display:"block", borderRadius:3 }} aria-hidden="true">
          <rect width="32" height="32" fill="#ffffff"/>
          <path d="M0,0 L0,32 L32,32 Z" fill="#1668b3"/>
        </svg>
      </button>
    </div>
  );
}

// Floating text-size control (bottom-right) — smaller / larger, like reader apps.
function ZoomControl({ textSize, setTextSize }) {
  const T = useT();
  const order = ["s", "m", "l", "xl"];
  const i = order.indexOf(textSize);
  const set = (j) => setTextSize(order[Math.min(order.length - 1, Math.max(0, j))]);
  const btn = (size, disabled) => ({ background:"none", border:"none", lineHeight:1, padding:"6px 12px", fontWeight:600, fontSize:size, color:"var(--color-text-secondary)", opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer" });
  return (
    <div role="group" aria-label={T("Text size")} style={{ position:"fixed", bottom:12, right:12, zIndex:50, display:"flex", alignItems:"center",
      background:"var(--color-background-primary)", border:"1px solid var(--color-border-secondary)", borderRadius:99, boxShadow:"0 2px 10px rgba(0,0,0,0.28)" }}>
      <button onClick={() => set(i - 1)} disabled={i <= 0} aria-label={T("Smaller text")} title={T("Smaller text")} style={btn(12, i <= 0)}>A</button>
      <div style={{ width:1, height:18, background:"var(--color-border-tertiary)" }}/>
      <button onClick={() => set(i + 1)} disabled={i >= order.length - 1} aria-label={T("Larger text")} title={T("Larger text")} style={btn(19, i >= order.length - 1)}>A</button>
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
  const lang = useLang();
  const n = secNum(s);
  if (!n) return <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{s}</span>;
  return (
    <span title={s} style={{ display:"inline-flex", alignItems:"center", gap:5, flexShrink:0,
      fontSize: small ? 10 : 11, fontWeight:500, padding: small ? "1px 7px" : "2px 9px", borderRadius:99,
      background:`var(--sec-${n}-bg)`, color:`var(--sec-${n})`, border:`0.5px solid var(--sec-${n}-bd)` }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:`var(--sec-${n}-bd)`, flexShrink:0 }}/>
      {secName(s, lang)}
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
  const T = useT();
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>{T("Rate:")}</span>
      {["easy","medium","hard"].map(d => {
        const c = DIFF_COLORS[d]; const active = current === d;
        return (
          <button key={d} onClick={() => onChange(active ? null : d)}
            style={{ fontSize:12, padding:"3px 12px", borderRadius:99, cursor:"pointer",
              background: active ? c.bg : "var(--color-background-secondary)",
              color: active ? c.text : "var(--color-text-secondary)",
              border: active ? `1.5px solid ${c.border}` : "0.5px solid var(--color-border-tertiary)",
              fontWeight: active ? 500 : 400 }}>
            {T(DIFF_LABELS[d])}
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
  const T = useT();
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"1rem", flexWrap:"wrap" }}>
      <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>{T("← Home")}</button>
      <span style={{ fontSize:15, fontWeight:500, flex:1 }}>{title}</span>
      {right}
    </div>
  );
}

// Translation display toggle (none / question only / question + options) — shared by Settings and Quiz.
// The prefix shows the active language code (EN / FR); pass prefix={null} to hide it.
function EnToggle({ enMode, setEnMode, prefix }) {
  const T = useT(); const lang = useLang();
  const code = prefix === null ? null : (prefix || lang.toUpperCase());
  return (
    <div style={{ display:"flex", gap:4, alignItems:"center" }}>
      {code && <span style={{ fontSize:11, color:"var(--color-text-tertiary)", marginRight:2 }}>{code}:</span>}
      {[["none","Off"],["question","Question"],["full","Full"]].map(([v,l]) => (
        <button key={v} onClick={() => setEnMode(v)}
          style={{ fontSize:11, padding:"3px 8px", borderRadius:99, cursor:"pointer",
            background: enMode===v ? "var(--color-background-info)" : "var(--color-background-secondary)",
            color: enMode===v ? "var(--color-text-info)" : "var(--color-text-secondary)",
            border: enMode===v ? "1px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
            fontWeight: enMode===v ? 500 : 400 }}>
          {T(l)}
        </button>
      ))}
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────
function HomeScreen({ difficulties, history, progress, dueCount, resume, onResume, onDiscardResume, onStart, onQuickTest, onMockExam, onHistory, onBrowser, onHelp, onSettings, onResetRatings, onSmartReview }) {
  const T = useT(); const lang = useLang();
  const counts = countByDiff(difficulties);
  const [qtDiff, setQtDiff]   = useState("exam");
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
  const fqLabel = `${fqCount} ${fqCount === 1 ? T("question") : T("questions")} · ${fqSection === "all" ? T("all sections") : secName(fqSection, lang)} · ${fqLevel === "all" ? T("all levels") : lvlLabel(fqLevel, lang)} · ${T(fqOrder)}`;
  const pct = Math.round(((ALL_QUESTIONS.length - counts.unrated) / ALL_QUESTIONS.length) * 100);
  const lastSession = history[0];
  // Weakest attempted section, for a quick study nudge (needs a few answers to be meaningful)
  const weakest = Object.entries(statsBy(progress, q => q.s))
    .filter(([, a]) => a.seen >= 3)
    .map(([s, a]) => ({ s, acc: Math.round(a.correct / a.seen * 100) }))
    .sort((a, b) => a.acc - b.acc)[0];

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ marginBottom:"1.25rem" }}>
        <h2 style={{ fontSize:18, fontWeight:500, margin:"0 0 4px" }}>Zürich Grundkenntnistest</h2>
        <p style={{ fontSize:13, color:"var(--color-text-secondary)", margin:0 }}>{ALL_QUESTIONS.length} {T("questions")} · 5 {T("sections")}</p>
      </div>

      {/* Resume an unfinished session */}
      {resume && (
        <div style={{ ...S.card, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", padding:"0.85rem 1.25rem", border:"1px solid var(--color-border-warning)", background:"var(--color-background-warning)" }}>
          <div style={{ fontSize:13, color:"var(--color-text-warning)" }}>
            {T("⏸ Unfinished {kind} — question {a} of {b}", { kind: resume.kind === "exam" ? T("mock exam") : T("quiz"), a: (resume.idx ?? 0) + 1, b: resume.ids.length })}
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <button style={{ ...S.btn, color:"var(--color-text-warning)", borderColor:"var(--color-border-warning)" }}
              onClick={onDiscardResume} title={T("Discard unfinished test")}>{T("Discard")}</button>
            <button style={S.btnPrim} onClick={onResume}>{T("Resume →")}</button>
          </div>
        </div>
      )}

      {/* Mock exam — the real-test simulation */}
      <div style={{ ...S.card, border:"1px solid var(--color-border-info)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600 }}>🎓 {T("Mock exam")}</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:3 }}>
              {T("{n} questions · {m} min · pass at {p}% · exam mix, no feedback until the end", { n: EXAM_COUNT, m: EXAM_MINUTES, p: EXAM_PASS_PCT })}
            </div>
          </div>
          <button style={S.btnPrim} onClick={onMockExam}>{T("Start mock exam →")}</button>
        </div>
      </div>

      {/* Quick test */}
      <div style={S.card}>
        <div style={{ fontSize:13, fontWeight:500, marginBottom:".75rem" }}>{T("Quick test")}</div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-start", marginBottom:".75rem" }}>
          <div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("Focus on")}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={() => setQtDiff("exam")}
                style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                  background: qtDiff==="exam" ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  color: qtDiff==="exam" ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: qtDiff==="exam" ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: qtDiff==="exam" ? 500 : 400 }}>
                {T("Exam mix")}
              </button>
              <button onClick={() => setQtDiff("random")}
                style={{ fontSize:12, padding:"4px 12px", borderRadius:99, cursor:"pointer",
                  background: qtDiff==="random" ? "var(--color-background-info)" : "var(--color-background-secondary)",
                  color: qtDiff==="random" ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: qtDiff==="random" ? "1.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: qtDiff==="random" ? 500 : 400 }}>
                {T("Random mix")}
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
                    {T(DIFF_LABELS[d])} ({counts[d]})
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("Questions")}</div>
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
            {T("Only {n} {d} questions rated — {k} will be filled with unrated questions.", { n: counts[qtDiff], d: T(DIFF_LABELS[qtDiff]), k: qtCount - counts[qtDiff] })}
          </div>
        )}
        {qtDiff === "random" && (
          <div style={{ fontSize:12, color:"var(--color-text-info)", marginBottom:".5rem", background:"var(--color-background-info)", padding:"6px 10px", borderRadius:"var(--border-radius-md)" }}>
            {T("Random mix — questions drawn from all {n} regardless of difficulty rating.", { n: ALL_QUESTIONS.length })}
          </div>
        )}
        {qtDiff === "exam" && (
          <div style={{ fontSize:12, color:"var(--color-text-info)", marginBottom:".5rem", background:"var(--color-background-info)", padding:"6px 10px", borderRadius:"var(--border-radius-md)" }}>
            {T("Exam mix — drawn ~70% federal / 20% cantonal / 10% municipal, like the real test (50 questions → 35 / 10 / 5).")}
          </div>
        )}
        <button style={S.btnPrim} onClick={() => onQuickTest(qtDiff, qtCount)}>{T("Start quick test →")}</button>
      </div>

      {/* Full quiz — combine Section + Level + count + order, then press Start */}
      <div style={S.card}>
        <div style={{ fontSize:13, fontWeight:500, marginBottom:".75rem" }}>{T("Full quiz")}</div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("Section")}</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          <button onClick={() => setFqSection("all")} style={pill(fqSection==="all")}>{T("All sections")}</button>
          {SECTION_NAMES.map((s,i) => {
            const active = fqSection===s, n = secNum(s);
            return (
              <button key={i} onClick={() => setFqSection(s)}
                style={{ ...pill(active), display:"inline-flex", alignItems:"center", gap:6,
                  background: active ? `var(--sec-${n}-bg)` : "var(--color-background-secondary)",
                  color:      active ? `var(--sec-${n})`    : "var(--color-text-secondary)",
                  border:     active ? `1.5px solid var(--sec-${n}-bd)` : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:`var(--sec-${n}-bd)`, flexShrink:0 }}/>
                {secName(s, lang)}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("Level")}</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          <button onClick={() => setFqLevel("all")} style={pill(fqLevel==="all")}>{T("All levels")}</button>
          {["bund","kanton","gemeinde"].map(k => {
            const active = fqLevel===k;
            return (
              <button key={k} onClick={() => setFqLevel(k)}
                style={{ ...pill(active),
                  background: active ? `var(--lvl-${k}-bg)` : "var(--color-background-secondary)",
                  color:      active ? `var(--lvl-${k})`    : "var(--color-text-secondary)",
                  border:     active ? `1.5px solid var(--lvl-${k}-bd)` : "0.5px solid var(--color-border-tertiary)" }}>
                {lvlLabel(k, lang)}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("How many?")}</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".75rem" }}>
          {["all",10,20,30,50].map(n => (
            <button key={n} onClick={() => setSecCount(n)} style={pill(secCount===n)}>{n === "all" ? T("All") : n}</button>
          ))}
        </div>

        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>{T("Order")}</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:".85rem" }}>
          {[["random","Random"],["sequential","Sequential"]].map(([k,l]) => (
            <button key={k} onClick={() => setFqOrder(k)} style={pill(fqOrder===k)}>{T(l)}</button>
          ))}
        </div>

        <div style={{ fontSize:12, color: fqCount ? "var(--color-text-secondary)" : "var(--color-text-danger)", marginBottom:".5rem" }}>
          {fqCount ? <>{T("Selected:")} <b style={{ fontWeight:500 }}>{fqLabel}</b></> : T("No questions match this section + level combination.")}
        </div>
        <button disabled={!fqCount}
          style={{ ...S.btnPrim, opacity: fqCount ? 1 : .45, cursor: fqCount ? "pointer" : "default" }}
          onClick={() => onStart(fqSection, fqLevel, fqOrder, secCount === "all" ? null : secCount)}>
          {T("Start quiz →")}
        </button>
      </div>

      {/* Smart review — only when there are due questions */}
      {dueCount > 0 && (
        <div style={{ ...S.card, border:"1px solid var(--color-border-info)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600 }}>{T("🔁 Smart review")}</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:3 }}>
              {T("{n} question{s} due — spaced repetition resurfaces what you're about to forget.", { n: dueCount, s: dueCount !== 1 ? "s" : "" })}
            </div>
          </div>
          <button style={S.btnPrim} onClick={onSmartReview}>{T("Review {n} →", { n: dueCount })}</button>
        </div>
      )}

      {/* Difficulty ratings — below the tests */}
      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem", gap:8 }}>
          <div style={{ fontSize:13, fontWeight:500 }}>{T("Difficulty ratings")}</div>
          {counts.unrated < ALL_QUESTIONS.length && (
            confirmReset
              ? <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <span style={{ fontSize:11, color:"var(--color-text-danger)", fontWeight:500 }}>{T("Reset all {n} ratings? This can’t be undone.", { n: ALL_QUESTIONS.length - counts.unrated })}</span>
                  <button style={{ ...S.btn, fontSize:11, padding:"2px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)", fontWeight:500 }}
                    onClick={() => { onResetRatings(); setConfirmReset(false); }}>{T("Yes, reset")}</button>
                  <button style={{ ...S.btn, fontSize:11, padding:"2px 8px" }} onClick={() => setConfirmReset(false)}>{T("Cancel")}</button>
                </div>
              : <button style={{ ...S.btn, fontSize:11, padding:"3px 10px" }} onClick={() => setConfirmReset(true)}>{T("Reset ratings")}</button>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:".75rem" }}>
          {[["easy","Easy",counts.easy],["medium","Medium",counts.medium],["hard","Hard",counts.hard],["unrated","Unrated",counts.unrated]].map(([k,l,n]) => {
            const c = k==="unrated" ? null : DIFF_COLORS[k];
            return (
              <div key={k} style={{ padding:".6rem .75rem", borderRadius:"var(--border-radius-md)", background: c ? c.bg : "var(--color-background-secondary)", border:`0.5px solid ${c ? c.border : "var(--color-border-tertiary)"}` }}>
                <div style={{ fontSize:20, fontWeight:500, color: c ? c.text : "var(--color-text-secondary)" }}>{n}</div>
                <div style={{ fontSize:11, color: c ? c.text : "var(--color-text-tertiary)", marginTop:2 }}>{T(l)}</div>
              </div>
            );
          })}
        </div>
        <PctBar pct={pct} />
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:4 }}>{T("{p}% rated · {n} unrated", { p: pct, n: counts.unrated })}</div>
      </div>

      {/* Bottom nav */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", paddingTop:"1rem", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
        <button style={S.btn} onClick={onBrowser}>
          {T("📋 Browse all questions")}
        </button>
        <button style={{ ...S.btn, display:"flex", alignItems:"center", gap:6 }} onClick={onHistory}>
          {T("📊 History & progress")} {history.length > 0 && <span style={{ ...S.badge, fontSize:10 }}>{history.length}</span>}
        </button>
        <button style={S.btn} onClick={onHelp}>{T("❓ Help")}</button>
      </div>
      {weakest && (
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:8 }}>
          {T("Weakest area so far: {s} · {p}% correct", { s: secName(weakest.s, lang), p: weakest.acc })}
        </div>
      )}
      {lastSession && (
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:4 }}>
          {T("Last quiz: {d} · {c}/{t} correct ({p}%)", { d: formatDate(lastSession.ts), c: lastSession.correct, t: lastSession.total, p: Math.round(lastSession.correct/lastSession.total*100) })}
        </div>
      )}
    </div>
  );
}

// Explanation of why the answer is correct, with external source links. Shown once
// the answer is revealed. `en` controls whether the English translation is included.
function Explanation({ id, en }) {
  const T = useT(); const lang = useLang();
  const ex = EXPLANATIONS[id];
  if (!ex) return null;
  const tx = xText(id, lang);
  return (
    <div style={{ marginTop:8, padding:"9px 11px", borderRadius:"var(--border-radius-md)",
      background:"var(--color-background-info)", border:"0.5px solid var(--color-border-info)" }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:.4, textTransform:"uppercase", color:"var(--color-text-info)", marginBottom:3 }}>ℹ Erklärung{(en && tx) ? " · " + T("Explanation") : ""}</div>
      <div style={{ fontSize:12.5, color:"var(--color-text-primary)", lineHeight:1.45 }}>{ex.de}</div>
      {en && tx && <div style={{ fontSize:11.5, color:"var(--color-text-secondary)", fontStyle:"italic", lineHeight:1.45, marginTop:3 }}>{tx}</div>}
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
  const lang = useLang();
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
                {enMode === 'full' && oText(q, oi, lang) && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{oText(q, oi, lang)}</div>}
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
              {enMode === 'full' && oText(q, oi, lang) && <div style={{ fontSize:12, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{oText(q, oi, lang)}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function QuizScreen({ pool, difficulties, label, enMode, setEnMode, showExpl, setShowExpl, resume, onDiffChange, onHome, onSaveHistory, onRetryWrong, onRecordResults, onPersist }) {
  const T = useT(); const lang = useLang();
  const [idx,       setIdx]       = useState(resume?.idx ?? 0);
  const [picks,     setPicks]     = useState(resume?.picks ?? {});      // { [questionIndex]: chosenOptionIndex } — tentative, before submit
  const [submitted, setSubmitted] = useState(resume?.submitted ?? {});  // { [questionIndex]: true } — confirmed/graded; kept so you can navigate back
  const [done,      setDone]      = useState(false);
  const [saved,     setSaved]     = useState(false);

  // Stop any read-aloud audio when the question changes or the quiz screen unmounts
  useEffect(() => stopSpeak, [idx]);

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
    if (idx > 0) { stopSpeak(); setIdx(idx - 1); }
  }, [idx]);
  const goNext = useCallback(() => {
    stopSpeak();
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
          <div style={{ fontSize:14, color:"var(--color-text-secondary)", marginBottom:"1.25rem" }}>{T("{c} correct out of {t} questions", { c: correct, t: total })}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:"1.25rem" }}>
            {[["✓ "+correct,T("Correct"),"var(--color-text-success)"],["✗ "+wrong,T("Wrong"),"var(--color-text-danger)"],[bestStreak,T("Best streak"),"var(--color-text-primary)"]].map(([n,l,c]) => (
              <div key={l} style={{ padding:".75rem", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)" }}>
                <div style={{ fontSize:22, fontWeight:500, color:c }}>{n}</div>
                <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
          {sessionWrong.length > 0 && (
            <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:"1rem", textAlign:"left", background:"var(--color-background-secondary)", padding:"8px 12px", borderRadius:"var(--border-radius-md)" }}>
              <div style={{ fontWeight:500, marginBottom:4 }}>{T("Wrong answers:")}</div>
              Q{sessionWrong.join(", Q")}
            </div>
          )}
          <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
            {sessionWrong.length > 0 && <button style={S.btn} onClick={() => onRetryWrong(sessionWrong)}>{T("↻ Retry wrong ({n})", { n: sessionWrong.length })}</button>}
            <button style={S.btnPrim} onClick={onHome}>{T("← Home")}</button>
          </div>
          <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:12 }}>{T("Result saved to history")}</div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div style={{ padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:".6rem", flexWrap:"wrap", gap:6, paddingRight:28 }}>
        <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>{T("← Home")}</button>
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
        {(enMode === 'question' || enMode === 'full') && qText(q, lang) && <div style={S.qEn}>{qText(q, lang)}</div>}


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
          {T("← Back")}
        </button>
        {submittedCur
          ? <button style={S.btnPrim} onClick={goNext}>{idx + 1 >= pool.length ? T("Finish ✓") : T("Next →")}</button>
          : <button onClick={submit} disabled={!hasPick}
              style={{ ...S.btnPrim, opacity: hasPick ? 1 : .45, cursor: hasPick ? "pointer" : "default" }}>{T("Submit answer")}</button>}
        {!submittedCur && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{hasPick ? T("Submit to confirm · ←/→ to navigate") : T("Pick 1–4, then Submit · ←/→ to navigate")}</span>}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <Switch on={showExpl} onChange={setShowExpl} label={T("💡 Explain")} />
          {HAS_TRANSLATION[lang] && <EnToggle enMode={enMode} setEnMode={setEnMode} />}
        </div>
      </div>
    </div>
  );
}

// ── Mock exam screen ──────────────────────────────────────────────────────────
function ExamScreen({ pool, difficulties, label, enMode, setEnMode, resume, onDiffChange, onHome, onSaveHistory, onRetryWrong, onRecordResults, onPersist }) {
  const T = useT(); const lang = useLang();
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
            {passed ? T("✓ Passed") : T("✗ Not passed")}
          </div>
          <div style={{ fontSize:15, color: passed ? "var(--color-text-success)" : "var(--color-text-danger)", marginTop:4 }}>
            {T("{c}/{t} correct · {p}%", { c: correct, t: total, p: pct })} <span style={{ opacity:.7 }}>({T("pass mark {x}%", { x: EXAM_PASS_PCT })})</span>
          </div>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginTop:8 }}>
            {T("Time used {u} of {m} · {a}/{t} answered", { u: fmt(usedSec), m: `${EXAM_MINUTES}:00`, a: answeredCount, t: total })}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginBottom:"1rem" }}>
          {wrongNums.length > 0 && <button style={S.btn} onClick={() => onRetryWrong(wrongNums)}>{T("↻ Retry wrong ({n})", { n: wrongNums.length })}</button>}
          <button style={S.btnPrim} onClick={onHome}>{T("← Home")}</button>
        </div>
        {wrongQs.length > 0 && (
          <>
            <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-tertiary)", marginBottom:8 }}>{T("Review your {n} wrong answer{s}", { n: wrongQs.length, s: wrongQs.length!==1?"s":"" })}</div>
            <QuestionList questions={wrongQs} difficulties={difficulties} onDiffChange={onDiffChange} />
          </>
        )}
        <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:12, textAlign:"center" }}>{T("Result saved to history")}</div>
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
        <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={onHome}>{T("← Home")}</button>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ ...S.badge, fontVariantNumeric:"tabular-nums", fontWeight:500,
            background: lowTime ? "var(--color-background-danger)" : "var(--color-background-secondary)",
            color: lowTime ? "var(--color-text-danger)" : "var(--color-text-primary)",
            border: `0.5px solid ${lowTime ? "var(--color-border-danger)" : "var(--color-border-tertiary)"}` }}>⏱ {fmt(secondsLeft)}</span>
          <span style={S.badge}>{idx+1}/{pool.length}</span>
          <span style={S.badge}>{T("{n} answered", { n: answeredCount })}</span>
          {confirmEnd
            ? <span style={{ display:"flex", gap:4, alignItems:"center" }}>
                <span style={{ fontSize:11, color:"var(--color-text-danger)" }}>{answeredCount < total ? T("{n} unanswered. End?", { n: total-answeredCount }) : T("End now?")}</span>
                <button style={{ ...S.btn, fontSize:11, padding:"2px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)" }} onClick={() => setDone(true)}>{T("Yes")}</button>
                <button style={{ ...S.btn, fontSize:11, padding:"2px 8px" }} onClick={() => setConfirmEnd(false)}>{T("No")}</button>
              </span>
            : <button style={{ ...S.btn, fontSize:11, padding:"3px 10px" }} onClick={() => setConfirmEnd(true)}>{T("End exam")}</button>}
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
        {(enMode === 'question' || enMode === 'full') && qText(q, lang) && <div style={S.qEn}>{qText(q, lang)}</div>}

        <QImage src={q.img} />
        <OptionList q={q} order={order} enMode={enMode} pickCur={pickCur} reveal={false} disabled={false} onPick={pick} />
      </div>

      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={goPrev} disabled={idx === 0}
          style={{ ...S.btn, opacity: idx === 0 ? .4 : 1, cursor: idx === 0 ? "default" : "pointer" }}>{T("← Back")}</button>
        <button style={S.btnPrim} onClick={goNext}>{idx + 1 >= pool.length ? T("Finish ✓") : T("Next →")}</button>
        {pickCur === undefined && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{T("Pick 1–4 · ←/→ to navigate · answers stay changeable")}</span>}
        {HAS_TRANSLATION[lang] && (
          <div style={{ marginLeft:"auto" }}>
            <EnToggle enMode={enMode} setEnMode={setEnMode} />
          </div>
        )}
      </div>
    </div>
  );
}

// Accuracy bars grouped by some attribute (section / level), weakest first
function AccuracyBreakdown({ title, agg, labelFn }) {
  const T = useT();
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
                <span style={{ color:"var(--color-text-tertiary)", flexShrink:0 }}>{r.acc == null ? T("not attempted yet") : T("{p}% · {m}/{t} mastered", { p: r.acc, m: r.mastered, t: r.total })}</span>
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
  const T = useT(); const lang = useLang();
  const [shown, setShown] = useState({}); // { [index]: true } — which questions currently show the translation
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
                {en && qText(q, lang) && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{qText(q, lang)}</div>}
              </div>
              {qText(q, lang) && (
                <button type="button" onClick={() => setShown(s => ({ ...s, [di]: !s[di] }))}
                  aria-pressed={en} title={T("Show/hide translation")}
                  style={{ ...S.badge, cursor:"pointer", flexShrink:0, fontSize:10, padding:"2px 7px",
                    background: en ? "var(--color-background-info)" : "var(--color-background-secondary)",
                    color: en ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                    border: `0.5px solid ${en ? "var(--color-border-info)" : "var(--color-border-tertiary)"}` }}>
                  {lang.toUpperCase()}
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
                        {en && oText(q, i, lang) && <div style={{ fontSize:10, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{oText(q, i, lang)}</div>}
                        {(isCorrect || isPicked) && <div style={{ fontSize:10, marginTop:1, color: `var(--color-text-${tone})` }}>{isCorrect ? (isPicked ? T("✓ your answer") : T("✓ correct")) : T("✗ your answer")}</div>}
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
                        {en && oText(q, i, lang) && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{oText(q, i, lang)}</div>}
                      </div>
                      <span style={{ marginLeft:"auto", fontSize:10, flexShrink:0, color: tone ? `var(--color-text-${tone})` : "transparent" }}>
                        {isCorrect ? (isPicked ? T("✓ your answer") : T("✓ correct")) : (isPicked ? T("✗ your answer") : "")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {picked == null && <div style={{ fontSize:11, color:"var(--color-text-warning)", marginTop:4 }}>{T("Not answered")}</div>}
            <Explanation id={q.id} en={en} />
          </div>
        );
      })}
    </div>
  );
}

// ── History & progress screen ─────────────────────────────────────────────────
function HistoryScreen({ history, progress, onHome, onClear }) {
  const T = useT(); const lang = useLang();
  const [openDetail, setOpenDetail] = useState(null);
  const [confirm, setConfirm] = useState(false);

  if (history.length === 0) {
    return (
      <div style={{ padding:"1rem" }}>
        <NavBar onHome={onHome} title={T("History & progress")} />
        <div style={{ ...S.card, textAlign:"center", padding:"2rem", color:"var(--color-text-tertiary)", fontSize:14 }}>
          {T("No quiz sessions yet. Complete a quiz to see your history and progress here.")}
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
      <NavBar onHome={onHome} title={T("History & progress")}
        right={
          confirm
            ? <div style={{ display:"flex", gap:6 }}>
                <span style={{ fontSize:12, color:"var(--color-text-danger)" }}>{T("Clear all?")}</span>
                <button style={{ ...S.btn, fontSize:12, padding:"3px 8px", color:"var(--color-text-danger)", borderColor:"var(--color-border-danger)" }} onClick={() => { onClear(); setConfirm(false); }}>{T("Yes")}</button>
                <button style={{ ...S.btn, fontSize:12, padding:"3px 8px" }} onClick={() => setConfirm(false)}>{T("No")}</button>
              </div>
            : <button style={{ ...S.btn, fontSize:12, padding:"4px 10px" }} onClick={() => setConfirm(true)}>{T("Clear history")}</button>
        }
      />

      {/* Summary stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:"1rem" }}>
        {[[totalSessions,T("Sessions")],[totalQs,T("Questions")],[avgPct+"%",T("Avg score")],[bestPct+"%",T("Best score")]].map(([n,l]) => (
          <div key={l} style={{ padding:".6rem .75rem", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize:18, fontWeight:500 }}>{n}</div>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Recent trend */}
      {trend.length > 1 && (
        <div style={{ ...S.card, padding:"1rem" }}>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:8 }}>{T("Recent scores (last {n})", { n: trend.length })}</div>
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
          <AccuracyBreakdown title={T("Accuracy by section")} agg={statsBy(progress, q => q.s)} labelFn={s => (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:`var(--sec-${secNum(s)}-bd)`, flexShrink:0 }}/>{secName(s, lang)}
            </span>
          )} />
          <AccuracyBreakdown title={T("Accuracy by level")}   agg={statsBy(progress, q => q.lvl)} labelFn={l => (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:`var(--lvl-${l}-bd)`, flexShrink:0 }}/>{lvlLabel(l, lang) || l}
            </span>
          )} />
        </>
      )}

      {/* Session list */}
      <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-tertiary)", marginBottom:8 }}>{T("Sessions")}</div>
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
                  {T("Wrong:")} Q{h.wrong.slice(0,10).join(", Q")}{h.wrong.length > 10 ? ` +${h.wrong.length-10} ${T("more")}` : ""}
                </div>
              )}
              {h.bestStreak > 1 && (
                <div style={{ fontSize:11, color:"var(--color-text-warning)", marginTop:3 }}>{T("🔥 Best streak: {n}", { n: h.bestStreak })}</div>
              )}
              {h.details && h.details.length > 0 && (
                <button style={{ ...S.btn, fontSize:11, padding:"3px 10px", marginTop:8 }}
                  onClick={() => setOpenDetail(openDetail === i ? null : i)}>
                  {openDetail === i ? T("Hide questions ▲") : T("View questions & answers ({n}) ▼", { n: h.details.length })}
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
  const T = useT(); const lang = useLang();
  const [expanded, setExpanded] = useState(null);
  const [shown, setShown] = useState({});       // per-question translation toggle: { [n]: true }
  const [shownAns, setShownAns] = useState({}); // per-question answer-reveal toggle (when answersHidden)
  if (questions.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"2rem", color:"var(--color-text-tertiary)", fontSize:13 }}>
        {T("No questions here yet. Rate some questions to populate this tab.")}
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
                {en && qText(q, lang) && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:2 }}>{qText(q, lang)}</div>}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                {(Q_IMAGES[q.n] || q.img) && <span style={{ ...S.badge, fontSize:11, padding:"1px 5px" }} title={T("Has a picture — expand to view")}>🖼</span>}
                {qText(q, lang) && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setShown(s => ({ ...s, [q.n]: !s[q.n] })); }}
                    aria-pressed={en} title={T("Show/hide translation")}
                    style={{ ...S.badge, fontSize:10, padding:"1px 6px", cursor:"pointer",
                      background: en ? "var(--color-background-info)" : "var(--color-background-secondary)",
                      color: en ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                      border: `0.5px solid ${en ? "var(--color-border-info)" : "var(--color-border-tertiary)"}` }}>{lang.toUpperCase()}</button>
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
                            {en && oText(q, i, lang) && <div style={{ fontSize:10, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{oText(q, i, lang)}</div>}
                            {isAns && <div style={{ fontSize:10, color:"var(--color-text-success)", marginTop:1 }}>{T("✓ correct")}</div>}
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
                            {en && oText(q, i, lang) && <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontStyle:"italic", marginTop:1 }}>{oText(q, i, lang)}</div>}
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
                    {answersHidden && <Switch on={reveal} onChange={() => setShownAns(s => ({ ...s, [q.n]: !s[q.n] }))} label={T("Show answer")} />}
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
  const T = useT(); const lang = useLang();
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
      const tr = Object.values(CONTENT).map(c => (c.q[q.id] && c.q[q.id].q) || "").join(" ").toLowerCase();
      return q.de.toLowerCase().includes(s) || q.en.toLowerCase().includes(s) || tr.includes(s);
    }
    return true;
  });

  const activeTab = TABS.find(t => t.key === tab);

  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title={T("Browse questions")} />

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
              <div style={{ fontSize:10, marginTop:1 }}>{T(t.label)}</div>
            </button>
          );
        })}
      </div>

      {/* Search + section filter */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:"1rem" }}>
        <input type="text" placeholder={T("Search questions...")} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize:13, padding:"8px 12px", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)", width:"100%" }}
        />
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[["all", T("All sections")], ...SECTION_NAMES.map(s => [s, secName(s, lang)])].map(([k,l]) => {
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
          {[["all", T("All levels")],["bund", lvlLabel("bund",lang)],["kanton", lvlLabel("kanton",lang)],["gemeinde", lvlLabel("gemeinde",lang)]].map(([k,l]) => {
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
        {T(filtered.length === 1 ? "{n} question" : "{n} questions", { n: filtered.length })}
        {activeTab && tab !== "all" ? ` · ${T(activeTab.label)}` : ""}
        {filterSection !== "all" ? ` · ${secName(filterSection, lang)}` : ""}
        {filterLvl !== "all" ? ` · ${lvlLabel(filterLvl, lang)}` : ""}
        {search ? ` · "${search}"` : ""}
      </div>

      <QuestionList questions={filtered} difficulties={difficulties} onDiffChange={onDiffChange} answersHidden />
    </div>
  );
}

// ── Help & about screen ───────────────────────────────────────────────────────
// Settings & display options, reached from the gear icon on the home screen.
function SettingsScreen({ lang, setLang, enMode, setEnMode, contrast, setContrast, showExpl, setShowExpl, onHome }) {
  const T = useT();
  const isOther = !PRIMARY_LANGS.includes(lang);
  const [showMore, setShowMore] = useState(isOther); // reveal the additional-language list
  const row = { display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" };
  const hint = { fontWeight:400, color:"var(--color-text-tertiary)", fontSize:11, marginLeft:6 };
  const segBtn = (active) => ({ fontSize:11, padding:"3px 12px", borderRadius:99, cursor:"pointer",
    background: active ? "var(--color-background-info)" : "var(--color-background-secondary)",
    color: active ? "var(--color-text-info)" : "var(--color-text-secondary)",
    border: active ? "1px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    fontWeight: active ? 500 : 400 });
  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title={T("Settings")} />
      <div style={{ ...S.card, padding:"0.85rem 1.25rem", display:"flex", flexDirection:"column", gap:16 }}>
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>{T("Language")}<span style={hint}>{T("secondary translation shown with German")}</span></div>
          <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
            {PRIMARY_LANGS.map((v) => (
              <button key={v} onClick={() => setLang(v)} style={segBtn(lang===v)}>{LANGS[v]}</button>
            ))}
            <button onClick={() => setShowMore((s) => !s)} style={segBtn(showMore || isOther)}>{OTHER_LABEL[lang] || OTHER_LABEL.en}</button>
          </div>
        </div>
        {showMore && (
          <div style={row}>
            <div style={{ fontSize:13, fontWeight:500 }}>{MORE_LANGS_LABEL[lang] || MORE_LANGS_LABEL.en}</div>
            <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
              {Object.keys(LANGS).filter((v) => !PRIMARY_LANGS.includes(v)).map((v) => (
                <button key={v} onClick={() => setLang(v)} style={segBtn(lang===v)}>{LANGS[v]}</button>
              ))}
            </div>
          </div>
        )}
        {HAS_TRANSLATION[lang] && (
          <div style={row}>
            <div style={{ fontSize:13, fontWeight:500 }}>{T("Translations")}<span style={hint}>{T("shown in every test")}</span></div>
            <EnToggle enMode={enMode} setEnMode={setEnMode} />
          </div>
        )}
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>{T("High contrast")}<span style={hint}>{T("stronger colours & borders")}</span></div>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {[["normal","Off"],["high","On"]].map(([v,l]) => (
              <button key={v} onClick={() => setContrast(v)} style={segBtn(contrast===v)}>{T(l)}</button>
            ))}
          </div>
        </div>
        <div style={row}>
          <div style={{ fontSize:13, fontWeight:500 }}>{T("Explanations")}<span style={hint}>{T("off during tests · always in Browse & review")}</span></div>
          <Switch on={showExpl} onChange={setShowExpl} label={showExpl ? T("On in quiz") : T("Off in quiz")} />
        </div>
      </div>
      <div style={{ fontSize:12, color:"var(--color-text-tertiary)", margin:"8px 2px" }}>
        {T("Text size: use the {a} buttons in the bottom-right corner — it scales the whole app and applies on every screen.", { a: "A / A" })}
      </div>
    </div>
  );
}

function HelpScreen({ onHome }) {
  const T = useT(); const lang = useLang();
  const sections = HELP_SECTIONS_BY_LANG[lang] || HELP_SECTIONS_BY_LANG.en;
  const official = HELP_OFFICIAL[lang] || HELP_OFFICIAL.en;
  const officialUrls = [
    "https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html",
    "https://www.zh.ch/de/migration-integration/einbuergerung.html",
    "https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/migration-integration/einbuergerung/gkt/broschuere_einbuergerung_grundkenntnistest.pdf",
  ];
  return (
    <div style={{ padding:"1rem" }}>
      <NavBar onHome={onHome} title={T("Help & about")} />
      <div style={{ ...S.card, border:"1px solid var(--color-border-info)" }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:".5rem" }}>{T("Official information (Kanton Zürich)")}</div>
        <p style={{ fontSize:13, color:"var(--color-text-secondary)", lineHeight:1.5, margin:"0 0 8px" }}>
          {official.intro}
        </p>
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {officialUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:13, color:"var(--color-text-info)", textDecoration:"underline", lineHeight:1.4 }}>↗ {official.links[i]}</a>
          ))}
        </div>
      </div>
      {sections.map(sec => (
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
      <div style={{ fontSize:11, color:"var(--color-text-tertiary)", textAlign:"center", margin:"4px 0 8px", lineHeight:1.6 }}>
        {T("Questions sourced from the official Kanton Zürich Grundkenntnistest catalogue.")}<br/>
        {T("Free software (AGPL-3.0) —")} <a href="https://github.com/THRD-GH/KantonZurich-Grundkenntnistest" target="_blank" rel="noopener noreferrer" style={{ color:"var(--color-text-info)", textDecoration:"underline" }}>{T("source code on GitHub")}</a>.
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
  const [lang,         setLang]         = useState(loadLang);    // "en" | "fr" — secondary translation + UI chrome language

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch {} }, [lang]);
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
    return <SettingsScreen lang={lang} setLang={setLang} enMode={enMode} setEnMode={setEnMode} contrast={contrast} setContrast={setContrast}
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
      onDiscardResume={() => persistResume(null)}
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
  return (
    <LangContext.Provider value={lang}>
      <TopBar lang={lang} setLang={setLang} onSettings={() => setScreen("settings")} onHelp={() => setScreen("help")} />
      {view}
      <ZoomControl textSize={textSize} setTextSize={setTextSize} />
    </LangContext.Provider>
  );
}

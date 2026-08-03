# Zürich Grundkenntnistest — Quiz App

**▶ Live app: <https://thrd-gh.github.io/KantonZurich-Grundkenntnistest/>** — runs in any browser, works on phones, and can be installed to your home screen (offline-capable after the first visit).

## What this is

A free study app for the **Grundkenntnistest** ("basic-knowledge test") of the **Canton of Zürich** — the test on Switzerland, the canton and the municipality that applicants must pass for ordinary naturalisation. It tests knowledge of geographic, historical, political and social matters at the **federal**, **cantonal** and **municipal** levels.

The app lets you practise all **350 questions** from the canton's official question catalogue with: instant per-question feedback, a short **explanation + source link** for every answer, **translations in 12 languages**, difficulty rating, spaced-repetition review, a timed **mock exam** (50 questions / 60 min / 60% to pass, in the real ~70/20/10 federal/cantonal/municipal mix), audio read-out, saveable **bookmarks**, and **backup/restore** of your progress. Questions are grouped into 5 sections and tagged by level.

> ⚠️ **This is an unofficial, community study aid — not an official Canton of Zürich tool.** The authoritative questions, the official digital practice test, and the current rules are published by the canton and can change. Always check the official site below for the latest version.

## Official Kanton Zürich resources (authoritative — latest information)

- **Grundkenntnistest** — official information, the question catalogue, and the canton's own digital practice test: <https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html>
- **Naturalisation (Einbürgerung) — overview**: <https://www.zh.ch/de/migration-integration/einbuergerung.html>
- **Information brochure (PDF)**: <https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/migration-integration/einbuergerung/gkt/broschuere_einbuergerung_grundkenntnistest.pdf>

> There's also an in-app **Help** screen (the ❓ Help button on the home screen) that covers the rest of this README in short form.

## About the real test

- **50 questions in 60 minutes**, pass mark **60%** (30 correct).
- Composition is roughly **70% federal, 20% cantonal, 10% municipal**.
- The **Mock exam** mode in this app reproduces all of the above.

## First-time setup (once)

1. Install Node.js from <https://nodejs.org> (LTS version).
2. Open a terminal/Command Prompt in this folder.
3. Run `npm install`.

## Running the app

```
npm start
```

Opens at <http://localhost:5173>.

## Checking the data

```
npm test
```

Validates the question bank (every question has 4 options, a valid answer index, a level, and that all image keys resolve). Run it after editing `questions.js` or `images.js`.

## Features

- **Quiz flow** — select an option, then **Submit** to confirm; only then is it graded. Move with **Back / Next**; answers are kept. Options are **shuffled** each time so you learn the content, not the position.
- **Difficulty ratings** — rate each question Easy / Medium / Hard to organise study and to build focused quick tests.
- **Translations (12 languages)** — English, French, German, Italian, Portuguese, Albanian, Spanish, Croatian, Turkish, Tamil, Tigrinya, Arabic; switch from the dropdown at the top of every screen. German is the authoritative test content; the rest are machine-translated. Show the secondary translation for the question only, or the question and all options.
- **Quick test** — Random mix, **Exam mix** (the real 70/20/10 split), your Easy/Medium/Hard questions, or **Unrated** ones, at a chosen length.
- **Section test** — practise one section, choosing how many questions.
- **Mock exam** — timed 50Q / 60min / 60% simulation with a pass/fail result and a review of misses.
- **Smart review (spaced repetition)** — Leitner boxes resurface questions you miss and retire ones you master; reviews the most-overdue first.
- **History & progress** — past sessions plus accuracy by section and level, a one-tap **weakest-section drill**, and per-session delete. The home screen also shows a **study streak**, questions answered today, and a rough **exam-readiness** estimate.
- **Browse** — read the full catalogue; filter by difficulty / section / level; search; reveal answers.
- **Saved questions** — star (☆/★) any question to bookmark it; a **★ Saved** browse tab and a **Review saved** home shortcut turn them into a practice set.
- **Backup & restore** — export all your data (ratings, saved, history, progress, settings) to a JSON file and import it back. Version-gated so a backup from an older question set can't corrupt current data — its settings can still be restored.
- **Explanations** — every question has a short why-the-answer-is-correct note (German + translation) with an external source link. Off by default during quizzes (toggle **💡 Explain**); always shown in Browse and review screens.
- **Audio (read aloud)** — tap the 🔊 speaker on any question to hear it read aloud in German (question then options, in on-screen order), using your device's German voice, at an adjustable **speed** (0.5×–2×). A built-in accessibility aid that also helps pronunciation; tap again to stop, and it stops automatically on navigation.
- **Accessibility** — read-aloud audio, keyboard-operable with focus management on navigation, ARIA live feedback, honours **prefers-reduced-motion**, adjustable **text size** (scales the whole app for mobile), and a theme picker: **Light / Dark / System / High contrast**.
- **Installable & offline** — a PWA (service worker) that works offline after the first visit and can be added to the home screen.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`4` | choose an option |
| `Enter` / `Space` / `→` | submit, then next |
| `←` | previous question |

## Your data

Difficulty ratings, saved questions, history and progress are stored only in your browser (`localStorage`) — nothing is uploaded. Clearing browser data resets them, so use **Settings → Back up** to export everything to a JSON file and **Restore** to load it back (handy when switching devices). Id-keyed data is stamped with `QUESTIONS_VERSION` (in `questions.js`): a backup from a different question-set version won't overwrite current progress, though its device-independent settings can still be restored. Bump `QUESTIONS_VERSION` whenever the question list is reordered or ids are reassigned/added/removed.

## Project structure

```
src/
  App.jsx        — all UI and logic (home, quiz, exam, history/progress, browser, settings, help)
  questions.js   — 350 questions (id, n, section, level, German + English, options, answer) + QUESTIONS_VERSION
  images.js      — SVGs for the picture questions (flag, coat of arms, mountain, map)
  i18n.js        — UI-string translations (fr/de/it inline), Help sections, and the language registries
  i18n-extra.js  — UI + Help for the 8 additional languages (generated by the translation workflow)
  fr.js … ar.js  — per-language question/explanation translations, lazy-loaded on demand (code-split)
  index.css      — CSS variables: light, dark (auto), and high-contrast themes; reduced-motion rules
  main.jsx       — React entry point (also registers the service worker for offline use)
validate-data.mjs — data-integrity check (npm test)
```

Stack: React 18 + Vite 8, no external UI libraries (inline styles driven by CSS variables). The 10 per-language translation files are lazy `import()`s, so only the active language is fetched.

## Image credits

Picture-question images in `public/img/` come from Wikimedia Commons:

- **Matterhorn photo** — "Zermatt photos" via Wikimedia Commons, licensed **CC BY-SA 3.0**.
- **Avenches amphitheatre photo** — Nursangaion via Wikimedia Commons, licensed **CC BY-SA 4.0**.
- **Technorama photo** (Q346) — MaddaMom via Wikimedia Commons, licensed **CC BY-SA 4.0**.
- **Canton maps** — adapted (recoloured) from "Suisse cantons.svg" by **Pymouss44**, **CC BY-SA 4.0**.
- **Flag & coat-of-arms options** (Swiss-flag question Q55 and Zürich-arms question Q110) — simple SVGs drawn for this app to match the images shown in the official catalogue (Q55: Danish flag, Red Cross flag, Swiss flag, Schwyz arms; Q110: blue/white and red/blue shield variations plus the Zürich diagonal).
- **Federal-Councillor portraits** (Q241) via Wikimedia Commons: Ruth Dreifuss — Chatham House (**CC BY 2.0**); Elisabeth Kopp — Coralie Wenger (**CC BY 3.0**); Ruth Metzler-Arnold — Manuel Stettler (**CC BY-SA 4.0**); Micheline Calmy-Rey — IAEA Imagebank (**CC BY-SA 2.0**).
- The Swiss-flag option graphics are simplified SVGs created for this app.

Full per-file author details are on each file's page on Wikimedia Commons. If you distribute this app publicly, verify and include the full CC BY-SA attribution for each photo/map.

## Licence

Copyright © 2026 THRD-GH.

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License v3.0** (AGPL-3.0) as published by the Free Software Foundation. It is distributed WITHOUT ANY WARRANTY. See the [`LICENSE`](LICENSE) file for the full text, or <https://www.gnu.org/licenses/agpl-3.0.html>.

The AGPL is a strong copyleft licence: anyone who distributes a modified version **or runs one as a network service (e.g. a hosted website)** must make their corresponding source code available to its users under the same licence.

### Content & data (not covered by the code licence)

The AGPL covers the **application code** only. The bundled content has separate terms:

- **Questions** come from the official Canton of Zürich *Grundkenntnistest* catalogue. This is an **unofficial** study aid; rights to the question content remain with the Canton of Zürich. See the [official source](https://www.zh.ch/de/migration-integration/einbuergerung/grundkenntnistest.html).
- **Images** are under the individual licences listed in *Image credits* above (mostly **CC BY-SA**, which requires attribution and share-alike for those images and any adaptations of them).

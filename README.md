# Zürich Grundkenntnistest — Quiz App

**▶ Live app: <https://thrd-gh.github.io/KantonZurich-Grundkenntnistest/>** — runs in any browser, works on phones, and can be installed to your home screen (offline-capable after the first visit).

## What this is

A free study app for the **Grundkenntnistest** ("basic-knowledge test") of the **Canton of Zürich** — the test on Switzerland, the canton and the municipality that applicants must pass for ordinary naturalisation. It tests knowledge of geographic, historical, political and social matters at the **federal**, **cantonal** and **municipal** levels.

The app lets you practise all **350 questions** from the canton's official question catalogue with: instant per-question feedback, a short **explanation + source link** for every answer, English translations, difficulty rating, spaced-repetition review, a timed **mock exam** (50 questions / 60 min / 60% to pass, in the real ~70/20/10 federal/cantonal/municipal mix), and audio read-out. Questions are grouped into 5 sections and tagged by level.

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
- **English translations** — show the question only, or the question and all options (set on the home screen, changeable mid-quiz).
- **Quick test** — Random mix, **Exam mix** (the real 70/20/10 split), or your Easy/Medium/Hard questions, at a chosen length.
- **Section test** — practise one section, choosing how many questions.
- **Mock exam** — timed 50Q / 60min / 60% simulation with a pass/fail result and a review of misses.
- **Smart review (spaced repetition)** — Leitner boxes resurface questions you miss and retire ones you master.
- **History & progress** — past sessions plus accuracy broken down by section and by level.
- **Browse** — read the full catalogue; filter by difficulty / section / level; search; reveal answers.
- **Explanations** — every question has a short why-the-answer-is-correct note (German + English) with an external source link. Off by default during quizzes (toggle **💡 Explain**); always shown in Browse and review screens.
- **Audio (read aloud)** — tap the 🔊 speaker on any question to hear it read aloud in German (question then options, in on-screen order), using your device's German voice. A built-in accessibility aid that also helps pronunciation; tap again to stop, and it stops automatically on navigation.
- **Accessibility** — read-aloud audio, keyboard-operable, focus rings, ARIA on options, adjustable **text size** (scales the whole app for mobile), and an in-app **high-contrast** mode (dark mode follows the device).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`4` | choose an option |
| `Enter` / `Space` / `→` | submit, then next |
| `←` | previous question |

## Your data

Difficulty ratings, history and progress are stored only in your browser (`localStorage`) — nothing is uploaded. Clearing browser data resets them. Saved data is keyed by a stable question `id`, so re-ordering questions won't desync it.

## Project structure

```
src/
  App.jsx        — all UI and logic (home, quiz, exam, history/progress, browser, help)
  questions.js   — 350 questions (id, n, section, level, German + English, options, answer)
  images.js      — SVGs for the picture questions (flag, coat of arms, mountain, map)
  index.css      — CSS variables: light, dark (auto), and high-contrast themes
  main.jsx       — React entry point
validate-data.mjs — data-integrity check (npm test)
```

Stack: React 18 + Vite 8, no external UI libraries (inline styles driven by CSS variables).

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

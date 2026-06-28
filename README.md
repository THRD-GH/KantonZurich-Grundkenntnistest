# Zürich Grundkenntnistest — Quiz App

A study app for the **Zürich Grundkenntnistest**, the basic-knowledge test required for naturalisation in the Canton of Zürich. All **350 questions** come from the canton's official question catalogue, grouped into 5 sections and tagged by level (Federal / Cantonal / Municipal).

> There's also an in-app **Help** screen (the ❓ Help button on the home screen) that covers everything below in short form.

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
- **Accessibility** — keyboard-operable, focus rings, ARIA on options, and an in-app **high-contrast** mode (dark mode follows the device).

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
- **Canton maps** — adapted (recoloured) from "Suisse cantons.svg" by **Pymouss44**, **CC BY-SA 4.0**.
- **Flag & coat-of-arms options** (Swiss-flag question Q55 and Zürich-arms question Q110) — simple SVGs drawn for this app to match the images shown in the official catalogue (Q55: Danish flag, Red Cross flag, Swiss flag, Schwyz arms; Q110: blue/white and red/blue shield variations plus the Zürich diagonal).
- The Swiss-flag option graphics are simplified SVGs created for this app.

Full per-file author details are on each file's page on Wikimedia Commons. If you distribute this app publicly, verify and include the full CC BY-SA attribution for each photo/map.

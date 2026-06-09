# Browser Agent Recorder

> Record a browser workflow once, then export it as a human-readable SOP **or** a machine-readable Agent Skill Pack for AI agents to replay.

A local-first Chrome (Manifest V3) extension. You hit **Start recording**, do the task in your browser, and every click, input, navigation, and dialog is captured with a screenshot. Then edit the steps and export — as Markdown, a Playwright test, a Chrome DevTools Recorder file, or a full Skill Pack ZIP designed for autonomous agents.

Everything stays on your machine. No backend, no login, no cloud sync, no telemetry.

中文简介：录制一次浏览器操作流程，导出为人类可读的 SOP 或给 AI 智能体回放的 Skill Pack。纯本地运行，无后端、无登录、无上传。

---

## Highlights

- **Captures what matters** — clicks, typing (with IME/composition handling), form changes, submits, keyboard shortcuts, navigations, SPA route changes, file uploads, drag & drop, and native `alert`/`confirm`/`prompt`/`print` dialogs.
- **A screenshot per step, with the clicked element highlighted** — taken at action time so the target element is still on screen and ringed for review.
- **Live REC overlay** — an on-page badge that confirms recording is active, flashes when each step is saved, can be **paused/resumed**, and is **draggable** out of the way.
- **Smart selectors** — every step stores role / label / placeholder / text / CSS / XPath candidates with a confidence score; low-confidence locators are flagged and editable.
- **Privacy by default** — password fields are never stored, sensitive-looking fields are masked, and their region is blacked out in the screenshot.
- **Editor / guide library** — rename, re-describe, drag-to-reorder, delete & restore, zoom screenshots, set the workflow goal & success criteria, and insert manual `note` / `wait` steps.
- **Rich exports** — Markdown SOP, Playwright test, Chrome DevTools Recorder JSON, and a full Agent Skill Pack ZIP.
- **Bilingual UI** — English / 简体中文, following the browser language.
- **Keyboard shortcut** — `Alt+Shift+R` to start/stop anywhere.

## Install

### From a store
- **Chrome Web Store**: _(link once published)_ — also works in Brave, Vivaldi, and Arc.
- **Microsoft Edge Add-ons**: _(link once published)_.

### From source (developer mode)
1. `npm install && npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.

Or download the latest `extension-zip` from a [CI run](../../actions) / [Release](../../releases), unzip, and load that folder.

## Usage

1. Click the extension icon → **Start recording** (or press `Alt+Shift+R`). The starting page URL is captured as step 1.
2. Do your task. The REC badge shows a step count and flashes "✓ step N saved" when each screenshot is stored — that's your cue to proceed.
3. **Stop recording**, then **Open guide library**.
4. Fill in the workflow **Goal** and **Success criteria**, tidy up steps, then **Export**.

## Export formats

| Output | What it's for |
| --- | --- |
| **Skill Pack** (`.zip`) | Full bundle for AI agents — see below. |
| **SOP** (`.md`) | Human-readable step-by-step guide with screenshots. |
| **Playwright** (`.ts`) | A `@playwright/test` script using semantic locators. |
| **DevTools Recorder** (`.json`) | Importable into Chrome DevTools → Recorder. |

### Agent Skill Pack contents

`manifest.yaml`, `agent-instructions.md`, `start-context.json`, `task-brief.md`, `human-guide.md`, `agent-task.md`, `trajectory.jsonl`, `learning-notes.jsonl` (+ schema), `workflow-memory.md`, `replay.playwright.ts`, `replay.devtools.json`, `selectors/browser-selectors.json`, `validations.yaml`, and `screenshots/step-*.jpg`.

Agents treat `trajectory.jsonl` and `agent-instructions.md` as protected source evidence: execution learnings are **appended** to `learning-notes.jsonl` only, and durable changes to `workflow-memory.md` are proposed for review rather than applied silently. The instructions also encode an auth policy (use the existing browser session; never request/store passwords) and a high-risk stop-before-execution policy.

## Privacy

All recording data lives in local IndexedDB on your machine. Password values are never stored; sensitive-looking field values are masked and redacted from screenshots. Nothing is uploaded — there is no backend.

## Architecture

| Area | File |
| --- | --- |
| Content script (capture + REC overlay) | `src/content/recorder.ts` |
| MAIN-world dialog hooks | `public/page-hooks.js` |
| Service worker (state, screenshots, storage, exports) | `src/background/serviceWorker.ts` |
| Popup UI | `src/popup/main.tsx` |
| Editor / guide library | `src/editor/main.tsx` |
| Selector engine | `src/shared/selector.ts` |
| Exporters (SOP / Playwright / DevTools / Skill Pack) | `src/shared/exporters.ts` |
| Local DB (Dexie/IndexedDB) | `src/shared/db.ts` |
| Types & message protocol | `src/shared/types.ts` |
| i18n strings | `src/shared/i18n.ts` |

Stack: TypeScript, React 19, Vite 7, Dexie, JSZip. Manifest V3.

## Development

```bash
npm install
npm run dev         # Vite dev server
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # production build into dist/
npm run package     # build + zip into web-ext-artifacts/ (for store upload)
```

Load the `dist/` folder via **Load unpacked** after a build. See [`OPEN_SOURCE_AUDIT.md`](OPEN_SOURCE_AUDIT.md) for the provenance of patterns this project references.

## License

[MIT](LICENSE) © 2026 VelvetAbyss

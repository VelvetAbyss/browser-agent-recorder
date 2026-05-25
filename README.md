# Browser Agent Recorder

Browser Agent Recorder is a local-first Chrome Extension MV3 app for recording browser workflows and exporting them as human SOPs and machine-readable Agent Skill Packs.

## Features

- Explicit start/stop recording from the popup.
- Content script captures meaningful clicks, inputs, changes, submits, keydowns, and page lifecycle/navigation signals.
- Background service worker captures visible-tab screenshots and stores records locally with Dexie/IndexedDB.
- Guide library and editor for step titles, descriptions, deletion, reordering, runtime variables, and sensitive flags.
- Markdown SOP export and Agent Skill Pack ZIP export with universal agent instructions, task brief, protected trajectory, append-only learning notes, workflow memory, and Playwright replay code.
- No backend, login, cloud sync, AI integration, desktop recording, or full-page screenshots.

## Agent Skill Pack Contents

Skill Pack ZIP exports include:

- `manifest.yaml`
- `agent-instructions.md`
- `start-context.json`
- `task-brief.md`
- `human-guide.md`
- `agent-task.md`
- `trajectory.jsonl`
- `learning-notes.jsonl`
- `learning-notes.schema.json`
- `workflow-memory.md`
- `replay.playwright.ts`
- `replay.devtools.json` (Chrome DevTools Recorder format, importable into the DevTools Recorder panel)
- `selectors/browser-selectors.json`
- `validations.yaml`
- `screenshots/step-001.png`, etc.

Agents should treat `trajectory.jsonl` and `agent-instructions.md` as protected source evidence. Execution learnings must be appended to `learning-notes.jsonl` only; durable workflow-memory changes should be proposed for review rather than silently applied.

## Local Development

```bash
npm install
npm run dev
```

For extension testing, production build output is the most reliable:

```bash
npm run build
```

Then open Chrome:

1. Go to `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `dist` folder from this project.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

All recording data stays in local IndexedDB. Password values are never stored, and sensitive-looking field values are masked by default.

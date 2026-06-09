# Chrome Web Store — Submission Sheet

Everything you need to fill in the Web Store dashboard. Copy/paste the blocks
below. Items marked **TODO** still need you (account, screenshots).

## Prerequisites (you must do these)

- [ ] Register a Chrome Web Store **developer account** (one-time **$5** fee) and verify your email.
- [ ] Enable **2-Step Verification** on that Google account (required to publish).
- [ ] Build the upload zip: `npm run package` → `web-ext-artifacts/browser-agent-recorder-<version>.zip`.

## Listing fields

**Name:** Browser Agent Recorder

**Short description** (≤132 chars):
> Record any browser workflow and export it as a step-by-step SOP or an AI-agent Skill Pack. Local-first — nothing leaves your device.

**Category:** Developer Tools (alternative: Productivity)

**Language:** English (the UI is bilingual EN/中文 and follows the browser language)

**Detailed description:**
```
Record a browser task once. Replay it forever.

Browser Agent Recorder captures what you do in the browser — clicks, typing,
navigations, dropdowns, file uploads, and dialogs — with a screenshot of every
step that highlights exactly what you clicked. Then it turns that recording into
documentation a human or an AI agent can follow.

WHAT IT CAPTURES
• Clicks, inputs (with IME/Chinese composition handling), form changes, submits
• Page navigations and single-page-app route changes
• Keyboard shortcuts, file uploads, drag & drop
• Native alert / confirm / prompt dialogs
• A highlighted screenshot per step

EDIT & ORGANIZE
• Rename and describe steps; drag to reorder; delete and restore
• Set the workflow goal and success criteria
• Insert manual note / wait steps
• Edit selectors and see confidence scores

EXPORT
• Markdown SOP — a readable how-to guide with screenshots
• Playwright test (.ts) — semantic locators
• Chrome DevTools Recorder (.json)
• Agent Skill Pack (.zip) — a full bundle for autonomous AI agents, with
  protected trajectory, append-only learning notes, auth/safety policies, and
  replay code

PRIVATE BY DESIGN
• 100% local. No backend, no login, no cloud sync, no analytics.
• Passwords are never stored; sensitive fields are masked and redacted from
  screenshots.

Press Alt+Shift+R to start or stop recording anywhere.
```

**Homepage URL:** https://github.com/VelvetAbyss/browser-agent-recorder

**Privacy policy URL:** https://velvetabyss.github.io/browser-agent-recorder/privacy.html
_(falls back to https://github.com/VelvetAbyss/browser-agent-recorder/blob/main/PRIVACY.md if Pages is not enabled)_

## Graphic assets

- **Store icon:** `public/icons/icon-128.png` (128×128). A 512 master is at `icon-512.png`.
- **Screenshots — TODO (1–5, required):** 1280×800 or 640×400 PNG/JPEG. Suggested shots:
  1. The REC overlay live on a real page mid-recording.
  2. The guide library / editor showing steps with highlighted screenshots.
  3. The workflow card (goal + success criteria) and the export menu open.
  4. An exported SOP or Skill Pack contents.
- **Small promo tile (optional):** 440×280.

## Privacy practices tab (answers to certify)

- **Single purpose:** "Record browser workflows and export them as human SOPs or
  machine-readable agent skill packs."
- **Data collected:** "Website content" (recorded pages, screenshots, non-sensitive
  form values) — handled **locally only**, **not** transmitted.
- Certify: you do **not** sell/transfer data, do **not** use it for unrelated
  purposes, and do **not** use it for creditworthiness/lending.
- A privacy policy URL is provided (above).

## Permission justifications (paste into "Permission justification")

- **`<all_urls>` host permission:** The user chooses which page to record; the
  recorder must observe DOM interactions and capture screenshots on any site the
  user runs it on, so broad host access is required. No data leaves the device.
- **`activeTab`:** Capture the visible tab the user is recording.
- **`tabs`:** Identify the correct window for screenshots and follow recording
  into tabs opened during the workflow (target=_blank / window.open).
- **`scripting`:** Inject the recorder content script (and a MAIN-world hook used
  only to observe native alert/confirm/prompt dialogs) into the recorded page.
- **`storage`:** Persist recordings locally (IndexedDB) and remember UI
  preferences such as the overlay position.
- **Remote code:** None. All scripts are bundled in the package. Web fonts
  (CSS/woff2) are loaded from Google Fonts for UI styling only.

## Notes / known review considerations

- Broad host permissions trigger heightened review — the justification above
  addresses it; expect possible follow-up questions.
- Web fonts are loaded from a CDN (allowed: CSS/fonts are not remote *code*). To
  remove this variable entirely you can self-host the woff2 files later.

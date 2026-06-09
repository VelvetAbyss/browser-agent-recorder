# Privacy Policy — Browser Agent Recorder

_Last updated: 2026-06-09_

Browser Agent Recorder ("the extension") is a local-first browser recorder. This
policy explains exactly what data it touches and where that data goes.

## Summary

**The extension does not transmit any data off your device.** There is no
backend server, no account, no analytics, and no third-party data sharing. All
recordings stay in your browser's local storage until you delete them.

## What the extension accesses

While you are actively recording, the extension captures, **on your device only**:

- The URLs and page titles of the pages you record on.
- Information about the elements you interact with (tag, accessible name,
  selectors, position).
- Values you type into non-sensitive form fields (so steps can be replayed).
- Screenshots of the visible tab at each step.
- Native browser dialog text (alert / confirm / prompt).

It does **not** access your browsing history, other tabs you are not recording,
bookmarks, or any page when you are not recording.

## What is never collected

- **Passwords are never stored.** Password fields are excluded entirely.
- **Sensitive fields are masked.** Fields that look like secrets (tokens, card
  numbers, OTP, etc.) have their value masked and their region blacked out in
  the screenshot.
- No data is sent to the developer or any third party. No cookies, tokens, or
  session values are exported.

## Where data is stored

All recordings, steps, and screenshots are stored locally in your browser using
IndexedDB. They never leave your machine unless **you** explicitly export a file
(SOP, Playwright, DevTools Recorder, or Skill Pack) and choose where to save it.

## Your control over your data

- Delete any single recording, or use **Clear all data** in the guide library to
  remove everything.
- Uninstalling the extension removes all of its locally stored data.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab`, `<all_urls>` host access | To observe interactions and capture screenshots on the pages you choose to record. |
| `tabs` | To capture the correct window and follow recording into tabs opened during a workflow. |
| `scripting` | To inject the recorder into the page you are recording. |
| `storage` | To save recordings locally and remember your preferences (e.g. overlay position). |

## Network

The extension loads web fonts from Google Fonts (`fonts.googleapis.com` /
`fonts.gstatic.com`) for its own UI styling. No recording data is involved in
that request. No other network requests are made.

## Contact

Questions or requests: open an issue at
<https://github.com/VelvetAbyss/browser-agent-recorder/issues>.

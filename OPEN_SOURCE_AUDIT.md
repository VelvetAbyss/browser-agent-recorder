# Open Source Audit

This project prioritizes adapting established open-source patterns without vendoring whole repositories. The implementation keeps dependencies limited to the requested runtime libraries and rewrites the extension-specific logic locally.

## AStevensTaylor/how-to-recorder

- **Repository:** `AStevensTaylor/how-to-recorder`
- **License:** MIT
- **Relevant files/modules:** Chrome extension recorder, element metadata capture, screenshot flow, masking rules, Markdown/ZIP guide export.
- **What will be reused:** Product model and export shape patterns: ordered browser steps, per-step screenshots, masked values, human-readable guide output.
- **What will be rewritten:** MV3 service worker, typed message protocol, Dexie schema, React guide editor, selector utilities, exporters.
- **Integration risks:** Direct reuse could pull in UI and extension assumptions that do not match this MV3/Vite/React stack. Screenshot and storage behavior must be implemented around current Chrome extension APIs.
- **Decision:** **Reference only** for V1. Recreate the required concepts with local typed code.

## checkly/headless-recorder

- **Repository:** `checkly/headless-recorder`
- **License:** MIT
- **Relevant files/modules:** Selector generation, event-to-script mapping, Puppeteer/Playwright-style code export.
- **What will be reused:** Selector priority strategy and replay script generation concepts.
- **What will be rewritten:** Selector implementation, locator confidence scoring, Playwright TypeScript generator, runtime-variable handling.
- **Integration risks:** Repository is archived and predates current Playwright best practices. Direct code reuse may introduce stale browser assumptions.
- **Decision:** **Adapt patterns** only. Prefer modern Playwright locators in local code.

## puppeteer/replay

- **Repository:** `puppeteer/replay`
- **License:** Apache-2.0
- **Relevant files/modules:** Chrome DevTools Recorder replay/stringify model.
- **What will be reused:** Nothing in V1.
- **What will be rewritten:** Skill Pack exports and Playwright replay generation remain purpose-built for this app.
- **Integration risks:** Adds an additional recording format and dependency surface before V1 needs Chrome DevTools Recorder compatibility.
- **Decision:** **Reference only** for future compatibility.

## Dexie.js

- **Repository:** `dexie/Dexie.js`
- **License:** Apache-2.0
- **Relevant files/modules:** IndexedDB wrapper.
- **What will be reused:** Installed npm package, directly used for local persistence.
- **What will be rewritten:** App schema and repository helpers.
- **Integration risks:** Service worker lifecycle requires short, awaited database operations.
- **Decision:** **Use** directly.

## JSZip

- **Repository:** `Stuk/jszip`
- **License:** MIT or GPLv3
- **Relevant files/modules:** ZIP creation API.
- **What will be reused:** Installed npm package, directly used for Agent Skill Pack export.
- **What will be rewritten:** Export manifest and file generation.
- **Integration risks:** Large screenshots can produce large ZIPs; V1 stores visible-tab screenshots only to keep size bounded.
- **Decision:** **Use** directly.

## Vite MV3 Bundling

- **Reference:** Vite multi-entry Rollup output.
- **License:** Vite is MIT.
- **Relevant files/modules:** Build config and static manifest copying.
- **What will be reused:** Vite/Rollup entry bundling.
- **What will be rewritten:** Extension manifest and entry wiring.
- **Integration risks:** Chrome manifests require stable script filenames. The build config pins entry names instead of relying on hashed entry output.
- **Decision:** **Use Vite directly** rather than `@crxjs/vite-plugin` for V1, because this app has simple static MV3 entrypoints and does not need CRX plugin features.

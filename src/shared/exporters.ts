import JSZip from "jszip";
import type { RecordedAction, ScreenshotRecord, SessionBundle } from "./types";
import { runtimeVariableName } from "./sanitize";

const SKILL_PACK_FORMAT = "browser-agent-recorder.skill-pack.v2";

function screenshotPath(stepNumber: number) {
  return `screenshots/step-${String(stepNumber).padStart(3, "0")}.jpg`;
}

function byActionId(screenshots: ScreenshotRecord[]) {
  return new Map(screenshots.map((screenshot) => [screenshot.actionId, screenshot]));
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function startUrl(bundle: SessionBundle) {
  return bundle.session.startUrl || bundle.actions[0]?.page.url || "";
}

function startDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function generateStartContextJson(bundle: SessionBundle) {
  const url = startUrl(bundle);
  const firstAction = bundle.actions[0];
  return JSON.stringify(
    {
      type: "start_context",
      instruction: "Open this page before executing the recorded actions.",
      url,
      domain: startDomain(url),
      recorded_title: firstAction?.page.url === url ? firstAction.page.title : bundle.session.title,
      session_started_at: bundle.session.startedAt,
      auth_policy: "use_existing_session_only",
      cookie_policy: "use_available_cookies_without_exporting",
      credential_policy: "never_request_or_store_passwords"
    },
    null,
    2
  );
}

function runtimeVariableFor(action: RecordedAction, stepNumber: number) {
  return action.runtimeVariable?.name || runtimeVariableName(action.title, stepNumber).toUpperCase();
}

function actionPurpose(action: RecordedAction) {
  if (action.description && action.description !== action.title) return action.description;
  if (action.type === "navigation") return `Reach ${action.page.url}.`;
  if (action.type === "input") return "Provide a value required by the workflow.";
  if (action.type === "submit") return "Submit the current form or advance the workflow.";
  return `Advance the workflow by interacting with ${action.target.ariaLabel || action.target.text || action.target.selector}.`;
}

export function generateAgentInstructions() {
  return [
    "# Browser Workflow Agent Instructions",
    "",
    "You are executing a browser workflow captured from a human demonstration.",
    "",
    "Your job is not to blindly replay clicks. Your job is to understand the user's intended outcome, use the recorded trajectory as evidence, and complete the workflow reliably in the current browser environment.",
    "",
    "## 1. Understand Before Acting",
    "",
    "Before taking browser actions, read all provided files:",
    "",
    "- `task-brief.md`",
    "- `human-guide.md`",
    "- `trajectory.jsonl`",
    "- `workflow-memory.md`",
    "- `learning-notes.jsonl`",
    "- `selectors/browser-selectors.json`",
    "- `validations.yaml`",
    "- available screenshots",
    "",
    "Infer:",
    "",
    "- the target website",
    "- the user's final goal",
    "- the purpose of each major step",
    "- required login/authentication state",
    "- runtime variables, if any",
    "- high-risk steps that require stopping before execution",
    "- success criteria",
    "",
    "If `task-brief.md` contains an explicit user goal or success criteria, treat that as higher priority than inferred intent.",
    "",
    "## 2. Authentication Policy",
    "",
    "Use an existing authenticated browser context whenever available.",
    "",
    "Allowed:",
    "",
    "- existing browser profile",
    "- existing cookies",
    "- existing session storage",
    "- provided Playwright storage state",
    "- user-prepared logged-in browser session",
    "",
    "Not allowed:",
    "",
    "- asking for passwords",
    "- guessing credentials",
    "- saving credentials",
    "- printing cookies, tokens, passwords, or session values",
    "- exporting authentication data",
    "",
    "If authentication is required and no valid session exists, stop and ask the user to provide an authenticated browser context. Do not ask for account passwords.",
    "",
    "## 3. Execution Strategy",
    "",
    "Use the recorded workflow as a guide, not as a rigid script.",
    "",
    "For each step:",
    "",
    "1. Read the step intent.",
    "2. Locate the target using DOM role, label, placeholder, accessible name, visible text, stable CSS selector, XPath fallback, and screenshot context.",
    "3. Prefer semantic DOM locators over coordinates.",
    "4. Perform the minimum action needed to advance the workflow.",
    "5. Verify the expected result before moving to the next step.",
    "",
    "Selector priority:",
    "",
    "1. role/name locator",
    "2. label locator",
    "3. placeholder locator",
    "4. visible text locator",
    "5. stable CSS selector",
    "6. XPath fallback",
    "7. screenshot/visual context only when DOM locators fail",
    "",
    "Do not use coordinates unless no better option exists.",
    "",
    "## 4. Handling UI Changes and Interruptions",
    "",
    "The live page may differ from the recording.",
    "",
    "If you encounter cookie banners, ads, newsletter popups, onboarding modals, browser permission prompts, layout changes, already-completed login steps, or changed button positions, decide whether the interruption is relevant to the goal.",
    "",
    "If irrelevant, dismiss it safely and continue. If the workflow is already past a recorded step, skip that step and continue from the closest matching state. If the UI changed but the intent is still clear, adapt using page semantics. If the intent is unclear, stop and ask for clarification.",
    "",
    "## 5. Runtime Variables and Sensitive Data",
    "",
    "Never guess runtime variables. Use only values explicitly provided by the user or environment.",
    "",
    "Do not expose sensitive values in logs, screenshots, filenames, comments, or output. For sensitive fields, type only the required value, do not read it back, do not summarize it, and do not store it.",
    "",
    "## 6. High-Risk Actions",
    "",
    "A high-risk action is any step that may submit a final form, make a purchase, send a message, publish content, delete or modify user data, trigger billing, grant permissions, or change account/security settings.",
    "",
    "If a recorded step is marked high risk, stop immediately before executing it and ask for confirmation. If an unmarked step appears high risk in the live environment, treat it as high risk and stop before executing.",
    "",
    "## 7. Validation",
    "",
    "After each major step, verify progress using URL changes, page title, visible confirmation text, target element state, navigation completion, expected dashboard/page content, or validation rules from `validations.yaml`.",
    "",
    "At the end, report whether the workflow completed, final URL, evidence of success, skipped or adapted steps, and blockers.",
    "",
    "## 8. Failure Policy",
    "",
    "Stop instead of guessing when authentication is unavailable, a required runtime variable is missing, the page state cannot be matched to the recording, a high-risk action is about to happen, the site asks for credentials/payment/recovery codes/security approval, or the next step's intent is ambiguous.",
    "",
    "When stopping, explain what was attempted, where execution stopped, and what information or browser state is needed.",
    "",
    "## 9. Controlled Learning and Write-Back Policy",
    "",
    "After executing the workflow, you may write back execution learnings only as additive notes.",
    "",
    "You must preserve the original recorded trajectory. Do not rewrite, delete, reorder, or reinterpret original steps unless explicitly asked by the user.",
    "",
    "Allowed write-backs:",
    "",
    "- recovery hints",
    "- selector alternatives observed in the live DOM",
    "- common popups or interruptions",
    "- authentication state observations",
    "- validation improvements",
    "- step-specific ambiguity notes",
    "- safer handling recommendations",
    "- evidence that a step can be skipped when already completed",
    "",
    "Not allowed write-backs:",
    "",
    "- passwords, cookies, tokens, session values, or personal data",
    "- replacing the user's original goal",
    "- deleting original steps",
    "- changing high-risk flags to low-risk",
    "- removing runtime-variable requirements",
    "- converting a one-time observation into a permanent rule without repeated evidence",
    "- adding instructions that broaden permissions or bypass user confirmation",
    "",
    "Write-back destination:",
    "",
    "- Append JSON objects to `learning-notes.jsonl`.",
    "- Do not modify `trajectory.jsonl` directly.",
    "- If a durable summary is needed, propose an update to `workflow-memory.md` instead of applying it silently.",
    "",
    "Each write-back entry must include `timestamp`, `execution_id`, `scope`, `step_number` when applicable, `note_type`, `observation`, `recommended_handling`, `confidence`, `evidence`, and `safety_impact`.",
    "",
    "Original trajectory and safety rules override learning notes. Learning notes may refine execution, but must not weaken constraints.",
    ""
  ].join("\n");
}

export function generateTaskBrief(bundle: SessionBundle) {
  const runtimeActions = bundle.actions.filter((action) => action.valuePolicy === "runtime");
  const highRisk = bundle.actions.filter((action) => action.highRisk);
  return [
    `# Task Brief: ${bundle.session.title}`,
    "",
    "## Start URL",
    "",
    startUrl(bundle) || "Not recorded.",
    "",
    "Agents must open this URL before executing Step 1. If the browser is already on an equivalent authenticated page, verify that state before skipping navigation.",
    "",
    "## User Goal",
    "",
    bundle.session.summary || "TODO: Describe the final purpose of this workflow. If this is blank, infer the goal from the full trajectory before acting.",
    "",
    "## Success Criteria",
    "",
    bundle.session.successCriteria ||
      "TODO: Describe what confirms the workflow is complete. If this is blank, infer likely success criteria from the final recorded step, visible page state, validations, and screenshots.",
    "",
    "## Authentication Policy",
    "",
    "- Mode: use existing authenticated browser context when available.",
    "- Cookie policy: use available cookies/session storage from the execution environment; do not export or print them.",
    "- Credential policy: never ask for, guess, store, or log passwords.",
    "- Fallback: stop and ask the user for an authenticated browser context.",
    "",
    "## Runtime Variables",
    "",
    runtimeActions.length
      ? runtimeActions.map((action, index) => `- ${runtimeVariableFor(action, index + 1)}: required for "${action.title}".`).join("\n")
      : "- None recorded.",
    "",
    "## High-Risk Steps",
    "",
    highRisk.length
      ? highRisk.map((action) => `- Step ${action.stepNumber}: ${action.title}`).join("\n")
      : "- None recorded. Still treat live high-risk actions as high risk.",
    "",
    "## Agent Notes",
    "",
    "Treat recorded steps as evidence of intent, not exact clicks. If the page is already past a recorded step, skip it only when the current state clearly satisfies that step's purpose.",
    ""
  ].join("\n");
}

export function generateHumanGuide(bundle: SessionBundle) {
  const screenshotMap = byActionId(bundle.screenshots);
  const lines = [
    `# ${bundle.session.title}`,
    "",
    "## Summary",
    "",
    bundle.session.summary || `Workflow recorded from ${bundle.session.startUrl || "the browser"}.`,
    "",
    "## Prerequisites",
    "",
    "- Access to the target website.",
    "- Runtime values available for any steps marked as runtime-required.",
    "",
    "## Steps",
    ""
  ];

  bundle.actions.forEach((action, index) => {
    const step = index + 1;
    const screenshot = screenshotMap.get(action.id);
    lines.push(`${step}. ${action.title}`);
    lines.push("");
    lines.push(`   ${action.description}`);
    if (action.sensitive) lines.push("   Warning: this step contains sensitive data and should be handled carefully.");
    if (action.valuePolicy === "runtime") lines.push(`   Runtime variable required: ${action.runtimeVariable?.name || runtimeVariableName(action.title, step)}.`);
    if (screenshot) lines.push(`   Screenshot: ${screenshotPath(step)}`);
    lines.push("");
  });

  return lines.join("\n");
}

export function generateAgentTask(bundle: SessionBundle) {
  const runtimeActions = bundle.actions.filter((action) => action.valuePolicy === "runtime");
  const highRisk = bundle.actions.filter((action) => action.highRisk);
  return [
    `# Agent Task: ${bundle.session.title}`,
    "",
    "## Required Reading Order",
    "",
    "1. `agent-instructions.md`",
    "2. `task-brief.md`",
    "3. `workflow-memory.md`",
    "4. `learning-notes.jsonl`",
    "5. `human-guide.md`",
    "6. `trajectory.jsonl`",
    "7. `selectors/browser-selectors.json`",
    "8. `validations.yaml`",
    "",
    "## Start URL",
    "",
    startUrl(bundle) || "Not recorded.",
    "",
    "Open this URL before executing the recorded actions. Use the existing authenticated browser context when available.",
    "",
    "## Current Workflow",
    "",
    bundle.session.summary || "No explicit user goal was recorded. Infer it from the full trajectory before acting.",
    "",
    "## Prerequisites",
    "",
    "- Browser access to the recorded target website.",
    "- DOM inspection and browser interaction capability.",
    "- Existing authenticated browser context if the workflow reaches login.",
    "- Runtime variables supplied by the operator before execution.",
    "",
    "## Runtime Variables",
    "",
    runtimeActions.length
      ? runtimeActions.map((action, index) => `- ${action.runtimeVariable?.name || runtimeVariableName(action.title, index + 1)}: required for "${action.title}".`).join("\n")
      : "- None.",
    "",
    "## Execution Rules",
    "",
    "- Do not blindly replay clicks.",
    "- Use the recorded trajectory as evidence, not as a rigid script.",
    "- Prefer semantic DOM selectors over visual guessing.",
    "- Use existing cookies/session state when available; do not ask for passwords.",
    "- Never guess runtime variables.",
    "- Do not reveal or log sensitive values.",
    "- Stop before final submission if a step is marked high risk.",
    "- After execution, append controlled learning notes to `learning-notes.jsonl` only.",
    "",
    "## Validation Rules",
    "",
    "- Confirm each target is visible before interacting when possible.",
    "- Confirm navigation or page title changes after navigation steps.",
    highRisk.length ? `- High-risk steps: ${highRisk.map((action) => action.title).join(", ")}.` : "- No high-risk steps recorded.",
    ""
  ].join("\n");
}

export function generateTrajectoryJsonl(bundle: SessionBundle) {
  const startContextLine = JSON.stringify({
    type: "start_context",
    instruction: "Open this page before executing the recorded actions.",
    url: startUrl(bundle),
    domain: startDomain(startUrl(bundle)),
    session_started_at: bundle.session.startedAt,
    auth_policy: "use_existing_session_only",
    cookie_policy: "use_available_cookies_without_exporting",
    credential_policy: "never_request_or_store_passwords"
  });
  const actionLines = bundle.actions
    .map((action, index) =>
      JSON.stringify({
        type: "recorded_action",
        step_number: index + 1,
        recorded_client_sequence: action.clientSequence,
        recorded_client_event_id: action.clientEventId,
        intent: action.title,
        purpose: actionPurpose(action),
        action_type: action.type,
        page: action.page,
        target_locator: preferredLocator(action),
        target_meaning: action.target.ariaLabel || action.target.text || action.target.placeholder || action.target.name || action.target.id,
        selector: action.target.selector,
        xpath_fallback: action.target.xpath,
        fallback_text: action.target.text,
        screenshot_path: screenshotPath(index + 1),
        value_policy: action.valuePolicy,
        runtime_variable_name: action.valuePolicy === "runtime" ? runtimeVariableFor(action, index + 1) : undefined,
        sensitive: action.sensitive,
        high_risk: action.highRisk,
        auth_policy: "use_existing_session_only",
        recovery_hint: action.type === "navigation"
          ? "If already on a page that satisfies this step, continue from the closest matching state."
          : "If this exact target is unavailable but the step intent is clear, adapt using page semantics and stable DOM locators.",
        write_back_policy: "append_observations_to_learning_notes_only",
        value_label: action.valueLabel,
        viewport: action.viewport,
        frame_url: action.frameUrl,
        dialog: action.dialog
      })
    )
    .join("\n");
  return [startContextLine, actionLines].filter(Boolean).join("\n");
}

export function generateSelectorsJson(bundle: SessionBundle) {
  return JSON.stringify(
    bundle.actions.map((action, index) => ({
      step: index + 1,
      title: action.title,
      selector: action.target.selector,
      xpath: action.target.xpath,
      confidence: action.target.selectorConfidence,
      candidates: action.target.candidates
    })),
    null,
    2
  );
}

export function generateValidationsYaml(bundle: SessionBundle) {
  const lines = ["validations:"];
  bundle.actions.forEach((action, index) => {
    lines.push(`  - step: ${index + 1}`);
    lines.push(`    title: ${yamlString(action.title)}`);
    lines.push(`    require_visible_target: true`);
    if (action.type === "navigation") lines.push(`    expected_url: ${yamlString(action.page.url)}`);
    if (action.highRisk) lines.push(`    stop_before_execution: true`);
  });
  return `${lines.join("\n")}\n`;
}

export function generateWorkflowMemory(bundle: SessionBundle) {
  return [
    `# Workflow Memory: ${bundle.session.title}`,
    "",
    "This file is for durable, reviewed knowledge about this workflow.",
    "",
    "Do not silently rewrite this file during execution. If repeated observations from `learning-notes.jsonl` should become stable guidance, propose a concise update for user review.",
    "",
    "## Stable Notes",
    "",
    "- None yet.",
    "",
    "## Candidate Improvements",
    "",
    "- Review `learning-notes.jsonl` after multiple executions for repeated recovery hints, selector alternatives, or validation improvements.",
    ""
  ].join("\n");
}

export function generateLearningNotesSchema() {
  return JSON.stringify(
    {
      schema: "browser-agent-recorder.learning-note.v1",
      append_only: true,
      required_fields: [
        "timestamp",
        "execution_id",
        "scope",
        "note_type",
        "observation",
        "recommended_handling",
        "confidence",
        "evidence",
        "safety_impact"
      ],
      allowed_scope: ["workflow", "step"],
      allowed_note_type: ["recovery_hint", "selector_alternative", "interruption", "auth_state", "validation_improvement", "skip_condition", "ambiguity", "safety_recommendation"],
      allowed_confidence: ["low", "medium", "high"],
      allowed_safety_impact: ["none", "safer", "riskier"],
      protected_files: ["trajectory.jsonl", "agent-instructions.md"],
      append_only_files: ["learning-notes.jsonl"],
      example: {
        timestamp: "2026-05-25T12:30:00.000Z",
        execution_id: "exec_20260525_123000",
        scope: "step",
        step_number: 3,
        note_type: "skip_condition",
        observation: "The login step was not shown because the browser profile was already authenticated.",
        recommended_handling: "If the application dashboard is visible, skip the recorded login step.",
        confidence: "medium",
        evidence: {
          url: "https://example.com/app",
          visible_text: ["Dashboard"]
        },
        safety_impact: "safer"
      }
    },
    null,
    2
  );
}

function escapeForTs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function locatorCode(action: RecordedAction) {
  const role = action.target.candidates.find((candidate) => candidate.kind === "role");
  const label = action.target.candidates.find((candidate) => candidate.kind === "label");
  const placeholder = action.target.candidates.find((candidate) => candidate.kind === "placeholder");
  const text = action.target.candidates.find((candidate) => candidate.kind === "text");

  if (role) {
    const [roleName, accessibleName] = role.value.split(":");
    return `page.getByRole('${escapeForTs(roleName)}', { name: '${escapeForTs(accessibleName || "")}' })`;
  }
  if (label) return `page.getByLabel('${escapeForTs(label.value)}')`;
  if (placeholder) return `page.getByPlaceholder('${escapeForTs(placeholder.value)}')`;
  if (text) return `page.getByText('${escapeForTs(text.value)}')`;
  return `page.locator('${escapeForTs(action.target.selector)}')`;
}

function preferredLocator(action: RecordedAction) {
  const candidate = action.target.candidates.find((item) => item.kind !== "xpath") || action.target.candidates[0];
  return candidate ? { type: candidate.kind, value: candidate.value, confidence: candidate.confidence } : undefined;
}

export function generatePlaywright(bundle: SessionBundle) {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "",
    `test('${escapeForTs(bundle.session.title)}', async ({ page }) => {`,
    `  await page.goto('${escapeForTs(bundle.session.startUrl || bundle.actions[0]?.page.url || "about:blank")}');`
  ];

  bundle.actions.forEach((action, index) => {
    const step = index + 1;
    const locator = locatorCode(action);
    lines.push("");
    lines.push(`  // Step ${step}: ${action.title}`);
    if (action.target.selectorConfidence < 0.7) {
      lines.push("  // Low selector confidence: verify this locator before unattended replay.");
    }
    if (action.highRisk) {
      lines.push("  // High risk: stop before executing this step unless explicitly approved.");
      return;
    }
    if (action.type === "navigation") {
      lines.push(`  await page.goto('${escapeForTs(action.page.url)}');`);
      lines.push(`  await expect(page).toHaveURL(/${escapeForTs(new URL(action.page.url).hostname)}/);`);
      return;
    }
    if (action.type === "note") {
      lines.push(`  // Note: ${action.description || action.title}`);
      return;
    }
    if (action.type === "wait") {
      const seconds = Number(action.value) || 2;
      lines.push(`  await page.waitForTimeout(${Math.round(seconds * 1000)});`);
      return;
    }
    lines.push(`  await expect(${locator}).toBeVisible();`);
    if (action.type === "input") {
      const value = action.valuePolicy === "runtime"
        ? `process.env.${action.runtimeVariable?.name || runtimeVariableName(action.title, step).toUpperCase()}`
        : `'${escapeForTs(action.value || "")}'`;
      lines.push(`  await ${locator}.fill(${value} ?? '');`);
    } else if (action.type === "change") {
      if (action.value) lines.push(`  await ${locator}.fill('${escapeForTs(action.value)}');`);
      else lines.push(`  await ${locator}.click();`);
    } else if (action.type === "keydown") {
      lines.push(`  await ${locator}.press('${escapeForTs(action.key || "Enter")}');`);
    } else if (action.type === "paste") {
      const value = action.valuePolicy === "runtime"
        ? `process.env.${action.runtimeVariable?.name || runtimeVariableName(action.title, step).toUpperCase()}`
        : `'${escapeForTs(action.value || "")}'`;
      lines.push(`  await ${locator}.fill(${value} ?? '');`);
    } else if (action.type === "upload") {
      const varName = action.runtimeVariable?.name || runtimeVariableName(action.title, step).toUpperCase();
      lines.push(`  // Recorded files: ${action.value ?? "none"}`);
      lines.push(`  await ${locator}.setInputFiles((process.env.${varName} ?? '').split(',').map(p => p.trim()).filter(Boolean));`);
    } else if (action.type === "rightclick") {
      lines.push(`  await ${locator}.click({ button: 'right' });`);
    } else if (action.type === "doubleclick") {
      lines.push(`  await ${locator}.dblclick();`);
    } else if (action.type === "dragstart") {
      lines.push(`  // Drag source captured here; pair with the matching drop step.`);
      lines.push(`  await ${locator}.hover();`);
      lines.push(`  await page.mouse.down();`);
    } else if (action.type === "drop") {
      lines.push(`  await ${locator}.hover();`);
      lines.push(`  await page.mouse.up();`);
    } else if (action.type === "toggle") {
      lines.push(`  await ${locator}.click();`);
    } else if (action.type === "dialog") {
      const kind = action.dialog?.kind ?? "alert";
      if (kind === "print") {
        lines.push(`  // Recorded: print dialog opened. Playwright cannot drive Chrome's print UI.`);
      } else if (kind === "beforeunload") {
        lines.push(`  // Recorded: beforeunload. Replay should expect a navigation confirmation.`);
      } else {
        const accept = action.dialog?.accepted !== false;
        if (kind === "prompt") {
          const responseExpr = action.valuePolicy === "runtime"
            ? `process.env.${action.runtimeVariable?.name || runtimeVariableName(action.title, step).toUpperCase()} ?? ''`
            : `'${escapeForTs(action.dialog?.response || "")}'`;
          lines.push(`  page.once('dialog', async (dialog) => { await dialog.accept(${responseExpr}); });`);
        } else {
          lines.push(`  page.once('dialog', async (dialog) => { await dialog.${accept ? "accept" : "dismiss"}(); });`);
        }
        lines.push(`  // Recorded ${kind}${action.dialog?.message ? `: ${JSON.stringify(action.dialog.message)}` : ""}`);
      }
    } else {
      lines.push(`  await ${locator}.click();`);
    }
  });

  lines.push("});", "");
  return lines.join("\n");
}

// Chrome DevTools Recorder JSON — schema documented at
// https://developer.chrome.com/docs/devtools/recorder/reference
// Each step's `selectors` is an array of alternative locators; each alternative
// is an array of part strings (frames). We emit a single-frame alternative per
// candidate, in DevTools' priority order: aria → text → CSS → xpath.
function devtoolsRecorderSelectors(action: RecordedAction): string[][] {
  const selectors: string[][] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    selectors.push([value]);
  };
  for (const candidate of action.target.candidates) {
    if (candidate.kind === "role" || candidate.kind === "label" || candidate.kind === "placeholder") {
      const name = candidate.value.includes(":") ? candidate.value.split(":").slice(1).join(":") : candidate.value;
      if (name) push(`aria/${name}`);
    } else if (candidate.kind === "text" && action.target.text) {
      push(`text/${action.target.text}`);
    } else if (candidate.kind === "css") {
      push(candidate.value);
    } else if (candidate.kind === "xpath") {
      push(`xpath/${candidate.value.replace(/^\/\//, "//")}`);
    }
  }
  if (selectors.length === 0) push(action.target.selector);
  return selectors;
}

function devtoolsRecorderStep(action: RecordedAction, stepNumber: number) {
  // Manual note/wait steps have no DevTools Recorder equivalent; the real
  // intent stays in trajectory.jsonl / human-guide.md for agent replay.
  if (action.type === "note" || action.type === "wait") return null;
  const selectors = devtoolsRecorderSelectors(action);
  const base = {
    selectors,
    target: "main",
    assertedEvents: action.type === "navigation"
      ? [{ type: "navigation", url: action.page.url, title: action.page.title }]
      : undefined
  };
  if (action.type === "navigation") {
    return { type: "navigate", url: action.page.url, ...base };
  }
  if (action.type === "input" || action.type === "change" || action.type === "paste") {
    const value = action.valuePolicy === "runtime"
      ? `{{${action.runtimeVariable?.name || runtimeVariableName(action.title, stepNumber).toUpperCase()}}}`
      : action.value ?? "";
    return { type: "change", value, ...base };
  }
  if (action.type === "upload") {
    // Chrome DevTools Recorder has no first-class upload step. Emit a click on
    // the input; the recorded filenames stay in trajectory.jsonl for replay.
    return { type: "click", ...base };
  }
  if (action.type === "keydown") {
    return [
      { type: "keyDown", key: action.key || "Enter", ...base },
      { type: "keyUp", key: action.key || "Enter", ...base }
    ];
  }
  if (action.type === "submit") {
    return { type: "click", ...base };
  }
  if (action.type === "rightclick") {
    return { type: "click", button: "secondary", ...base };
  }
  if (action.type === "doubleclick") {
    return { type: "doubleClick", ...base };
  }
  if (action.type === "dialog" || action.type === "dragstart" || action.type === "drop" || action.type === "toggle") {
    // No direct DevTools mapping; emit a click placeholder. The real type
    // is preserved in trajectory.jsonl for agent replay.
    return { type: "click", ...base };
  }
  return { type: "click", ...base };
}

export function generateDevtoolsRecorderJson(bundle: SessionBundle) {
  const steps: unknown[] = [];
  const start = startUrl(bundle);
  if (start) steps.push({ type: "setViewport", width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true });
  if (start) steps.push({ type: "navigate", url: start, assertedEvents: [{ type: "navigation", url: start }] });
  bundle.actions.forEach((action, index) => {
    const step = devtoolsRecorderStep(action, index + 1);
    if (step === null) return;
    if (Array.isArray(step)) steps.push(...step);
    else steps.push(step);
  });
  return JSON.stringify({ title: bundle.session.title, steps }, null, 2);
}

function dataUrlBase64(dataUrl: string) {
  return dataUrl.split(",")[1] || "";
}

function createSkillPackZip(bundle: SessionBundle) {
  const zip = new JSZip();
  zip.file(
    "manifest.yaml",
    [
      `name: ${yamlString(bundle.session.title)}`,
      "version: 1",
      `format: ${SKILL_PACK_FORMAT}`,
      `created_at: ${yamlString(new Date().toISOString())}`,
      `source_url: ${yamlString(startUrl(bundle))}`,
      `start_url: ${yamlString(startUrl(bundle))}`,
      "start_context_file: start-context.json",
      "auth:",
      "  mode: existing_browser_session",
      "  cookie_policy: use_available_cookies_without_exporting",
      "  credential_policy: never_request_or_store_passwords",
      "  fallback: stop_and_ask_for_authenticated_browser_context",
      "learning:",
      "  write_back_policy: additive_only",
      "  protected_files:",
      "    - trajectory.jsonl",
      "    - agent-instructions.md",
      "  append_only_files:",
      "    - learning-notes.jsonl",
      "  durable_memory_file: workflow-memory.md",
      "risk_policy:",
      "  stop_before_high_risk_actions: true",
      "  learning_notes_must_not_weaken_safety: true",
      ""
    ].join("\n")
  );
  zip.file("agent-instructions.md", generateAgentInstructions());
  zip.file("start-context.json", generateStartContextJson(bundle));
  zip.file("task-brief.md", generateTaskBrief(bundle));
  zip.file("human-guide.md", generateHumanGuide(bundle));
  zip.file("agent-task.md", generateAgentTask(bundle));
  zip.file("trajectory.jsonl", generateTrajectoryJsonl(bundle));
  zip.file("learning-notes.jsonl", "");
  zip.file("learning-notes.schema.json", generateLearningNotesSchema());
  zip.file("workflow-memory.md", generateWorkflowMemory(bundle));
  zip.file("replay.playwright.ts", generatePlaywright(bundle));
  zip.file("replay.devtools.json", generateDevtoolsRecorderJson(bundle));
  zip.file("selectors/browser-selectors.json", generateSelectorsJson(bundle));
  zip.file("validations.yaml", generateValidationsYaml(bundle));

  const screenshots = byActionId(bundle.screenshots);
  bundle.actions.forEach((action, index) => {
    const screenshot = screenshots.get(action.id);
    if (screenshot) {
      zip.file(screenshotPath(index + 1), dataUrlBase64(screenshot.dataUrl), { base64: true });
    }
  });

  return zip;
}

export async function generateSkillPack(bundle: SessionBundle) {
  return createSkillPackZip(bundle).generateAsync({ type: "blob" });
}

export async function generateSkillPackBase64(bundle: SessionBundle) {
  return createSkillPackZip(bundle).generateAsync({ type: "base64" });
}

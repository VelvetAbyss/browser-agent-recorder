import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  generateAgentInstructions,
  generateDevtoolsRecorderJson,
  generateHumanGuide,
  generatePlaywright,
  generateSkillPackBase64,
  generateStartContextJson,
  generateTaskBrief,
  generateTrajectoryJsonl,
  generateValidationsYaml
} from "./exporters";
import type { SessionBundle } from "./types";

const bundle: SessionBundle = {
  session: {
    id: "session_1",
    title: "Login workflow",
    summary: "Sign in to the app.",
    status: "idle",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    startUrl: "https://example.com/login",
    actionCount: 1
  },
  actions: [
    {
      id: "action_1",
      sessionId: "session_1",
      stepNumber: 1,
      type: "input",
      page: { url: "https://example.com/login", domain: "example.com", title: "Login" },
      target: {
        tagName: "input",
        placeholder: "Email",
        selector: "input[name=\"email\"]",
        xpath: "/html/body/input[1]",
        selectorConfidence: 0.82,
        candidates: [{ kind: "placeholder", value: "Email", confidence: 0.82 }]
      },
      valuePolicy: "runtime",
      runtimeVariable: { name: "EMAIL" },
      sensitive: false,
      highRisk: false,
      title: "Enter email",
      description: "Type the account email.",
      createdAt: "2026-05-25T00:00:00.000Z"
    }
  ],
  screenshots: [
    {
      id: "shot_1",
      sessionId: "session_1",
      actionId: "action_1",
      stepNumber: 1,
      dataUrl: "data:image/png;base64,AAAA",
      path: "screenshots/step-001.png",
      createdAt: "2026-05-25T00:00:00.000Z"
    }
  ]
};

describe("exporters", () => {
  it("generates a human guide with runtime warning and screenshot reference", () => {
    const guide = generateHumanGuide(bundle);
    expect(guide).toContain("# Login workflow");
    expect(guide).toContain("Runtime variable required: EMAIL");
    expect(guide).toContain("screenshots/step-001.png");
  });

  it("generates jsonl trajectory", () => {
    const lines = generateTrajectoryJsonl(bundle).split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "start_context",
      url: "https://example.com/login",
      instruction: "Open this page before executing the recorded actions."
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      type: "recorded_action",
      step_number: 1,
      runtime_variable_name: "EMAIL",
      auth_policy: "use_existing_session_only",
      write_back_policy: "append_observations_to_learning_notes_only"
    });
  });

  it("generates explicit start context", () => {
    expect(JSON.parse(generateStartContextJson(bundle))).toMatchObject({
      type: "start_context",
      url: "https://example.com/login",
      domain: "example.com",
      auth_policy: "use_existing_session_only"
    });
  });

  it("generates universal agent instructions with controlled learning rules", () => {
    const instructions = generateAgentInstructions();
    expect(instructions).toContain("Your job is not to blindly replay clicks");
    expect(instructions).toContain("Controlled Learning and Write-Back Policy");
    expect(instructions).toContain("Append JSON objects to `learning-notes.jsonl`");
  });

  it("generates a task brief with authentication policy", () => {
    const brief = generateTaskBrief(bundle);
    expect(brief).toContain("## Authentication Policy");
    expect(brief).toContain("use existing authenticated browser context");
    expect(brief).toContain("EMAIL");
  });

  it("generates Playwright with env variables and locator preference", () => {
    const code = generatePlaywright(bundle);
    expect(code).toContain("page.getByPlaceholder('Email')");
    expect(code).toContain("process.env.EMAIL");
  });

  it("generates Chrome DevTools Recorder JSON", () => {
    const parsed = JSON.parse(generateDevtoolsRecorderJson(bundle));
    expect(parsed.title).toBe("Login workflow");
    expect(parsed.steps[0].type).toBe("setViewport");
    expect(parsed.steps[1]).toMatchObject({ type: "navigate", url: "https://example.com/login" });
    const change = parsed.steps.find((step: { type: string }) => step.type === "change");
    expect(change.value).toBe("{{EMAIL}}");
    expect(change.selectors[0]).toEqual(["aria/Email"]);
  });

  it("generates validations yaml", () => {
    expect(generateValidationsYaml(bundle)).toContain("require_visible_target: true");
  });

  it("generates a skill pack zip with manifest and screenshots", async () => {
    const base64 = await generateSkillPackBase64(bundle);
    const zip = await JSZip.loadAsync(base64, { base64: true });
    expect(zip.file("manifest.yaml")).toBeTruthy();
    expect(zip.file("agent-instructions.md")).toBeTruthy();
    expect(zip.file("start-context.json")).toBeTruthy();
    expect(zip.file("task-brief.md")).toBeTruthy();
    expect(zip.file("human-guide.md")).toBeTruthy();
    expect(zip.file("learning-notes.jsonl")).toBeTruthy();
    expect(zip.file("learning-notes.schema.json")).toBeTruthy();
    expect(zip.file("workflow-memory.md")).toBeTruthy();
    expect(zip.file("screenshots/step-001.png")).toBeTruthy();
    const manifest = await zip.file("manifest.yaml")!.async("string");
    expect(manifest).toContain("browser-agent-recorder.skill-pack.v2");
    expect(manifest).toContain("start_url: \"https://example.com/login\"");
    expect(manifest).toContain("start_context_file: start-context.json");
    expect(manifest).toContain("write_back_policy: additive_only");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { SECTION, STATE_TYPE } from "../extensions/workflow.ts";

// Real Pi loader/session, isolated configuration, no model request or user credentials.
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "pi-engineering-check-"));
let dispose: (() => void) | undefined;
try {
  const settingsManager = SettingsManager.inMemory({ packages: [packageRoot] });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: join(scratch, "agent"),
    settingsManager,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(loader.getExtensions().extensions.length, 1);
  assert.equal(loader.getSkills().skills.some(skill => skill.name === "engineering-delivery"), true);
  assert.deepEqual(loader.getSkills().diagnostics, []);
  const { session } = await createAgentSession({
    cwd: scratch, agentDir: join(scratch, "agent"),
    settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(scratch), noTools: "all"
  });
  dispose = () => session.dispose();
  const runner = session.extensionRunner;
  assert.ok(runner.getCommand("engineering"));
  await runner.emit({ type: "session_start", reason: "startup" });
  const options = { cwd: scratch, sections: { other_extension: "preserved" } };
  const result = await runner.emitBeforeAgentStart("Implement CSV export", undefined, options);
  assert.equal(result.systemPromptOptions.sections.other_extension, "preserved");
  assert.match(result.systemPromptOptions.sections[SECTION], /Engineering Playbook/);
  session.sessionManager.appendCustomEntry(STATE_TYPE, { version: 1, enabled: false });
  await runner.emit({ type: "session_start", reason: "reload" });
  const disabled = await runner.emitBeforeAgentStart("Small edit", undefined, options);
  assert.equal(SECTION in disabled.systemPromptOptions.sections, false);
  console.log("Pi host check passed: package discovery, TypeScript loading, command, skill, prompt, and persisted disable.");
} finally {
  dispose?.();
  await rm(scratch, { recursive: true, force: true });
}

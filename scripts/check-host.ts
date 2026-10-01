import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  session.sessionManager.appendCustomEntry(STATE_TYPE, { version: 1, enabled: true });
  await runner.emit({ type: "session_start", reason: "reload" });
  const blocked = await runner.emitToolCall({ type: "tool_call", toolName: "write", toolCallId: "blocked-write", input: { path: "check.mjs", content: "unchecked" } });
  assert.equal(blocked?.block, true);
  await promisify(execFile)("git", ["init"], { cwd: scratch });
  await writeFile(join(scratch,"check.mjs"), "import assert from 'node:assert/strict'; assert.equal(2+2,4);\n");
  const tool = runner.getToolDefinition("engineering_workflow")!;
  assert.ok(tool);
  const context = runner.createToolContext("workflow", undefined);
  const execute = (args: unknown) => tool.execute("workflow", args, undefined, undefined, context);
  await execute({ action: "plan", slices: [{ id:"V1",kind:"vertical",outcome:"Real check passes",acceptance:["CLI assertion passes"],dependsOn:[],checks:[{id:"cli",command:"node check.mjs",kind:"integration"}] }] });
  await execute({ action: "start", sliceId: "V1" });
  await assert.rejects(execute({ action: "complete" }),/Completion blocked/);
  const verified = await execute({ action: "verify" });
  assert.match(JSON.stringify(verified.content),/passed/);
  const completed = await execute({ action: "complete" });
  assert.match(JSON.stringify(completed.content),/verified/);
  console.log("Pi host check passed: package/skill loading, persisted mode, real tool-call block, real verification execution, and completion gate.");
} finally {
  dispose?.();
  await rm(scratch, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import engineeringPlaybook from "../extensions/index.ts";
import { SECTION, STATE_TYPE, parseCommand, restoreEnabled, workflowPrompt } from "../extensions/workflow.ts";

function harness(initialEntries: unknown[] = []) {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let idle = true;
  let entries = initialEntries;
  const messages: { content: string; options: unknown }[] = [];
  const notices: { text: string; type: string }[] = [];
  const statuses: string[] = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); },
    registerCommand(_name: string, options: { handler: typeof command }) { command = options.handler; },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    sendUserMessage(content: string, options: unknown) { messages.push({ content, options }); }
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    ui: {
      notify(text: string, type: string) { notices.push({ text, type }); },
      setStatus(_key: string, text: string) { statuses.push(text); }
    },
    sessionManager: { getBranch() { return entries; } },
    isIdle() { return idle; }
  } as unknown as ExtensionCommandContext;
  engineeringPlaybook(pi);
  const event = { systemPrompt: "Original host prompt", systemPromptOptions: { sections: { existing: "keep me" } } };
  return {
    messages, notices, statuses, event,
    run: (args: string) => command(args, ctx),
    emit: (name: string) => handlers.get(name)!({}, ctx),
    inject: () => handlers.get("before_agent_start")!(event, ctx),
    setIdle(value: boolean) { idle = value; },
    setEntries(value: unknown[]) { entries = value; },
    entries: () => entries
  };
}

test("commands preserve multiline scope and reject missing/unknown actions", () => {
  assert.deepEqual(parseCommand(" PLAN export\nwith date filtering "), { kind: "workflow", action: "plan", objective: "export\nwith date filtering" });
  for (const input of ["build", "review", "release", "wat", "off extra"]) assert.equal(parseCommand(input).kind, "invalid");
  assert.deepEqual(parseCommand(""), { kind: "help" });
});

test("restoration ignores unrelated, malformed, and unsupported state", () => {
  assert.equal(restoreEnabled([null, { type: "custom", customType: "other", data: { version: 1, enabled: false } }]), true);
  assert.equal(restoreEnabled([
    { type: "custom", customType: STATE_TYPE, data: { version: 1, enabled: false } },
    { type: "custom", customType: STATE_TYPE, data: { version: 2, enabled: true } },
    { type: "custom", customType: STATE_TYPE, data: { version: 1, enabled: "true" } }
  ]), false);
});

test("default injection preserves the host and unrelated sections", () => {
  const h = harness(); h.emit("session_start"); h.inject();
  assert.equal(h.event.systemPrompt, "Original host prompt");
  assert.equal(h.event.systemPromptOptions.sections.existing, "keep me");
  assert.match((h.event.systemPromptOptions.sections as Record<string,string>)[SECTION], /vertical|horizontal/);
});

test("off persists and removes only the extension's own section", async () => {
  const h = harness(); h.inject(); await h.run("off"); h.inject();
  assert.equal(SECTION in h.event.systemPromptOptions.sections, false);
  assert.equal(h.event.systemPromptOptions.sections.existing, "keep me");
  assert.equal(restoreEnabled(h.entries()), false);
  const restarted = harness(h.entries()); restarted.emit("session_start"); restarted.inject();
  assert.equal(SECTION in restarted.event.systemPromptOptions.sections, false);
});

test("tree navigation restores the selected branch rather than the abandoned branch", async () => {
  const h = harness(); await h.run("off");
  h.setEntries([]); h.emit("session_tree"); h.inject();
  assert.equal(SECTION in h.event.systemPromptOptions.sections, true);
  h.setEntries([{ type: "custom", customType: STATE_TYPE, data: { version: 1, enabled: false } }]);
  h.emit("session_tree"); h.inject();
  assert.equal(SECTION in h.event.systemPromptOptions.sections, false);
});

test("workflow command enables the skill and sends literal user scope exactly once", async () => {
  const h = harness(); await h.run("off"); await h.run("build Fix reload\n/other-command secret");
  assert.equal(restoreEnabled(h.entries()), true);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.messages[0].options, { expandPromptTemplates: false });
  assert.match(h.messages[0].content, /Fix reload\n\/other-command secret$/);
  assert.match(h.messages[0].content, /Implement and verify/);
});

test("busy runs reject changes without mutating state or queueing workflow", async () => {
  const h = harness(); h.setIdle(false); await h.run("off"); await h.run("build fix");
  assert.equal(h.entries().length, 0); assert.equal(h.messages.length, 0);
  assert.equal(h.notices.length, 2); assert.equal(h.notices[0].type, "warning");
});

test("help/status/invalid commands do not start a model turn", async () => {
  const h = harness(); await h.run(""); await h.run("status"); await h.run("release");
  assert.equal(h.messages.length, 0); assert.equal(h.entries().length, 0);
  assert.match(h.notices[0].text, /\/engineering plan/);
  assert.match(h.notices[1].text, /Playbook: on/);
});

test("plan and release retain their requested stopping points", () => {
  assert.match(workflowPrompt("plan", "CSV export", "/skill.md"), /Stop at a plan; do not implement/);
  assert.match(workflowPrompt("review", "diff", "/skill.md"), /Stop at the review/);
  assert.match(workflowPrompt("release", "v1", "/skill.md"), /do not publish, deploy, or apply production migrations/);
});

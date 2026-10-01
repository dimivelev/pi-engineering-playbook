import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HELP, SECTION, STATE_TYPE, parseCommand, restoreEnabled, workflowContext, workflowPrompt } from "./workflow.ts";
import { GATE_STATE, READ_TOOLS, emptyState, missingChecks, pending, restoreGates, rootListing, startSlice, summary, validatePlan, workspaceFingerprint } from "./gates.ts";

const skillPath = fileURLToPath(new URL("../skills/engineering-delivery/SKILL.md", import.meta.url));

export default function engineeringPlaybook(pi: ExtensionAPI): void {
  let enabled = true;
  let gates = emptyState(process.cwd());
  let verifying = false;
  let inFlight = new Set<string>();
  let repairTurns = 0;
  let nextPlanningOnly = false;
  let planningOnly = false;

  function save(): void { pi.appendEntry(GATE_STATE, gates); }

  function updateStatus(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus("engineering-playbook", `Engineering: ${enabled ? "on" : "off"}`);
  }

  function restore(ctx: ExtensionContext): void {
    enabled = restoreEnabled(ctx.sessionManager.getBranch());
    gates = restoreGates(ctx.sessionManager.getBranch(), ctx.cwd);
    verifying = false; inFlight = new Set(); repairTurns = 0;
    updateStatus(ctx);
  }

  function setEnabled(value: boolean, ctx: ExtensionContext): void {
    enabled = value;
    pi.appendEntry(STATE_TYPE, { version: 1, enabled });
    updateStatus(ctx);
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", (event) => {
    repairTurns = 0;
    planningOnly = nextPlanningOnly; nextPlanningOnly = false;
    if (enabled) {
      // Add a dedicated section without replacing the host or other extensions' prompt.
      event.systemPromptOptions.sections[SECTION] = workflowContext(skillPath) + `\n\nRuntime gates are ON. Before edit/write, bash/powershell, or other non-read tools, use engineering_workflow plan then start. read/grep/find/ls and engineering_workflow status remain available for discovery. Use verify to execute planned checks, then complete with fresh passing evidence. Vertical slices require an integration/e2e check; horizontal slices require a consumer. Use blocked with a concrete reason if verification cannot run. Only the user can disable/reset these gates.\nCurrent gate state:\n${summary(gates)}`;
    } else {
      delete event.systemPromptOptions.sections[SECTION];
    }
  });

  pi.on("tool_call", (event) => {
    if (!enabled || READ_TOOLS.has(event.toolName) || event.toolName === "engineering_workflow") return;
    if (planningOnly) return { block: true, reason: "The user requested a plan only. Use read/grep/find/ls/status; no implementation or shell execution." };
    if (verifying) return { block: true, reason: "Verification is running. Wait before changing the workspace." };
    gates.demanded = true;
    if (!gates.active) {
      save();
      return { block: true, reason: "Runtime gate: register slices with engineering_workflow plan, then start one. Shell commands are gated too; use read/grep/find/ls/status for discovery." };
    }
    // Pessimistic invalidation: any non-read tool might mutate or start asynchronous work.
    gates.evidence = [];
    inFlight.add(event.toolCallId); save();
  });
  pi.on("tool_result", event => { inFlight.delete(event.toolCallId); });

  async function outstanding(ctx: ExtensionContext): Promise<string | undefined> {
    if (!enabled || planningOnly || !gates.demanded) return;
    if (pending(gates)) return summary(gates);
    if (gates.slices.some(s => s.status === "blocked")) return; // Honest blocked reports may stop.
    try {
      const missing = missingChecks(gates, await workspaceFingerprint(ctx.cwd));
      if (missing.length) return `Fresh passing checks missing: ${missing.join(", ")}.`;
    } catch (error) { return String(error); }
  }

  pi.on("message_end", async (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted" || message.content.some(c => c.type === "toolCall")) return;
    if (enabled && !planningOnly && gates.demanded && !pending(gates) && gates.slices.some(s => s.status === "blocked")) {
      return { message: { ...message, content: [{ type: "text" as const, text: `Engineering workflow is blocked; full completion is not verified.\n${summary(gates)}` }] } };
    }
    const gap = await outstanding(ctx);
    if (!gap) return;
    // Replace an unchecked final answer rather than trying to classify wording such as "done".
    return { message: { ...message, content: [{ type: "text" as const, text: `Engineering workflow is incomplete; no verified completion is recorded.\n${gap}\nRun engineering_workflow verify/complete, or report a concrete blocker. The unchecked final answer was withheld.` }] } };
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed" || !event.context.canContinue) return;
    const gap = await outstanding(ctx);
    if (!gap) return;
    const retry = repairTurns++ < 2;
    return { continue: retry, entries: [{ type: "custom_message" as const, customType: "engineering-playbook:gate-report", display: true,
      content: retry ? `Complete the runtime workflow or explicitly block affected slices. ${gap}` : `Stopped after two repair turns. Workflow remains incomplete: ${gap}` }] };
  });

  const checkSchema = Type.Object({ id: Type.String(), command: Type.String(), kind: Type.Union([Type.Literal("unit"), Type.Literal("integration"), Type.Literal("e2e")]) });
  pi.registerTool({
    name: "engineering_workflow", label: "Engineering workflow gates",
    description: "Runtime-enforced engineering plan/start/verify/complete/blocked/status. Verification executes exact planned shell commands and records real exits plus Git-tree fingerprints. Caller-supplied success/evidence is never accepted. Only user /engineering off/reset disables/resets gates.",
    executionMode: "sequential",
    parameters: Type.Object({
      action: Type.Union(["plan", "start", "verify", "complete", "blocked", "status"].map(s => Type.Literal(s))),
      sliceId: Type.Optional(Type.String()), reason: Type.Optional(Type.String()),
      slices: Type.Optional(Type.Array(Type.Object({ id: Type.String(), kind: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical"), Type.Literal("spike")]), outcome: Type.String(), acceptance: Type.Array(Type.String()), dependsOn: Type.Array(Type.String()), consumer: Type.Optional(Type.String()), checks: Type.Array(checkSchema) })))
    }),
    execute: async (_id, args, signal, _onUpdate, ctx) => {
      if (verifying || inFlight.size) throw Error("Wait for outstanding tool executions before changing workflow state or verifying.");
      const answer = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
      if (args.action === "status") return answer(`${summary(gates)}\nProject entries: ${(await rootListing(ctx.cwd)).join(", ")}`);
      if (!enabled) throw Error("Workflow is off. The user must enable it with /engineering on.");
      if (planningOnly && args.action !== "plan") throw Error("Plan-only scope: register the plan and stop. Implementation/verification was not requested.");
      if (args.action === "plan") {
        if (gates.slices.length) throw Error("A plan already exists. Preserve it; only the user can /engineering reset.");
        gates = { ...emptyState(ctx.cwd), demanded: true, slices: validatePlan(args.slices ?? []) }; save();
      } else if (args.action === "start") {
        startSlice(gates, args.sliceId ?? ""); save();
      } else if (args.action === "blocked") {
        const slice = gates.slices.find(s => s.id === (args.sliceId ?? gates.active));
        if (!slice || !args.reason?.trim()) throw Error("Name an existing slice and concrete blocker.");
        slice.status = "blocked"; slice.blockedReason = args.reason;
        if (gates.active === slice.id) gates.active = undefined;
        gates.evidence = []; save();
      } else if (args.action === "verify") {
        if (!gates.slices.length) throw Error("Register the plan first.");
        const eligible = gates.slices.filter(s => s.id === gates.active || s.status === "verified");
        const selected = args.sliceId ? eligible.filter(s => s.id === args.sliceId) : eligible;
        if (!selected.length) throw Error("Start the slice before running verification commands. Only active or previously verified slices are eligible.");
        verifying = true;
        const reports: string[] = [];
        try {
          for (const slice of selected) for (const check of slice.checks) {
            const before = await workspaceFingerprint(ctx.cwd);
            // Remove previous success before execution; a failed rerun must not retain it.
            gates.evidence = gates.evidence.filter(e => !(e.sliceId === slice.id && e.checkId === check.id)); save();
            const result = await pi.exec("bash", ["-lc", check.command], { cwd: ctx.cwd, signal, timeout: 300000 });
            const after = await workspaceFingerprint(ctx.cwd);
            const passed = result.code === 0 && !result.killed && !signal?.aborted && before === after;
            if (passed) gates.evidence.push({ sliceId: slice.id, checkId: check.id, command: check.command, code: 0, fingerprint: after, at: new Date().toISOString() });
            save();
            reports.push(`${slice.id}/${check.id}: ${passed ? "passed" : "FAILED/unverified"}; exit=${result.code}${before !== after ? "; workspace changed during check; rerun required" : ""}\n${(result.stdout + result.stderr).slice(-4000)}`);
            if (signal?.aborted) break;
          }
        } finally { verifying = false; }
        return answer(reports.join("\n\n"));
      } else if (args.action === "complete") {
        const id = args.sliceId ?? gates.active;
        if (!id || id !== gates.active) throw Error("Complete the active slice only.");
        const missing = missingChecks(gates, await workspaceFingerprint(ctx.cwd));
        if (missing.length) throw Error(`Completion blocked: run fresh checks for ${missing.join(", ")}. Use verify without sliceId to recheck integrated work.`);
        gates.slices.find(s => s.id === id)!.status = "verified";
        gates.active = undefined; save();
      }
      return answer(summary(gates));
    }
  });

  pi.registerCommand("engineering", {
    description: "Engineering workflow: on/off/status/reset, plan, build, review, release",
    handler: async (args, ctx) => {
      const command = parseCommand(args);
      if (command.kind === "invalid") {
        ctx.ui.notify(command.message, "warning");
        return;
      }
      if (command.kind === "help") {
        ctx.ui.notify(HELP, "info");
        return;
      }
      if (command.kind === "status") {
        ctx.ui.notify(`Engineering Playbook: ${enabled ? "on" : "off"}\n${summary(gates)}\nSkill: ${skillPath}`, "info");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before changing or starting the engineering workflow.", "warning");
        return;
      }
      if (command.kind === "on" || command.kind === "off") {
        setEnabled(command.kind === "on", ctx);
        ctx.ui.notify(`Engineering Playbook: ${enabled ? "on" : "off"}`, "info");
        return;
      }
      if (command.kind === "reset") {
        gates = emptyState(ctx.cwd); inFlight.clear(); save();
        ctx.ui.notify("Engineering plan reset by user.", "info"); return;
      }
      if (command.kind === "workflow") {
        if (!enabled) setEnabled(true, ctx);
        nextPlanningOnly = command.action === "plan";
        // Literal message: objective text cannot dispatch another slash command/template.
        pi.sendUserMessage(workflowPrompt(command.action, command.objective, skillPath), {
          expandPromptTemplates: false
        });
      }
    }
  });
}

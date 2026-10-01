import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HELP, SECTION, STATE_TYPE, parseCommand, restoreEnabled, workflowContext, workflowPrompt } from "./workflow.ts";

const skillPath = fileURLToPath(new URL("../skills/engineering-delivery/SKILL.md", import.meta.url));

export default function engineeringPlaybook(pi: ExtensionAPI): void {
  let enabled = true;

  function updateStatus(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus("engineering-playbook", `Engineering: ${enabled ? "on" : "off"}`);
  }

  function restore(ctx: ExtensionContext): void {
    enabled = restoreEnabled(ctx.sessionManager.getBranch());
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
    if (enabled) {
      // Add a dedicated section without replacing the host or other extensions' prompt.
      event.systemPromptOptions.sections[SECTION] = workflowContext(skillPath);
    } else {
      delete event.systemPromptOptions.sections[SECTION];
    }
  });

  pi.registerCommand("engineering", {
    description: "Engineering workflow: on/off/status, plan, build, review, release",
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
        ctx.ui.notify(`Engineering Playbook: ${enabled ? "on" : "off"}\nSkill: ${skillPath}`, "info");
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
      if (command.kind === "workflow") {
        if (!enabled) setEnabled(true, ctx);
        // Literal message: objective text cannot dispatch another slash command/template.
        pi.sendUserMessage(workflowPrompt(command.action, command.objective, skillPath), {
          expandPromptTemplates: false
        });
      }
    }
  });
}

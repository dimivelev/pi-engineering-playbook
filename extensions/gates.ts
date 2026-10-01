import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const GATE_STATE = "engineering-playbook:gates";
export const READ_TOOLS = new Set(["read", "grep", "find", "ls", "engineering_issues"]);
export interface Check { id: string; command: string; kind: "unit" | "integration" | "e2e"; }
export interface Slice {
  id: string;
  kind: "horizontal" | "vertical" | "spike";
  outcome: string;
  acceptance: string[];
  dependsOn: string[];
  consumer?: string;
  issueUrl?: string;
  checks: Check[];
  status?: "planned" | "verified" | "blocked";
  blockedReason?: string;
}
export interface Evidence { sliceId: string; checkId: string; command: string; code: number; fingerprint: string; at: string; }
export interface GateState { version: 1; cwd: string; slices: Slice[]; active?: string; evidence: Evidence[]; demanded: boolean; }

export function emptyState(cwd: string): GateState {
  return { version: 1, cwd, slices: [], evidence: [], demanded: false };
}

export function validatePlan(slices: Slice[]): Slice[] {
  if (!Array.isArray(slices) || !slices.length || slices.length > 50) throw Error("Supply 1–50 verifiable slices.");
  const ids = new Set(slices.map(s => s.id));
  if (ids.size !== slices.length) throw Error("Slice IDs must be unique.");
  for (const s of slices) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)) throw Error("Use simple slice IDs (letters, digits, underscore, hyphen).");
    if (!["horizontal", "vertical", "spike"].includes(s.kind) || !s.outcome?.trim() || !s.acceptance?.length || s.acceptance.some(a => !a.trim())) throw Error(`Missing outcome/acceptance: ${s.id}`);
    if (!s.checks?.length || s.checks.length > 20 || s.checks.some(c => !c.id?.trim() || !c.command?.trim() || !["unit", "integration", "e2e"].includes(c.kind))) throw Error(`Missing runnable checks: ${s.id}`);
    if (new Set(s.checks.map(c => c.id)).size !== s.checks.length) throw Error(`Duplicate check IDs: ${s.id}`);
    if (s.kind === "horizontal" && !s.consumer?.trim()) throw Error(`Name the consumer/integration checkpoint for horizontal slice ${s.id}.`);
    if (s.kind === "vertical" && !s.checks.some(c => c.kind === "integration" || c.kind === "e2e")) throw Error(`Vertical slice ${s.id} needs an integration or end-to-end check.`);
    if (s.issueUrl && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(s.issueUrl)) throw Error(`Use a canonical GitHub issue URL: ${s.id}`);
    if (!Array.isArray(s.dependsOn) || s.dependsOn.some(id => id === s.id || !ids.has(id))) throw Error(`Invalid dependencies: ${s.id}`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw Error("Slice dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id); slices.find(s => s.id === id)!.dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  slices.forEach(s => visit(s.id));
  // Only plan fields are accepted: callers cannot supply status or fabricated evidence.
  return slices.map(s => ({ id: s.id, kind: s.kind, outcome: s.outcome, acceptance: [...s.acceptance], dependsOn: [...s.dependsOn], consumer: s.consumer, issueUrl: s.issueUrl, checks: s.checks.map(c => ({...c})), status: "planned" }));
}

export function restoreGates(entries: readonly unknown[], cwd: string): GateState {
  let state = emptyState(cwd);
  for (const entry of entries) {
    const e = entry as { type?: string; customType?: string; data?: GateState } | null;
    if (e?.type !== "custom" || e.customType !== GATE_STATE || e.data?.version !== 1 || e.data.cwd !== cwd) continue;
    try {
      if (Array.isArray(e.data.slices) && e.data.slices.length === 0) {
        state = { ...emptyState(cwd), demanded: Boolean(e.data.demanded) };
        continue;
      }
      const clean = validatePlan(e.data.slices);
      state = { ...emptyState(cwd), slices: clean.map((s,i) => ({ ...s, status: e.data!.slices[i].status ?? "planned", blockedReason: e.data!.slices[i].blockedReason })), demanded: Boolean(e.data.demanded), active: e.data.active };
      // Evidence is intentionally not trusted across reload/tree navigation. Rerun checks.
      if (state.active && !state.slices.some(s => s.id === state.active)) state.active = undefined;
    } catch { state = emptyState(cwd); state.demanded = true; }
  }
  return state;
}

export function startSlice(state: GateState, id: string, strict = true): void {
  if (state.active && state.active !== id) throw Error(`Finish or explicitly block active slice ${state.active} first.`);
  const slice = state.slices.find(s => s.id === id);
  if (!slice) throw Error(`Unknown slice: ${id}`);
  if (strict && slice.dependsOn.some(d => state.slices.find(s => s.id === d)?.status !== "verified")) throw Error("Verify prerequisite slices first.");
  slice.status = "planned"; delete slice.blockedReason;
  state.active = id; state.demanded = true; state.evidence = [];
}

export function missingChecks(state: GateState, fingerprint: string): string[] {
  const needed = state.slices.filter(s => s.status === "verified" || s.id === state.active);
  return needed.flatMap(s => s.checks.filter(c => !state.evidence.some(e => e.sliceId === s.id && e.checkId === c.id && e.command === c.command && e.code === 0 && e.fingerprint === fingerprint)).map(c => `${s.id}/${c.id}`));
}

export function pending(state: GateState): boolean {
  return state.demanded && (!state.slices.length || state.slices.some(s => s.status === "planned"));
}

export function summary(state: GateState): string {
  if (!state.slices.length) return state.demanded ? "Unverified: register a plan and active slice." : "No engineering work started.";
  return state.slices.map(s => `${s.id}: ${s.status}${state.active === s.id ? " (active)" : ""}${s.issueUrl ? ` [${s.issueUrl}]` : ""}${s.blockedReason ? ` — ${s.blockedReason}` : ""}`).join("\n");
}

/** Hash HEAD plus tracked and nonignored files. Failure is closed, not a fake clean state. */
export async function workspaceFingerprint(cwd: string): Promise<string> {
  let root: string;
  try { root = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd })).stdout.trim(); }
  catch { throw Error("Runtime verification gates require a Git working tree. Initialize Git or use /engineering off for advisory work."); }
  const [head, listing] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).then(r => r.stdout.trim()).catch(() => "unborn"),
    execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  ]);
  const hash = createHash("sha256").update(root).update(head);
  const paths = [...new Set(listing.stdout.split("\0").filter(Boolean))].sort();
  for (const path of paths) {
    hash.update(path).update("\0");
    try {
      const absolute = join(root,path), stat = await lstat(absolute);
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink()) hash.update(await readlink(absolute));
      else if (stat.isFile()) hash.update(await readFile(absolute));
      else throw Error(`Unsupported tracked path: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") hash.update("deleted");
      else throw error;
    }
  }
  return hash.digest("hex");
}

export async function rootListing(cwd: string): Promise<string[]> {
  return (await readdir(cwd)).slice(0,100);
}

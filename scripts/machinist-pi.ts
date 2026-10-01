import { spawn } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateResult(text: string): {outcome:"complete"|"blocked"|"failed";summary:string;approval_required?:boolean} {
  if (Buffer.byteLength(text,"utf8") > 16*1024) throw Error("Machinist result exceeds 16 KiB.");
  const result=JSON.parse(text);
  if (!result || !["complete","blocked","failed"].includes(result.outcome) || typeof result.summary !== "string" || !result.summary.trim() || (result.approval_required !== undefined && typeof result.approval_required !== "boolean")) throw Error("Invalid Machinist outcome/summary/approval_required.");
  return result;
}

/** Machinist owns stage advancement; this adapter owns one Pi process and its result contract. */
export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const stage=argv[0] ?? "build";
  if (!["plan","build","review"].includes(stage)) throw Error("Use plan, build, or review as the first argument.");
  const resultPath=env.MACHINIST_STEP_RESULT_PATH;
  if (!resultPath) throw Error("MACHINIST_STEP_RESULT_PATH is required; use ordinary pi for interactive work.");
  try { await unlink(resultPath); } catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let brief="";
  for await (const chunk of process.stdin) brief+=String(chunk);
  const contract=`\n\nMachinist stage: ${stage}. Use the bundled Engineering Delivery skill with advisory behavior. Honor the user's scope. Read existing issues and linked PRs when applicable; preserve effects from earlier attempts. Do not merge or deploy unless explicitly authorized.\nBefore exiting, write one JSON object to ${JSON.stringify(resultPath)} with outcome complete, blocked, or failed and a nonempty summary. Use complete only for this stage's actual acceptance criteria; plan complete means a reviewable plan, not implementation completion. Missing required verification blocks delivery advancement, but finish independent work and preserve a useful report first. Never turn an unverified check into a passing result.\nShared deliverables directory: ${JSON.stringify(env.MACHINIST_OUTPUT_DIR ?? "not configured")}. Keep plan/report/check results and issue links there when configured; keep temporary files in MACHINIST_SCRATCH_DIR. Use engineering_workflow handoff for substantial recorded work, then copy its relevant evidence into the report. Include exact missing capabilities and recovery steps in blocked summaries. Do not repeatedly retry unchanged setup failures.\n`;
  const extension=fileURLToPath(new URL("../extensions/index.ts",import.meta.url));
  const child=spawn(env.PI_ENGINEERING_PI_BINARY ?? "pi",["--print","--no-extensions","--extension",extension,...argv.slice(1)],{env,stdio:["pipe","inherit","inherit"]});
  const terminate=()=>{child.kill("SIGTERM");};
  process.on("SIGTERM",terminate); process.on("SIGINT",terminate);
  child.stdin.on("error",()=>{}); // An early failed process may close stdin.
  child.stdin.end(brief+contract);
  let code:number;
  try {
    code=await new Promise<number>((resolveCode,reject)=>{
      child.once("error",reject);
      child.once("close",(exit,signal)=>resolveCode(exit ?? (signal ? 128 : 1)));
    });
  } finally {
    process.off("SIGTERM",terminate); process.off("SIGINT",terminate);
  }
  if (code !== 0) return code;
  if ((await stat(resultPath)).size > 16*1024) throw Error("Machinist result exceeds 16 KiB.");
  validateResult(await readFile(resultPath,"utf8"));
  return 0; // blocked/failed task outcomes remain distinct from process success.
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode=await run(process.argv.slice(2)); }
  catch(error) { process.stderr.write(`Machinist Pi adapter: ${String(error)}\n`); process.exitCode=1; }
}

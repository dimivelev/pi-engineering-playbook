import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import { GATE_STATE, emptyState, missingChecks, restoreGates, startSlice, validatePlan, workspaceFingerprint, type Slice } from "../extensions/gates.ts";

const exec = promisify(execFile);
const slice = (id = "V1", kind: Slice["kind"] = "vertical"): Slice => ({ id, kind, outcome: "CLI returns the right answer", acceptance: ["Output equals 42"], dependsOn: [], consumer: kind === "horizontal" ? "V1" : undefined, checks: [{ id: "cli", command: "node app.mjs", kind: "integration" }] });

test("plan rejects cycles, missing horizontal consumers and unintegrated vertical work", () => {
  const a = slice("A"), b = slice("B"); a.dependsOn = ["B"]; b.dependsOn = ["A"];
  assert.throws(() => validatePlan([a,b]), /cycle/);
  assert.throws(() => validatePlan([{ ...slice("H", "horizontal"), consumer: "" }]), /consumer/);
  assert.throws(() => validatePlan([{ ...slice(), checks: [{ id: "unit", command: "node test.mjs", kind: "unit" }] }]), /integration/);
  assert.equal(validatePlan([{...slice(),status:"verified"}])[0].status,"planned");
});

test("one active slice and verified dependencies are required", () => {
  const state = emptyState("/project"); const b = slice("B"); b.dependsOn = ["A"];
  state.slices = validatePlan([slice("A"),b]);
  assert.throws(() => startSlice(state,"B"), /prerequisite/);
  startSlice(state,"A"); assert.throws(() => startSlice(state,"B"), /active slice/);
});

test("caller claims, stale fingerprints, and failed results never satisfy completion", () => {
  const state = emptyState("/p"); state.slices = validatePlan([slice()]); startSlice(state,"V1");
  assert.deepEqual(missingChecks(state,"new"),["V1/cli"]);
  state.evidence = [{sliceId:"V1",checkId:"cli",command:"node app.mjs",code:0,fingerprint:"old",at:"now"}];
  assert.deepEqual(missingChecks(state,"new"),["V1/cli"]);
  state.evidence[0].fingerprint="new"; state.evidence[0].code=1;
  assert.deepEqual(missingChecks(state,"new"),["V1/cli"]);
});

test("restored plans lose evidence and are isolated to their project", () => {
  const state = emptyState("/p"); state.slices=validatePlan([slice()]); state.demanded=true;
  state.evidence=[{sliceId:"V1",checkId:"cli",command:"node app.mjs",code:0,fingerprint:"f",at:"now"}];
  const entries=[{type:"custom",customType:GATE_STATE,data:state}];
  assert.deepEqual(restoreGates(entries,"/p").evidence,[]);
  assert.deepEqual(restoreGates(entries,"/other").slices,[]);
  assert.equal(restoreGates([{type:"custom",customType:GATE_STATE,data:emptyState("/p")}],"/p").demanded,false);
});

function wire(cwd: string) {
  const handlers = new Map<string, (event: any,ctx: ExtensionContext) => any>();
  let tool: any, command: any;
  const entries: any[]=[];
  const ctx={cwd,hasUI:false,isIdle:()=>true,sessionManager:{getBranch:()=>entries},ui:{notify(){},setStatus(){}}} as unknown as ExtensionCommandContext;
  const pi={on:(name:string,fn:any)=>handlers.set(name,fn),registerTool:(t:any)=>tool=t,registerCommand:(_n:string,t:any)=>command=t,
    appendEntry:(customType:string,data:any)=>entries.push({type:"custom",customType,data:structuredClone(data)}),
    sendUserMessage(){},
    exec:async(c:string,args:string[],options:any)=>{ try { const r=await exec(c,args,{cwd:options.cwd,timeout:options.timeout,signal:options.signal,encoding:"utf8"}); return {...r,code:0,killed:false}; } catch(e:any){return {stdout:String(e.stdout??""),stderr:String(e.stderr??""),code:e.code,killed:Boolean(e.killed)};} }
  } as unknown as ExtensionAPI;
  extension(pi); handlers.get("session_start")!({},ctx);
  return { emit:(name:string,event:any)=>handlers.get(name)!(event,ctx), run:(args:any)=>tool.execute("wf",args,undefined,undefined,ctx), command:(args:string)=>command.handler(args,ctx) };
}

test("runtime blocks shell/custom mutation bypass before a plan; user can turn it off", async () => {
  const h=wire(process.cwd());
  for(const toolName of ["write","edit","bash","powershell","custom_writer"]){
    assert.equal(h.emit("tool_call",{toolName,toolCallId:toolName}).block,true);
  }
  assert.equal(h.emit("tool_call",{toolName:"read",toolCallId:"read"}),undefined);
  await h.command("off"); assert.equal(h.emit("tool_call",{toolName:"write",toolCallId:"off"}),undefined);
});

test("actual execution, stale changes, failed reruns, and plan replacement are enforced", async () => {
  const dir=await mkdtemp(join(tmpdir(),"pi-gates-"));
  try {
    await exec("git",["init"],{cwd:dir});
    await writeFile(join(dir,"app.mjs"),"console.log(42);\n");
    const h=wire(dir); await h.run({action:"plan",slices:[slice()]});
    await assert.rejects(h.run({action:"plan",slices:[slice()]}),/already exists/);
    await assert.rejects(h.run({action:"verify"}),/Start the slice/);
    await assert.rejects(h.run({action:"verify",sliceId:"V1"}),/Start the slice/);
    await h.run({action:"start",sliceId:"V1"});
    await assert.rejects(h.run({action:"complete"}),/Completion blocked/);
    await h.run({action:"verify"});
    await writeFile(join(dir,"app.mjs"),"process.exit(1);\n");
    await assert.rejects(h.run({action:"complete"}),/Completion blocked/);
    const report=await h.run({action:"verify"}); assert.match(report.content[0].text,/FAILED/);
    await assert.rejects(h.run({action:"complete"}),/Completion blocked/);
    await writeFile(join(dir,"app.mjs"),"console.log(42);\n"); await h.run({action:"verify"});
    assert.match((await h.run({action:"complete"})).content[0].text,/verified/);
    const fp=await workspaceFingerprint(dir); await writeFile(join(dir,"new-file"),"new source");
    assert.notEqual(await workspaceFingerprint(dir),fp);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("verification that changes the project cannot produce completion evidence", async () => {
  const dir=await mkdtemp(join(tmpdir(),"pi-gates-write-"));
  try {
    await exec("git",["init"],{cwd:dir}); await writeFile(join(dir,"app.mjs"),"old");
    const h=wire(dir), s=slice(); s.checks[0].command="printf changed > app.mjs";
    await h.run({action:"plan",slices:[s]}); await h.run({action:"start",sliceId:"V1"});
    assert.match((await h.run({action:"verify"})).content[0].text,/workspace changed/);
    await assert.rejects(h.run({action:"complete"}),/Completion blocked/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("unchecked final answers are replaced, retries bounded, honest blockers can stop", async () => {
  const h=wire(process.cwd()); h.emit("tool_call",{toolName:"write",toolCallId:"x"});
  const answer=await h.emit("message_end",{message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:"All done!"}]}});
  assert.match(answer.message.content[0].text,/incomplete/);
  const ev={outcome:"completed",context:{canContinue:true}};
  assert.equal((await h.emit("agent_before_settle",ev)).continue,true);
  assert.equal((await h.emit("agent_before_settle",ev)).continue,true);
  assert.equal((await h.emit("agent_before_settle",ev)).continue,false);
  await h.run({action:"plan",slices:[slice()]}); await h.run({action:"blocked",sliceId:"V1",reason:"Required service unavailable"});
  assert.equal(await h.emit("agent_before_settle",ev),undefined);
  const blocked=await h.emit("message_end",{message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:"All done!"}]}});
  assert.match(blocked.message.content[0].text,/full completion is not verified/);
});

test("plan command stops at a plan and prevents implementation", async () => {
  const h=wire(process.cwd());
  // Dispatch is literal, and this fixture need not start a model request.
  await h.command("plan Design CSV export");
  h.emit("before_agent_start",{systemPromptOptions:{sections:{}}});
  await h.run({action:"plan",slices:[slice()]});
  assert.equal(h.emit("tool_call",{toolName:"write",toolCallId:"plan-write"}).block,true);
  await assert.rejects(h.run({action:"start",sliceId:"V1"}),/Plan-only/);
  assert.equal(await h.emit("agent_before_settle",{outcome:"completed",context:{canContinue:true}}),undefined);
});

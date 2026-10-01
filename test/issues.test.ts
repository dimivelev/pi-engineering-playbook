import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerIssues } from "../extensions/issues.ts";
import { validatePlan } from "../extensions/gates.ts";

test("ticket discovery uses fixed read-only gh arguments; shell text and writes are never interpolated", async () => {
  let tool:any;
  const calls:{command:string,args:string[]}[]=[];
  registerIssues({registerTool(t:any){tool=t;},async exec(command:string,args:string[]){calls.push({command,args});return{code:0,killed:false,stdout:'[{"number":42,"state":"OPEN"}]',stderr:""};}} as unknown as ExtensionAPI);
  const run=(args:any)=>tool.execute("t",args,undefined,undefined,{cwd:process.cwd()});
  assert.equal((await run({action:"list",repo:"acme/app"})).details.available,true);
  assert.deepEqual(calls[0],{command:"gh",args:["issue","list","--state","open","--limit","30","--json","number,title,url,state,labels,assignees,updatedAt","--repo","acme/app"]});
  await run({action:"view",repo:"acme/app",number:42});
  assert.deepEqual(calls[1].args.slice(0,3),["issue","view","42"]);
  await assert.rejects(run({action:"list",repo:"acme/app; rm -rf /"}),/owner\/repository/);
  await assert.rejects(run({action:"view"}),/issue number/);
  assert.equal(calls.length,2);
});

test("missing gh or authentication is a useful lookup gap, not a global workflow block", async () => {
  let tool:any;
  registerIssues({registerTool(t:any){tool=t;},async exec(){throw Error("gh not installed");}} as unknown as ExtensionAPI);
  const result=await tool.execute("t",{action:"list"},undefined,undefined,{cwd:process.cwd()});
  assert.equal(result.details.available,false);
  assert.match(result.content[0].text,/local work can continue/);
  const s={id:"V1",kind:"vertical" as const,outcome:"Works",acceptance:["Works"],dependsOn:[],checks:[{id:"test",command:"npm test",kind:"integration" as const}],issueUrl:"https://evil.test/issues/42"};
  assert.throws(()=>validatePlan([s]),/canonical GitHub/);
});

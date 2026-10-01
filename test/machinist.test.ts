import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,writeFile,rm,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateResult } from "../scripts/machinist-pi.ts";

test("Machinist contract accepts honest blockers and rejects missing/invalid/oversized claims",()=>{
  assert.equal(validateResult('{"outcome":"blocked","summary":"uv missing; syntax passed; HTTP unverified"}').outcome,"blocked");
  for (const s of ['{}','{"outcome":"done","summary":"ok"}','{"outcome":"complete","summary":" "}','{"outcome":"complete","summary":"ok","approval_required":"yes"}',JSON.stringify({outcome:"complete",summary:"x".repeat(17000)})]) assert.throws(()=>validateResult(s));
});

test("Pi executor forwards stage/task literally, rejects stale/missing results and preserves process failure",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"machinist-pi-"));
  try {
    const fake=join(dir,"fake-pi"), result=join(dir,"result.json"), prompt=join(dir,"prompt.txt");
    await writeFile(fake,`#!/usr/bin/env node\nconst fs=require('node:fs');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{fs.writeFileSync(process.env.TEST_PROMPT,s);if(process.env.TEST_RESULT)fs.writeFileSync(process.env.MACHINIST_STEP_RESULT_PATH,process.env.TEST_RESULT);process.exit(Number(process.env.TEST_EXIT||0));});\n`,{mode:0o755});
    const adapter=fileURLToPath(new URL("../scripts/machinist-pi.ts",import.meta.url));
    async function attempt(resultText?:string,exit="0") {
      const child=spawn(process.execPath,["--experimental-strip-types",adapter,"build"],{env:{...process.env,PI_ENGINEERING_PI_BINARY:fake,MACHINIST_STEP_RESULT_PATH:result,TEST_PROMPT:prompt,TEST_RESULT:resultText,TEST_EXIT:exit},stdio:["pipe","ignore","ignore"]});
      child.stdin.end('Work on issue #42. Literal {{task.output_dir}} and $(nothing).');
      return await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
    }
    assert.equal(await attempt('{"outcome":"blocked","summary":"Missing runtime; partial work retained"}'),0);
    const input=await readFile(prompt,"utf8"); assert.match(input,/Literal \{\{task.output_dir\}\} and \$\(nothing\)/); assert.match(input,/Machinist stage: build/);
    await writeFile(result,'{"outcome":"complete","summary":"stale"}');
    assert.equal(await attempt(),1);
    assert.equal(await attempt('{"outcome":"complete","summary":"claim"}',"7"),7);
    assert.equal(await attempt('invalid json'),1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

import assert from "node:assert/strict";
import { test } from "node:test";

// Isolate environment and Workflow mocks from the live server and other suites.
// Cookies and service credentials use a synthetic Auth.js secret. No workflow starts.
function isolated<T>(source: string, nodeEnvironment = "production"): T {
  const setup = `
    import {encode as encodeFixtureSession} from "next-auth/jwt";
    import {signAssistantServiceToken as signFixtureService} from "./lib/auth/request.ts";
    const assistantFixtureActor={id:"google:synthetic-boundary-owner",email:"synthetic-owner@workspace.example"};
    const assistantFixtureAuthorization="Bearer "+await signFixtureService(assistantFixtureActor);
    const assistantFixtureSession=await encodeFixtureSession({secret:process.env.AUTH_SECRET,salt:"authjs.session-token",token:{sub:assistantFixtureActor.id,email:assistantFixtureActor.email,sessionKind:"assistant-user",workspaceDomain:"workspace.example"}});
    const assistantFixtureCookie="authjs.session-token="+assistantFixtureSession;
  `;
  const result = Bun.spawnSync([process.execPath, "-e", setup + source], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: nodeEnvironment, AUTH_SECRET: "synthetic-boundary-auth-secret-at-least-32-characters", AUTH_GOOGLE_WORKSPACE_DOMAIN: "workspace.example", DEMO_ACCESS_TOKEN: "synthetic-boundary-owner-token" },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(result.exitCode, 0, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}

interface ProbeResult {
  name: string;
  status: number;
  error?: string;
  cache: string | null;
}

test("all assistant APIs reject a remote caller before parsing input or reading workflow data", () => {
  const results = isolated<ProbeResult[]>(`
    const routes = [
      ["tasks", await import("./app/api/assistant/tasks/route.ts")],
      ["task", await import("./app/api/assistant/tasks/[runId]/route.ts")],
      ["stream", await import("./app/api/assistant/tasks/[runId]/stream/route.ts")],
      ["preferences", await import("./app/api/assistant/preferences/route.ts")],
      ["calendar", await import("./app/api/assistant/calendar/route.ts")],
      ["consent", await import("./app/api/assistant/calendar/authorize/route.ts")],
    ];
    const results=[];
    for(const [name,route] of routes){
      for(const method of ["GET","POST","PUT","DELETE"]){
        if(typeof route[method]!=="function")continue;
        for(const authorization of [undefined,"Bearer synthetic-wrong-token"]){
          const response=await route[method](new Request("https://demo.example/api/assistant/"+name,{method,headers:authorization?{authorization}:{},body:method==="GET"?undefined:"{"}),{params:Promise.resolve({runId:"wrun_synthetic_unknown"})});
          const body=await response.json();
          results.push({name:name+" "+method,status:response.status,error:body.error,cache:response.headers.get("cache-control")});
        }
      }
    }
    console.log(JSON.stringify(results));
  `);
  assert.equal(results.length, 20);
  for (const result of results) {
    assert.equal(result.status, 401, result.name);
    assert.match(result.error ?? "", /Sign in.*Google/, result.name);
    assert.equal(result.cache, "no-store", result.name);
  }
});

test("task malformed and oversized payloads fail without reaching a Workflow mutation", () => {
  const results = isolated<{ probes: ProbeResult[]; mutationCalls: number }>(`
    import {mock} from "bun:test";
    let mutationCalls=0;
    const forbidden=()=>{mutationCalls++;throw new Error("Unexpected workflow mutation");};
    mock.module("workflow/api",()=>({start:forbidden,resumeHook:forbidden,getHookByToken:forbidden,getRun:forbidden}));
    const {POST}=await import("./app/api/assistant/tasks/route.ts");
    const probes=[];
    const payloads=[
      ["invalid-json","{"],
      ["null","null"],
      ["array","[]"],
      ["oversize",JSON.stringify({prompt:"x".repeat(9000)})],
      ["invalid-mode",JSON.stringify({mode:"send-email"})],
      ["too-many-checks",JSON.stringify({maxChecks:6})],
      ["invalid-key","{}","invalid key"],
    ];
    for(const [name,body,key] of payloads){
      const response=await POST(new Request("https://demo.example/api/assistant/tasks",{method:"POST",headers:{authorization:assistantFixtureAuthorization,"content-type":"application/json",...(key?{"x-assistant-idempotency-key":key}:{})},body}));
      const payload=await response.json();
      probes.push({name,status:response.status,error:payload.error,cache:response.headers.get("cache-control")});
    }
    console.log(JSON.stringify({probes,mutationCalls}));
  `);
  assert.equal(results.mutationCalls, 0);
  for (const probe of results.probes) {
    assert.equal(probe.status, probe.name === "oversize" ? 413 : 400, probe.name);
    assert.equal(probe.cache, "no-store");
    assert.ok(probe.error);
    assert.equal(probe.error.includes("Unexpected workflow mutation"), false);
  }
});

test("assistant read, stream, and cancellation reject unknown, foreign, legacy, and other workflow IDs", () => {
  const results = isolated<{ probes: ProbeResult[]; mutationCalls: number }>(`
    import {mock} from "bun:test";
    let mutationCalls=0;
    const forbidden=()=>{mutationCalls++;throw new Error("Unexpected workflow mutation");};
    const {WorkflowRunNotFoundError}=await import("workflow/errors");
    mock.module("workflow/runtime",()=>({getWorld:async()=>({runs:{get:async(id)=>{
      if(id==="wrun_synthetic_unknown")throw new WorkflowRunNotFoundError(id);
      const workflowName=id==="wrun_synthetic_other_type"?"workflow//./workflows/classify-transactions//classifyTransactionsWorkflow":"workflow//./workflows/assistant-task//assistantTaskWorkflow";
      const {assistantOwnerAttributes}=await import("./lib/assistant/ownership.ts");
      const attributes=id==="wrun_synthetic_legacy"?{}:assistantOwnerAttributes(id==="wrun_synthetic_foreign"?{id:"google:synthetic-other-user",email:"synthetic-other@workspace.example"}:assistantFixtureActor);
      return {runId:id,workflowName,attributes};
    }}})}));
    mock.module("workflow/api",()=>({
      start:forbidden,resumeHook:forbidden,getHookByToken:forbidden,
      getRun:forbidden,
    }));
    const detail=await import("./app/api/assistant/tasks/[runId]/route.ts");
    const stream=await import("./app/api/assistant/tasks/[runId]/stream/route.ts");
    const probes=[];
    for(const runId of ["invalid","wrun_synthetic_unknown","wrun_synthetic_other_type","wrun_synthetic_foreign","wrun_synthetic_legacy"]){
      for(const [name,handler,method] of [["read",detail.GET,"GET"],["stream",stream.GET,"GET"],["cancel",detail.POST,"POST"]]){
        const response=await handler(new Request("https://demo.example/api/assistant/tasks/"+runId,{method,headers:{authorization:assistantFixtureAuthorization,"content-type":"application/json"},body:method==="POST"?JSON.stringify({action:"cancel",requestId:"synthetic-cancel-request"}):undefined}),{params:Promise.resolve({runId})});
        const payload=await response.json();
        probes.push({name:runId+" "+name,status:response.status,error:payload.error,cache:response.headers.get("cache-control")});
      }
    }
    console.log(JSON.stringify({probes,mutationCalls}));
  `);
  assert.equal(results.mutationCalls, 0);
  assert.equal(results.probes.length, 15);
  for (const probe of results.probes) {
    assert.equal(probe.status, 404, probe.name);
    assert.equal(probe.error, "Task not found.");
    assert.equal(probe.cache, "no-store");
  }
});

test("EVE development proxy checks the original Host and stamps only the verified browser origin", () => {
  const results = isolated<Array<{ name: string; status: number; forwarded: boolean; stampedOrigin: string | null }>>(`
    const {proxy}=await import("./proxy.ts");
    const results=[];
    for(const [name,headers] of [
      ["local",{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","sec-fetch-site":"same-origin"}],
      ["local-with-forged-stamp",{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","sec-fetch-site":"same-origin","x-assistant-original-origin":"https://attacker.example"}],
      ["forged-host",{host:"attacker.example"}],
      ["forged-host-and-stamp",{host:"attacker.example","x-assistant-original-origin":"http://127.0.0.1:3000"}],
      ["cross-origin",{host:"127.0.0.1:3000",origin:"https://attacker.example","sec-fetch-site":"cross-site"}],
      ["forged-stamp-with-different-origin",{host:"127.0.0.1:3000",origin:"https://attacker.example","sec-fetch-site":"same-origin","x-assistant-original-origin":"http://127.0.0.1:3000"}],
      ["forged-fetch-site",{host:"127.0.0.1:3000",origin:"https://attacker.example","sec-fetch-site":"same-origin"}],
      ["cross-site-loopback-origin",{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","sec-fetch-site":"cross-site"}],
    ]){
      const response=await proxy(new Request("http://127.0.0.1:3000/eve/v1/session",{headers:{cookie:assistantFixtureCookie,...headers}}));
      results.push({name,status:response.status,forwarded:response.headers.get("x-middleware-next")==="1",stampedOrigin:response.headers.get("x-middleware-request-x-assistant-original-origin")});
    }
    console.log(JSON.stringify(results));
  `, "development");
  for (const result of results) {
    const local = result.name.startsWith("local");
    assert.equal(result.status, local ? 200 : 401, result.name);
    assert.equal(result.forwarded, local, result.name);
    assert.equal(result.stampedOrigin, local ? "http://127.0.0.1:3000" : null, result.name);
  }
});

test("production EVE proxy replaces caller-supplied origin assertions with an actor-bound proof", () => {
  const result = isolated<{ forwarded: boolean; stampedOrigin: string | null; verifiedOrigin: string | null; wrongActorOrigin: string | null; changedOrigin: string | null }>(`
    const {proxy}=await import("./proxy.ts");
    const {readAssistantProxyOrigin}=await import("./lib/auth/request.ts");
    const response=await proxy(new Request("https://demo.example/eve/v1/session",{headers:{cookie:assistantFixtureCookie,host:"demo.example","x-assistant-original-origin":"http://127.0.0.1:3000","x-assistant-origin-proof":"synthetic-forged-proof"}}));
    const headers={"x-assistant-original-origin":response.headers.get("x-middleware-request-x-assistant-original-origin"),"x-assistant-origin-proof":response.headers.get("x-middleware-request-x-assistant-origin-proof")};
    const forwarded=new Request("http://127.0.0.1:2000/eve/v1/session",{headers});
    const verifiedOrigin=await readAssistantProxyOrigin(forwarded,assistantFixtureActor);
    const wrongActorOrigin=await readAssistantProxyOrigin(forwarded,{id:"google:different-user",email:"different@workspace.example"});
    const changedOrigin=await readAssistantProxyOrigin(new Request(forwarded,{headers:{...headers,"x-assistant-original-origin":"https://attacker.example"}}),assistantFixtureActor);
    console.log(JSON.stringify({forwarded:response.headers.get("x-middleware-next")==="1",stampedOrigin:response.headers.get("x-middleware-request-x-assistant-original-origin"),verifiedOrigin,wrongActorOrigin,changedOrigin}));
  `);
  assert.equal(result.forwarded, true);
  assert.equal(result.stampedOrigin, "https://demo.example");
  assert.equal(result.verifiedOrigin, "https://demo.example");
  assert.equal(result.wrongActorOrigin, null);
  assert.equal(result.changedOrigin, null);
});

test("assistant auth accepts only a signed eligible session or an unexpired delegated actor", () => {
  const results = isolated<Array<{name: string; status: number; actorId?: string}>>(`
    const {requireAssistantActor}=await import("./lib/auth/request.ts");
    const expired=await encodeFixtureSession({secret:process.env.AUTH_SECRET,salt:"assistant-internal-service-v1",maxAge:-3600,token:{sub:assistantFixtureActor.id,email:assistantFixtureActor.email,workspaceDomain:"workspace.example",sessionKind:"assistant-service"}});
    const foreign=await encodeFixtureSession({secret:process.env.AUTH_SECRET,salt:"assistant-internal-service-v1",token:{sub:"google:foreign-user",email:"foreign@example.test",workspaceDomain:"workspace.example",sessionKind:"assistant-service"}});
    const wrongKind=await encodeFixtureSession({secret:process.env.AUTH_SECRET,salt:"assistant-internal-service-v1",token:{sub:assistantFixtureActor.id,email:assistantFixtureActor.email,workspaceDomain:"workspace.example",sessionKind:"assistant-user"}});
    const results=[];
    for(const [name,url,method,headers] of [
      ["signed-cookie","https://demo.example/api/assistant/tasks","GET",{cookie:assistantFixtureCookie}],
      ["signed-service","https://demo.example/api/assistant/tasks","POST",{authorization:assistantFixtureAuthorization}],
      ["expired-service","https://demo.example/api/assistant/tasks","GET",{authorization:"Bearer "+expired}],
      ["foreign-domain","https://demo.example/api/assistant/tasks","GET",{authorization:"Bearer "+foreign}],
      ["wrong-token-kind","https://demo.example/api/assistant/tasks","GET",{authorization:"Bearer "+wrongKind}],
      ["forged-actor-headers","https://demo.example/api/assistant/tasks","GET",{"x-assistant-user-id":assistantFixtureActor.id,"x-assistant-user-email":assistantFixtureActor.email}],
      ["legacy-demo-local","http://127.0.0.1:3000/api/assistant/tasks","GET",{authorization:"Bearer synthetic-boundary-owner-token"}],
      ["anonymous-local","http://127.0.0.1:3000/api/assistant/tasks","GET",{}],
      ["cross-origin-cookie","https://demo.example/api/assistant/tasks","POST",{cookie:assistantFixtureCookie,origin:"https://attacker.example","sec-fetch-site":"cross-site"}],
      ["cookie-post-without-origin","https://demo.example/api/assistant/tasks","POST",{cookie:assistantFixtureCookie}],
    ]){
      const outcome=await requireAssistantActor(new Request(url,{method,headers}));
      results.push(outcome instanceof Response?{name,status:outcome.status}:{name,status:200,actorId:outcome.id});
    }
    console.log(JSON.stringify(results));
  `, "development");
  for (const result of results) {
    const accepted = ["signed-cookie", "signed-service"].includes(result.name);
    assert.equal(result.status, accepted ? 200 : 401, result.name);
    assert.equal(result.actorId, accepted ? "google:synthetic-boundary-owner" : undefined, result.name);
  }
});

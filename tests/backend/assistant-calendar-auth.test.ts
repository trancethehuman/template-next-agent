import assert from "node:assert/strict";
import { test } from "node:test";

test("Calendar routes bind cookies to verified actors and ignore spoofed subject or owner input", () => {
  const source = `
    import {mock} from "bun:test";
    import {encode} from "next-auth/jwt";
    const reads=[];const consents=[];
    mock.module("./lib/assistant/calendar.ts",()=>({
      getCalendarOverview:async(actor)=>{reads.push(actor);return {status:{state:"connected",ownerEmail:actor.email},events:[{id:actor.id,title:"Synthetic private event"}]};},
      createCalendarAuthorizationUrl:async(actor,callback)=>{consents.push({actor,callback});return "https://vercel.com/synthetic-consent";},
      calendarErrorStatus:()=>({state:"unavailable",message:"Synthetic error"}),
    }));
    const {GET}=await import("./app/api/assistant/calendar/route.ts");
    const {POST}=await import("./app/api/assistant/calendar/authorize/route.ts");
    const actors=[{id:"google:synthetic-a",email:"synthetic-a@workspace.example"},{id:"google:synthetic-b",email:"synthetic-b@workspace.example"}];
    const results=[];
    for(const actor of actors){
      const token=await encode({secret:process.env.AUTH_SECRET,salt:"authjs.session-token",token:{sub:actor.id,email:actor.email,workspaceDomain:"workspace.example",sessionKind:"assistant-user"}});
      const cookie="authjs.session-token="+token;
      const read=await GET(new Request("https://app.example/api/assistant/calendar?subject=assistant-owner",{headers:{cookie}}));
      const payload=await read.json();
      results.push({method:"read",status:read.status,actor:payload.events?.[0]?.id,email:payload.status?.ownerEmail});
      const consent=await POST(new Request("https://app.example/api/assistant/calendar/authorize?subject=assistant-owner",{method:"POST",headers:{cookie,origin:"https://app.example","content-type":"application/json"},body:JSON.stringify({actor:{id:"google:someone-else",email:"another@workspace.example"},subject:"assistant-owner"})}));
      results.push({method:"consent",status:consent.status});
      const denied=await POST(new Request("https://app.example/api/assistant/calendar/authorize",{method:"POST",headers:{cookie,origin:"https://attacker.example","sec-fetch-site":"cross-site"},body:"{}"}));
      results.push({method:"cross-origin",status:denied.status});
    }
    const anonymous=await GET(new Request("http://127.0.0.1:3000/api/assistant/calendar",{headers:{authorization:"Bearer synthetic-demo-token"}}));
    results.push({method:"anonymous-local",status:anonymous.status});
    console.log(JSON.stringify({reads,consents,results}));
  `;
  const execution = Bun.spawnSync([process.execPath, "-e", source], {
    cwd: process.cwd(),
    env: {...process.env, AUTH_SECRET: "synthetic-calendar-auth-secret-at-least-32-characters", AUTH_GOOGLE_WORKSPACE_DOMAIN: "workspace.example", DEMO_ACCESS_TOKEN: "synthetic-demo-token"},
    stdout: "pipe", stderr: "pipe",
  });
  assert.equal(execution.exitCode, 0, new TextDecoder().decode(execution.stderr));
  const result = JSON.parse(new TextDecoder().decode(execution.stdout)) as {
    reads: Array<{id: string; email: string}>;
    consents: Array<{actor: {id: string; email: string}; callback: string}>;
    results: Array<{method: string; status: number; actor?: string; email?: string}>;
  };
  assert.deepEqual(result.reads.map(actor => actor.id), ["google:synthetic-a", "google:synthetic-b"]);
  assert.deepEqual(result.consents.map(entry => entry.actor.id), ["google:synthetic-a", "google:synthetic-b"]);
  assert.ok(result.consents.every(entry => entry.callback === "https://app.example/assistant?view=connections&calendar=return"));
  for (const probe of result.results) assert.equal(probe.status, ["cross-origin", "anonymous-local"].includes(probe.method) ? 401 : 200, probe.method);
  assert.deepEqual(result.results.filter(probe => probe.method === "read").map(probe => probe.actor), ["google:synthetic-a", "google:synthetic-b"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

test("Google sign-in is unrestricted for clones and enforces an explicitly configured Workspace", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `
    import assert from "node:assert/strict";
    import { actorFromGoogleProfile, assistantWorkspaceDomain } from "./lib/auth/actor.ts";
    import { assistantAuthConfig } from "./auth.ts";
    import { encode } from "next-auth/jwt";
    import { requireAssistantActor, readAssistantSession, signAssistantServiceToken, signAssistantProxyProof, readAssistantProxyOrigin } from "./lib/auth/request.ts";
    const personal={sub:"synthetic-personal",email:"synthetic-person@gmail.com",email_verified:true};
    delete process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN;
    assert.equal(assistantWorkspaceDomain(),undefined);
    assert.equal("hd" in assistantAuthConfig().providers[0].options.authorization.params,false,"An unrestricted clone must omit the Google hosted-domain hint");
    assert.equal(actorFromGoogleProfile(personal)?.id,"google:synthetic-personal");
    assert.equal(actorFromGoogleProfile({...personal,email_verified:false}),null);
    process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN="company.example";
    assert.equal(assistantAuthConfig().providers[0].options.authorization.params.hd,"company.example");
    assert.equal(actorFromGoogleProfile(personal),null);
    const profile={sub:"synthetic-staff",email:"Staff@company.example",email_verified:true,hd:"company.example"};
    const actor=actorFromGoogleProfile(profile);
    assert.equal(actor?.email,"staff@company.example");
    assert.equal(actorFromGoogleProfile({...profile,hd:undefined}),null);
    assert.equal(actorFromGoogleProfile({...profile,hd:"company.example.attacker.test"}),null);
    assert.equal(actorFromGoogleProfile({...profile,email:"staff@attacker.test"}),null);
    const token=await encode({secret:process.env.AUTH_SECRET,salt:"authjs.session-token",maxAge:3600,token:{sub:actor.id,email:actor.email,workspaceDomain:"company.example",sessionKind:"assistant-user"}});
    const cookie="authjs.session-token="+token;
    const request=new Request("https://app.example/api/assistant/tasks",{headers:{cookie}});
    assert.equal((await requireAssistantActor(request)).id,actor.id);
    assert.equal(await readAssistantSession(new Request(request.url,{headers:{authorization:"Bearer "+token}})),null);
    const service=await signAssistantServiceToken(actor);
    assert.equal((await requireAssistantActor(new Request(request.url,{headers:{authorization:"Bearer "+service}}))).id,actor.id);
    assert.equal((await requireAssistantActor(new Request(request.url,{headers:{authorization:"Bearer "+service}}),{allowService:false})).status,401);
    assert.equal((await requireAssistantActor(new Request(request.url,{method:"POST",headers:{cookie,origin:"https://attacker.test"}}))).status,401);
    const proof=await signAssistantProxyProof(actor,"https://app.example");
    const forwarded=new Request("http://127.0.0.1:65433/eve/v1/session",{headers:{"x-assistant-original-origin":"https://app.example","x-assistant-origin-proof":proof}});
    assert.equal(await readAssistantProxyOrigin(forwarded,actor),"https://app.example");
    assert.equal(await readAssistantProxyOrigin(forwarded,{...actor,id:"google:other-user"}),null);
    assert.equal(await readAssistantProxyOrigin(new Request(forwarded.url,{headers:{"x-assistant-original-origin":"https://app.example","x-assistant-origin-proof":proof+"tampered"}}),actor),null);
    delete process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN;
    assert.equal((await requireAssistantActor(request)).status,401,"Changing organization policy invalidates old policy-bound sessions");
    console.log("ok");
  `,
    ],
    {
      env: {
        ...process.env,
        AUTH_SECRET: "synthetic-login-test-secret-at-least-32-characters",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  assert.equal(result.exitCode, 0, new TextDecoder().decode(result.stderr));
  assert.equal(new TextDecoder().decode(result.stdout).trim(), "ok");
});

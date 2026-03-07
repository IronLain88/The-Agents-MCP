import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { API_KEY } from "./config.js";

const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "claude-ai";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "";
const BASE = process.env.OAUTH_BASE || "https://the-agents.net";

const _sessions = new Map<string, { codeChallenge: string; redirectUri: string; state: string }>();
const _codes = new Map<string, { codeChallenge: string }>();

export async function handleOAuthRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", BASE);
  const path = url.pathname;

  if (path === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
    }));
    return true;
  }

  if (path === "/oauth/authorize" && req.method === "GET") {
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";
    const codeChallenge = url.searchParams.get("code_challenge") || "";

    if (clientId !== CLIENT_ID || !redirectUri) {
      res.writeHead(400, { "Content-Type": "text/plain" }); res.end("Invalid request"); return true;
    }

    const sessionId = randomUUID();
    _sessions.set(sessionId, { codeChallenge, redirectUri, state });
    setTimeout(() => _sessions.delete(sessionId), 600_000);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Authorize — The Agents</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.card{background:#1e293b;padding:2rem 2.5rem;border-radius:16px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:380px;width:90%}h1{margin:0 0 .5rem}p{color:#94a3b8;margin-bottom:2rem}.btn{background:#6366f1;color:#fff;border:none;padding:.8rem 2.5rem;border-radius:10px;font-size:1rem;cursor:pointer}.btn:hover{background:#4f46e5}</style>
</head><body><div class="card">
<h1>The Agents</h1>
<p>claude.ai moechte auf deinen MCP Server zugreifen.</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="session_id" value="${sessionId}">
  <button class="btn" type="submit">Authorize</button>
</form></div></body></html>`);
    return true;
  }

  if (path === "/oauth/authorize" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    await new Promise<void>(r => req.on("end", r));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    const sessionId = body.get("session_id") || "";
    const session = _sessions.get(sessionId);

    if (!session) {
      res.writeHead(400, { "Content-Type": "text/plain" }); res.end("Session expired. Please try again."); return true;
    }
    _sessions.delete(sessionId);

    const code = randomUUID();
    _codes.set(code, { codeChallenge: session.codeChallenge });
    setTimeout(() => _codes.delete(code), 300_000);

    const redirect = new URL(session.redirectUri);
    redirect.searchParams.set("code", code);
    if (session.state) redirect.searchParams.set("state", session.state);
    res.writeHead(302, { Location: redirect.toString() }); res.end();
    return true;
  }

  if (path === "/oauth/token" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    await new Promise<void>(r => req.on("end", r));
    const raw = Buffer.concat(chunks).toString();
    const isJson = (req.headers["content-type"] || "").includes("application/json");
    const get = (k: string) => isJson
      ? (JSON.parse(raw) as Record<string, string>)[k]
      : new URLSearchParams(raw).get(k) || "";

    const code = get("code");
    const codeVerifier = get("code_verifier");
    const clientId = get("client_id");
    const clientSecret = get("client_secret");
    const pending = _codes.get(code);

    if (!pending) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" })); return true;
    }
    if (clientId !== CLIENT_ID || (CLIENT_SECRET && clientSecret !== CLIENT_SECRET)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_client" })); return true;
    }
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (challenge !== pending.codeChallenge) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE failed" })); return true;
    }

    _codes.delete(code);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ access_token: API_KEY, token_type: "Bearer", expires_in: 31536000 }));
    return true;
  }

  return false;
}

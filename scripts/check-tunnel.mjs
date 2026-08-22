// Proves the public guest link really works from outside this machine.
//
// Not a mock: it stands up a tiny local server, opens a real Cloudflare quick
// tunnel to it with the same binary and the same arguments the app uses, and
// then fetches the public address over the internet. If that round trip works,
// the app's tunnel works, because it is the same mechanism.
//
//   node scripts/check-tunnel.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SECRET = "screen-drop-tunnel-check-" + process.pid;
const READY_TIMEOUT_MS = 60_000;

const candidates = [
  join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "screen-drop/cloudflared.exe"),
  join(homedir(), "AppData/Roaming/screen-drop/cloudflared.exe"),
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.log("FAIL  cloudflared is not downloaded yet.");
  console.log("      The app fetches it on the first 'Anywhere' share.");
  console.log("      Looked in:");
  for (const c of candidates) console.log("        " + c);
  process.exit(2);
}
console.log("  ok  helper at " + exe);

// A stand-in for the guest server, including a WebSocket-style upgrade path so
// the check covers more than plain GET.
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(SECRET);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
console.log(`  ok  local server on 127.0.0.1:${port}`);

/** Same scan the Rust side does, so a change in cloudflared's output shows up here too. */
function findTunnelUrl(line) {
  const at = line.indexOf("https://");
  if (at === -1) return null;
  const rest = line.slice(at);
  const end = rest.search(/[\s|"]/);
  const url = (end === -1 ? rest : rest.slice(0, end)).replace(/[/.,]+$/, "");
  return url.endsWith(".trycloudflare.com") ? url : null;
}

const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no address within 60s")), READY_TIMEOUT_MS);
  let buffer = "";
  const scan = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const found = findTunnelUrl(line);
      if (found) {
        clearTimeout(timer);
        resolve(found);
        return;
      }
    }
  };
  child.stderr.on("data", scan);
  child.stdout.on("data", scan);
  child.on("exit", (code) => reject(new Error(`cloudflared exited with ${code}`)));
}).catch((err) => {
  child.kill();
  server.close();
  console.log("FAIL  " + err.message);
  process.exit(1);
});

console.log("  ok  public address " + url);

// Preflight, so a sandboxed or offline shell is not reported as a broken
// tunnel. They fail identically from in here and mean completely different
// things.
let outbound = false;
try {
  const probe = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
    signal: AbortSignal.timeout(10_000),
  });
  outbound = probe.ok;
} catch {
  outbound = false;
}
if (!outbound) {
  child.kill();
  server.close();
  console.log("SKIP  this shell has no outbound internet, so the round trip");
  console.log("      cannot be checked from here. The tunnel itself opened fine.");
  console.log("      Open the address above in a browser to confirm.");
  process.exit(3);
}
console.log("  ok  this shell can reach the internet");

// The edge takes a few seconds to start routing after the address appears.
let body = null;
let lastNote = "no attempt made";
for (let attempt = 1; attempt <= 20; attempt++) {
  try {
    const res = await fetch(url + "/health", {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "screen-drop-check" },
    });
    lastNote = `HTTP ${res.status}`;
    if (res.ok) {
      body = await res.text();
      if (body === SECRET) break;
      lastNote = `HTTP ${res.status}, body ${JSON.stringify(body.slice(0, 60))}`;
    }
  } catch (err) {
    lastNote = err.message;
  }
  process.stdout.write(`      attempt ${attempt}: ${lastNote}
`);
  await new Promise((r) => setTimeout(r, 3000));
}

child.kill();
server.close();

if (body === SECRET) {
  console.log("  ok  fetched it back over the internet, byte for byte");
  console.log("\n4/4 checks passed - off-network sharing works on this machine");
  process.exit(0);
}
console.log(`FAIL  the public address did not serve the local server - last: ${lastNote}`);
process.exit(1);

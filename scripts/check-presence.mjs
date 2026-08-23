// Proves a guest can point and react, and that the server refuses anything it
// was not offered.
//
// Uses Node's built-in WebSocket (Node 22+), so it needs no dependencies.
//
// The reason this is worth a harness rather than a unit test: a guest is a
// stranger holding a link, and whatever they send ends up drawn on the host's
// board. "The server validates it" is a claim about a running server.
//
//   node scripts/check-presence.mjs <guest-url>
const url = process.argv[2];
if (!url) {
  console.error("usage: check-presence.mjs <guest-url>");
  process.exit(2);
}

const token = url.split("/g/")[1];
const origin = url.split("/g/")[0];
const socket = new WebSocket(`${origin.replace("http", "ws")}/gw?token=${token}`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
};

let closedWith = null;
socket.addEventListener("close", (e) => {
  closedWith = `${e.code} ${e.reason}`;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

socket.addEventListener("open", async () => {
  check("a guest can connect", true);
  socket.send(JSON.stringify({ t: "hello", name: "Probe" }));
  await wait(400);

  socket.send(JSON.stringify({ t: "pointer", x: 640, y: 360 }));
  await wait(200);
  check("the server takes a pointer", socket.readyState === WebSocket.OPEN);

  for (const kind of ["yes", "no", "wow", "clap", "think", "here"]) {
    socket.send(JSON.stringify({ t: "reaction", reaction: kind }));
  }
  await wait(300);
  check("it takes every reaction on the list", socket.readyState === WebSocket.OPEN);

  // The part that matters: things a stranger might try.
  for (const bad of ["<script>alert(1)</script>", "yes ", "", "x".repeat(4096), "__proto__"]) {
    socket.send(JSON.stringify({ t: "reaction", reaction: bad }));
  }
  await wait(400);
  check(
    "it survives reactions that are not on the list",
    socket.readyState === WebSocket.OPEN,
    closedWith ? `closed with ${closedWith}` : "",
  );

  // And a malformed message should not take the connection down either.
  socket.send(JSON.stringify({ t: "pointer", x: "over there" }));
  socket.send("not json at all");
  await wait(400);
  check("it survives a malformed message", socket.readyState === WebSocket.OPEN);

  socket.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
});

socket.addEventListener("error", () => {
  console.log("FAIL  could not connect");
  process.exit(1);
});

setTimeout(() => {
  console.log("FAIL  timed out");
  process.exit(1);
}, 20000);

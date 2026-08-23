// Makes the built cockpit land in demo mode when it is served from Pages.
//
// The alternative is asking every visitor to notice a `?demo` on the end of a
// URL, which nobody does. The app itself never runs through this: it loads
// index.html straight off disk inside a Tauri window, and this only rewrites
// the copy that goes to a static host.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(ROOT, "dist", "index.html");

const html = readFileSync(target, "utf8");

const REDIRECT = `
    <script>
      // Served from a static host: turn the demo on unless someone has
      // deliberately asked for the plain cockpit.
      if (!location.search.includes("demo") && !location.search.includes("plain")) {
        location.replace(location.pathname + "?demo" + location.hash);
      }
    </script>`;

if (html.includes('location.replace(location.pathname + "?demo"')) {
  console.log("already set up for the demo");
} else {
  writeFileSync(target, html.replace("</head>", `${REDIRECT}\n  </head>`), "utf8");
  console.log("index.html now lands in demo mode");
}

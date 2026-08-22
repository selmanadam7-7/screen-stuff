// Puts the app icon where Tauri and the three web pages expect to find it.
//
// The source of truth is assets/brand/icon — the face of Screen Stuff, already
// exported at every size it needs. This script only ever copies; it does not
// draw, resize or re-encode, because every one of those is a chance for the
// icon in the taskbar to drift away from the icon in the brand folder.
//
//   node scripts/make-icons.mjs
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "assets", "brand", "icon");

/** where it goes <- what it comes from */
const TARGETS = [
  // Tauri's bundle icons, named exactly as tauri.conf.json lists them.
  ["src-tauri/icons/32x32.png", "screen-stuff-32.png"],
  ["src-tauri/icons/128x128.png", "screen-stuff-128.png"],
  ["src-tauri/icons/128x128@2x.png", "screen-stuff-256.png"],
  ["src-tauri/icons/icon.png", "screen-stuff-512.png"],
  // The Windows taskbar, the installer and the uninstall entry all read this.
  ["src-tauri/icons/icon.ico", "icon.ico"],
  // Served at the web root, so the cockpit, the board and a guest's browser
  // tab all show the same face.
  ["public/favicon.png", "screen-stuff-256.png"],
  ["public/favicon.ico", "icon.ico"],
  ["public/icon-512.png", "screen-stuff-512.png"],
];

let written = 0;
for (const [target, source] of TARGETS) {
  const from = join(BRAND, source);
  if (!existsSync(from)) {
    console.error(`missing brand asset: ${source}`);
    process.exit(1);
  }
  const to = join(ROOT, target);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`  ${String(Math.round(statSync(to).size / 1024)).padStart(5)} KB  ${target}`);
  written += 1;
}

console.log(`\n${written} icons written from assets/brand/icon`);

// Turns the logo SVG into a React component, so the mark in the app chrome is
// literally the file in assets/brand rather than a hand-drawn approximation of
// it that quietly drifts.
//
// Inlined rather than loaded as an <img> for one reason: inline SVG inherits
// `currentColor`, so the same mark reads correctly in all five looks without
// shipping five copies of it.
//
//   node scripts/make-brand-component.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "assets", "brand", "logo", "logo-current.svg");
const TARGET = join(ROOT, "src", "ui", "Brand.tsx");

const svg = readFileSync(SOURCE, "utf8");

const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
if (!viewBox) throw new Error("the logo has no viewBox");

const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) throw new Error("the logo has no paths");

const body = paths.map((d) => `      <path d="${d}" />`).join("\n");

writeFileSync(
  TARGET,
  `/**
 * The Screen Stuff mark.
 *
 * Generated from \`assets/brand/logo/logo-current.svg\` by
 * \`scripts/make-brand-component.mjs\` — edit the SVG, not this file.
 *
 * It draws in \`currentColor\`, so it takes the ink of whatever it sits in and
 * is correct in all five looks without a second copy.
 */

export function Brand({
  size = 20,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Give it a name when it stands alone; leave it off when text follows it. */
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="${viewBox}"
      fill="currentColor"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
${body}
    </svg>
  );
}
`,
  "utf8",
);

console.log(`Brand.tsx written from ${paths.length} path(s), viewBox ${viewBox}`);

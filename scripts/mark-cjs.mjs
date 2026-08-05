// Both workspace packages are ESM ("type": "module") because that's what the
// dev runner wants. The production build emits CommonJS instead - our source
// uses extensionless relative imports, which Node's ESM loader refuses at
// runtime and SWC won't rewrite.
//
// Without this marker Node would inherit "type": "module" from the package root
// and try to parse the emitted CJS as ESM, failing on `exports`/`require`. A
// nested package.json scopes the build directory back to CommonJS.
//
// Usage: node scripts/mark-cjs.mjs [dir=dist]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "dist");
mkdirSync(dir, { recursive: true });
writeFileSync(
  resolve(dir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);
console.log(`marked ${dir} as commonjs`);

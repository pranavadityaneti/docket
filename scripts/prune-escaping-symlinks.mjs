// Remove symlinks that point outside a deployable artifact, and fail if any
// remain.
//
// `pnpm deploy` leaves at least one link in the virtual store that points back
// at the workspace source - e.g.
//   node_modules/.pnpm/node_modules/@docket/api -> ../../../../../../apps/api
// On the build machine that resolves (the workspace is right there), so the
// artifact looks fine and even runs. Extracted anywhere else it dangles, and
// Elastic Beanstalk's deploy fails hard in StageApplication:
//   chown /var/app/staging/node_modules/.pnpm/node_modules/@docket/api:
//   no such file or directory
// - because EB recursively chowns the staged bundle and a dangling link is an
// error. Nothing needs these links at runtime: the app runs from dist/, and
// workspace deps resolve via node_modules/@docket/*.
//
// Checks escape by resolving the link target, NOT by testing existence - on the
// build machine an escaping link still exists, so an existence check finds
// nothing and the artifact ships broken.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
if (!fs.existsSync(root)) {
  console.error(`No such artifact directory: ${root}`);
  process.exit(1);
}

const escaping = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
      if (target !== root && !target.startsWith(root + path.sep)) {
        escaping.push({ link: full, target: fs.readlinkSync(full) });
      }
    } else if (entry.isDirectory()) {
      walk(full);
    }
  }
}
walk(root);

for (const { link, target } of escaping) {
  fs.unlinkSync(link);
  console.log(`pruned ${path.relative(root, link)} -> ${target}`);
}

// Re-walk and assert, so a silent regression can't ship.
escaping.length = 0;
walk(root);
if (escaping.length > 0) {
  console.error(`${escaping.length} escaping symlink(s) survived pruning:`);
  for (const { link } of escaping)
    console.error(`  ${path.relative(root, link)}`);
  process.exit(1);
}
console.log(
  `${path.relative(process.cwd(), root)}: no symlinks escape the artifact.`,
);

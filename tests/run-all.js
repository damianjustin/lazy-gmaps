// Runs every suite against ../lazy-gmaps.js. Usage: node tests/run-all.js   (CHROME=/path/to/chrome optional)
const { spawnSync } = require("child_process");
const path = require("path");
const root = path.join(__dirname, "..");
const lib = path.join(root, "lazy-gmaps.js");
const runs = [
  ["suite.js", lib],
  ["new.js", lib],
  ["probe.js", lib],
  ["migration.js", lib, path.join(__dirname, "isbot.browser.global.js")],
  ["botcheck.js", lib],
  ["examples_v3.js", lib, path.join(root, "examples.html")],
  ["ex_modal.js", lib, path.join(root, "examples.html")],
];
let failed = 0;
// Client suites (migration.js) are kept out of the repo; skip any that are not present.
for (const [file, ...args] of runs.filter(([f]) => require("fs").existsSync(path.join(__dirname, f)))) {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nAll suites passed");
process.exit(failed ? 1 : 0);

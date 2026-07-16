import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const crfDirectory = resolve(root, "template/crf");
const schemaPath = resolve(
  root,
  "2.SA/projects/prj_20260716-1544/forms/screening-baseline-cpap-compliance/0.1.0/crf-schema.json",
);
const dist = resolve(root, "dist");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

// npm is available on the cloud Linux build image. On Windows, invoke the
// command through cmd.exe because Node cannot directly spawn npm.cmd.
if (process.platform === "win32") {
  run(process.env.ComSpec ?? "cmd.exe", [
    "/d",
    "/s",
    "/c",
    "npm install",
  ], { cwd: crfDirectory });
} else {
  run("npm", ["--prefix", crfDirectory, "install"]);
}
run(process.execPath, [resolve(crfDirectory, "node_modules/vite/bin/vite.js"), "build"], {
  cwd: crfDirectory,
  env: { ...process.env, AIRWAYAI_CRF_SCHEMA_PATH: schemaPath },
});

console.log("Assembling static HTML deployment package...");
// Do not empty the output directory here: synced Windows folders can
// terminate a Node process during recursive deletion. Vite emits immutable
// hashed assets, so safely overlaying this package does not affect the entry.
mkdirSync(resolve(dist, "server"), { recursive: true });
mkdirSync(resolve(dist, ".openai"), { recursive: true });

// The CRF itself is a pre-built, browser-only static application.  Keep its
// entry HTML and assets at the deployment root so the hosting asset binding
// can resolve `/` and `/assets/*` without a server-side renderer.
copyDirectory(resolve(crfDirectory, "dist-demo"), dist);
copyFileSync(resolve(root, "sites/server.js"), resolve(dist, "server/index.js"));
copyFileSync(resolve(root, ".openai/hosting.json"), resolve(dist, ".openai/hosting.json"));
console.log("Static deployment package ready at dist/.");

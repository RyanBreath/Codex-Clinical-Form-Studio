import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();
const requiresAsciiWorkaround = process.platform === "win32" && /[^\x00-\x7F]/.test(projectRoot);

function run(cwd) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "build"], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}

let temporaryRoot;
try {
  if (!requiresAsciiWorkaround) {
    process.exitCode = await run(projectRoot);
  } else {
    temporaryRoot = await mkdtemp(join(tmpdir(), "airwayai-sites-"));
    const junction = join(temporaryRoot, "site");
    await symlink(resolve(projectRoot), junction, "junction");
    process.exitCode = await run(junction);
  }
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

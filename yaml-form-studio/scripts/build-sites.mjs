import { createHash } from "node:crypto";
import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "vite";

const originalRoot = process.cwd();
const requiresAsciiWorkaround = process.platform === "win32" && /[^\x00-\x7F]/.test(originalRoot);
let temporaryRoot;
let temporaryJunction;

async function listFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function runBuild(projectRoot, programPath) {
  const dist = resolve(projectRoot, "dist");
  let emptyOutDir = true;
  try {
    await rm(dist, { recursive: true, force: true });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    emptyOutDir = false;
  }
  await build({
    root: projectRoot,
    configFile: resolve(projectRoot, "vite.config.ts"),
    build: { emptyOutDir },
  });
  await access(programPath);
  await copyFile(programPath, resolve(dist, "client/program.yaml"));
  const programInfo = await stat(programPath);

  await build({
    root: projectRoot,
    configFile: false,
    publicDir: false,
    build: {
      lib: {
        entry: resolve(projectRoot, "worker/index.ts"),
        formats: ["es"],
        fileName: () => "index.js",
      },
      outDir: resolve(dist, "server"),
      emptyOutDir,
      minify: true,
      target: "es2022",
      rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
    },
  });

  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const clientFiles = await listFiles(resolve(dist, "client"));
  const assets = await Promise.all(
    clientFiles.map(async (path) => ({
      path: relative(dist, path).replaceAll("\\", "/"),
      bytes: (await stat(path)).size,
      sha256: await sha256(path),
    })),
  );
  const manifest = {
    application: "AirwayAI eCRF Studio",
    version: packageJson.version,
    renderingMode: "precompiled-static-react",
    entrypoint: "client/index.html",
    supportedYaml: "protocol-to-ecrf program.yaml contract 1.0.0",
    sourceProgram: {
      file: "program.yaml",
      projectId: "prj_20260721-1447",
      sha256: await sha256(programPath),
      modifiedAt: programInfo.mtime.toISOString(),
    },
    assets,
  };
  const manifestPath = resolve(dist, "asset-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const checksumFiles = [
    ...clientFiles,
    resolve(dist, "server/index.js"),
    resolve(dist, ".openai/hosting.json"),
    manifestPath,
  ];
  const checksums = await Promise.all(
    checksumFiles.map(async (path) => `${await sha256(path)}  ${relative(dist, path).replaceAll("\\", "/")}`),
  );
  await writeFile(resolve(dist, "checksums.sha256"), `${checksums.sort().join("\n")}\n`, "utf8");
}

try {
  const programPath = resolve(originalRoot, "../2.SA/projects/prj_20260721-1447/analysis/program.yaml");
  if (!requiresAsciiWorkaround) {
    await runBuild(originalRoot, programPath);
  } else {
    temporaryRoot = await mkdtemp(join(tmpdir(), "airwayai-static-sites-"));
    temporaryJunction = join(temporaryRoot, "site");
    await symlink(resolve(originalRoot), temporaryJunction, "junction");
    await runBuild(temporaryJunction, programPath);
  }
} finally {
  if (temporaryJunction) await unlink(temporaryJunction).catch(() => undefined);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

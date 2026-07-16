import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const rendererRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(rendererRoot, "../..");
const projectsRoot = resolve(repositoryRoot, "2.SA/projects");
const stagingBase = resolve(rendererRoot, "output/release-staging");
const releaseStateRoot = resolve(rendererRoot, "output/release-state");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}\n${error instanceof Error ? error.message : error}`);
  }
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rendererRoot,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  return options.capture ? result.stdout.trim() : "";
}

function iisConfig(mountPath) {
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <!-- Intended mount path: ${mountPath} -->
  <system.webServer>
    <defaultDocument enabled="true"><files><clear /><add value="index.html" /></files></defaultDocument>
    <httpProtocol><customHeaders>
      <add name="X-Content-Type-Options" value="nosniff" />
      <add name="Referrer-Policy" value="no-referrer" />
      <add name="Content-Security-Policy" value="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" />
    </customHeaders></httpProtocol>
  </system.webServer>
</configuration>
`;
}

function nginxConfig(mountPath) {
  return `# Replace the alias path with the absolute path to this release's site directory.
location ${mountPath} {
    alias C:/replace/with/absolute/path/to/site/;
    index index.html;
    try_files $uri $uri/ =404;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
}
`;
}

function deploymentGuide(state) {
  return `# Deployment

This package is a static Demo artifact, not a validated clinical data collection system.

Copy the **contents** of \`site/\` into the IIS website／virtual directory or NGINX alias directory. Assets use relative URLs and support the intended mount path \`${state.mountPath}\`.

- Requested target: \`${state.target}\`
- Intended mount path: \`${state.mountPath}\`
- IIS: use \`web.config\` when included.
- NGINX: replace the absolute alias path in \`nginx.conf.example\` when included.

Only \`site/\` is public deployable content. Keep \`program.yaml\`, schema, manifests, and reports outside the web root.
`;
}

const statePath = resolve(argument("--state") ?? "");
if (!isWithin(releaseStateRoot, statePath) || !existsSync(statePath)) throw new Error("Valid --state is required.");
const evidencePath = `${statePath}.smoke.json`;
if (!existsSync(evidencePath)) throw new Error("Browser smoke evidence is missing.");

const state = readJson(statePath, "release state");
const evidence = readJson(evidencePath, "browser smoke evidence");
if (state.stateVersion !== 1 || evidence.nonce !== state.nonce || evidence.passed !== true) {
  throw new Error("Browser smoke evidence does not match this prepared release.");
}
if (!isWithin(projectsRoot, state.projectRoot)) throw new Error("State project path is outside 2.SA/projects.");
if (!isWithin(stagingBase, state.stagingRoot)) throw new Error("State staging path is invalid.");
if (!isWithin(state.stagingRoot, state.candidateRoot) || !isWithin(state.candidateRoot, state.siteRoot)) {
  throw new Error("State package paths are invalid.");
}
if (!isWithin(state.projectRoot, state.finalReleaseRoot)) throw new Error("Final release path is outside the project.");
if (existsSync(state.finalReleaseRoot)) throw new Error(`Immutable release already exists: ${state.finalReleaseRoot}`);
if (!existsSync(resolve(state.siteRoot, "index.html"))) throw new Error("Prepared site is missing index.html.");
if (hashFile(state.schemaPath) !== state.schemaSha256) throw new Error("Schema changed after prepare phase.");

let completed = false;
try {
  copyFileSync(state.schemaPath, resolve(state.candidateRoot, "crf-schema.json"));
  copyFileSync(state.programPath, resolve(state.candidateRoot, "program.yaml"));
  copyFileSync(state.formValidationPath, resolve(state.candidateRoot, "form-validation-report.md"));

  if (state.target === "iis" || state.target === "both") {
    const config = iisConfig(state.mountPath);
    writeFileSync(resolve(state.candidateRoot, "web.config"), config, "utf8");
    writeFileSync(resolve(state.siteRoot, "web.config"), config, "utf8");
  }
  if (state.target === "nginx" || state.target === "both") {
    writeFileSync(resolve(state.candidateRoot, "nginx.conf.example"), nginxConfig(state.mountPath), "utf8");
  }
  writeFileSync(resolve(state.candidateRoot, "DEPLOYMENT.md"), deploymentGuide(state), "utf8");

  const npmCliPath = process.env.npm_execpath;
  const npmVersion = npmCliPath
    ? runCommand(process.execPath, [npmCliPath, "--version"], { capture: true })
    : "unknown";
  const releaseManifest = {
    formId: state.formId,
    schemaVersion: state.schemaVersion,
    contractVersion: state.contractVersion,
    status: state.status,
    projectId: basename(state.projectRoot),
    sourceFileName: state.sourceManifest.sourceFileName,
    sourceSha256: state.sourceManifest.sha256,
    schemaSha256: state.schemaSha256,
    builtAt: new Date().toISOString(),
    nodeVersion: process.version,
    npmVersion,
    target: state.target,
    mountPath: state.mountPath,
    checks: [
      "target-schema-contract",
      "typescript-and-engine",
      "vitest-component-suite",
      "library-build",
      "static-demo-build",
      "chromium-firefox-webkit-release-smoke",
    ],
  };
  writeFileSync(resolve(state.candidateRoot, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");
  writeFileSync(
    resolve(state.candidateRoot, "release-validation-report.md"),
    `# Release validation report\n\n- Project: \`${releaseManifest.projectId}\`\n- Form: \`${state.formId}\`\n- Schema version: \`${state.schemaVersion}\`\n- Built at: \`${releaseManifest.builtAt}\`\n- Target schema compiler: passed\n- TypeScript and engine checks: passed\n- Vitest component suite: passed\n- Importable library build: passed\n- Static Demo build: passed\n- Chromium／Firefox／WebKit release smoke: passed\n\nThese checks do not establish clinical correctness or QMS validation.\n`,
    "utf8",
  );

  const archiveName = `${state.formId}-${state.schemaVersion}.zip`;
  const temporaryArchive = resolve(state.stagingRoot, archiveName);
  if (process.platform === "win32") {
    runCommand("tar.exe", ["-a", "-c", "-f", temporaryArchive, "-C", state.candidateRoot, "."]);
  } else {
    runCommand("zip", ["-rq", temporaryArchive, "."], { cwd: state.candidateRoot });
  }
  renameSync(temporaryArchive, resolve(state.candidateRoot, archiveName));

  mkdirSync(dirname(state.finalReleaseRoot), { recursive: true });
  try {
    renameSync(state.candidateRoot, state.finalReleaseRoot);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    cpSync(state.candidateRoot, state.finalReleaseRoot, { recursive: true, errorOnExist: true });
    rmSync(state.candidateRoot, { recursive: true, force: true });
  }
  completed = true;
  console.log(JSON.stringify({
    ok: true,
    releaseRoot: state.finalReleaseRoot,
    site: resolve(state.finalReleaseRoot, "site"),
    archive: resolve(state.finalReleaseRoot, archiveName),
  }, null, 2));
} finally {
  if (!completed && existsSync(state.finalReleaseRoot)) {
    console.error(`Inspect a possibly incomplete release: ${state.finalReleaseRoot}`);
  }
}

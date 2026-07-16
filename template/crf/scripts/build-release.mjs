import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const rendererRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(rendererRoot, "../..");
const projectsRoot = resolve(repositoryRoot, "2.SA/projects");
const releaseStateRoot = resolve(rendererRoot, "output/release-state");

function usage() {
  return [
    "Usage: build-release.mjs --schema <crf-schema.json> --project <prj_...> --state <state.json>",
    "Options: --target none|iis|nginx|both --mount-path /",
  ].join("\n");
}

function parseArguments(argv) {
  const result = { target: "none", mountPath: "/" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    if (key === "--schema") result.schema = value;
    else if (key === "--project") result.project = value;
    else if (key === "--state") result.state = value;
    else if (key === "--target") result.target = value;
    else if (key === "--mount-path") result.mountPath = value;
    else throw new Error(`Unknown argument: ${key}\n${usage()}`);
  }
  if (!result.schema || !result.project || !result.state) throw new Error(usage());
  return result;
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function normalizeMountPath(value) {
  let mountPath = value.trim().replaceAll("\\", "/");
  if (!mountPath.startsWith("/")) mountPath = `/${mountPath}`;
  if (!mountPath.endsWith("/")) mountPath += "/";
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(mountPath)) {
    throw new Error("--mount-path contains an unsafe URL path segment.");
  }
  return mountPath;
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

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: rendererRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
}

function runNpm(args, env) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) throw new Error("npm_execpath is missing; run this through npm run release.");
  runCommand(process.execPath, [npmCliPath, ...args], env);
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate a smoke-test port."));
        else resolvePort(port);
      });
    });
  });
}

const args = parseArguments(process.argv.slice(2));
const target = args.target.toLowerCase();
if (!new Set(["none", "iis", "nginx", "both"]).has(target)) {
  throw new Error("--target must be none, iis, nginx, or both.");
}

const mountPath = normalizeMountPath(args.mountPath);
const projectRoot = resolve(args.project);
const schemaPath = resolve(args.schema);
const statePath = resolve(args.state);
if (!isWithin(releaseStateRoot, statePath)) throw new Error("--state must be inside output/release-state.");
if (existsSync(statePath)) throw new Error(`Release state already exists: ${statePath}`);

if (!isWithin(projectsRoot, projectRoot) || !/^prj_\d{8}-\d{4}$/.test(basename(projectRoot))) {
  throw new Error(`--project must be a prj_yyyyMMdd-HHmm directory under ${projectsRoot}.`);
}
if (!existsSync(projectRoot) || !existsSync(schemaPath)) throw new Error("Project or schema path does not exist.");
if (!isWithin(projectRoot, schemaPath)) throw new Error("Schema must be inside the selected project package.");

const schema = readJson(schemaPath, "CRF schema");
const extension = schema["x-airwayai"];
const formId = extension?.formId;
const schemaVersion = extension?.schemaVersion;
if (typeof formId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(formId)) {
  throw new Error("formId must be stable lowercase kebab-case.");
}
if (typeof schemaVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(schemaVersion)) {
  throw new Error("schemaVersion must be SemVer.");
}
if (extension.status !== "demo") throw new Error("The first release pipeline accepts status: demo only.");

const expectedSchemaDirectory = resolve(projectRoot, "forms", formId, schemaVersion);
if (dirname(schemaPath) !== expectedSchemaDirectory || basename(schemaPath) !== "crf-schema.json") {
  throw new Error(`Schema must be forms/${formId}/${schemaVersion}/crf-schema.json.`);
}

const programPath = resolve(projectRoot, "analysis/program.yaml");
const traceabilityPath = resolve(projectRoot, "analysis/source-traceability.md");
const unresolvedPath = resolve(projectRoot, "analysis/unresolved-items.md");
const sourceManifestPath = resolve(projectRoot, "source/source-manifest.json");
const formValidationPath = resolve(expectedSchemaDirectory, "validation-report.md");
for (const requiredPath of [programPath, traceabilityPath, unresolvedPath, sourceManifestPath, formValidationPath]) {
  if (!existsSync(requiredPath)) throw new Error(`Missing release evidence: ${requiredPath}`);
}

const program = parseYaml(readFileSync(programPath, "utf8"));
if (program?.project_id !== basename(projectRoot)) throw new Error("program.yaml project_id does not match the package.");
if (program?.approvals?.clinical_meaning?.status !== "approved") {
  throw new Error("clinical_meaning is not approved.");
}
if (program?.approvals?.form_contract?.status !== "approved") {
  throw new Error("form_contract is not approved.");
}
const blockingItems = Array.isArray(program?.unresolved_items)
  ? program.unresolved_items.filter((item) => item?.severity === "blocking" && !item?.resolution)
  : [];
if (blockingItems.length > 0) throw new Error("Unresolved blocking items prevent release.");

const sourceManifest = readJson(sourceManifestPath, "source manifest");
const finalReleaseRoot = resolve(projectRoot, "releases", formId, schemaVersion);
if (existsSync(finalReleaseRoot)) throw new Error(`Immutable release already exists: ${finalReleaseRoot}`);

const nonce = randomUUID();
const stagingRoot = resolve(rendererRoot, "output", "release-staging", `${formId}-${schemaVersion}-${nonce}`);
const candidateRoot = resolve(stagingRoot, "package");
const siteRoot = resolve(candidateRoot, "site");
mkdirSync(candidateRoot, { recursive: true });

try {
  runNpm(["run", "validate:schema", "--", "--schema", schemaPath]);
  runNpm(["run", "check"]);
  runNpm(["test", "--", "--reporter=dot", "--maxWorkers=1"]);
  runNpm(["run", "build:lib"]);
  runNpm(["run", "build:demo"], {
    AIRWAYAI_CRF_SCHEMA_PATH: schemaPath,
    AIRWAYAI_OUT_DIR: siteRoot,
  });

  const smokePort = String(await getFreePort());
  const state = {
    stateVersion: 1,
    nonce,
    preparedAt: new Date().toISOString(),
    rendererRoot,
    projectRoot,
    schemaPath,
    schemaSha256: hashFile(schemaPath),
    programPath,
    formValidationPath,
    sourceManifestPath,
    sourceManifest,
    formId,
    schemaVersion,
    contractVersion: extension.contractVersion,
    status: extension.status,
    target,
    mountPath,
    stagingRoot,
    candidateRoot,
    siteRoot,
    finalReleaseRoot,
    smokePort,
  };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, phase: "prepared", statePath, siteRoot, smokePort }, null, 2));
} catch (error) {
  throw error;
}

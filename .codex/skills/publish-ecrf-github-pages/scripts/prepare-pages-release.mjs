#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function filesUnder(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      fail(`Symbolic links are not allowed in a Pages artifact: ${path}`);
    }
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyTree(sourceRoot, outputRoot) {
  const ignoredGenerated = new Set(["asset-manifest.json", "checksums.json", "checksums.sha256", ".nojekyll"]);
  for (const source of filesUnder(sourceRoot)) {
    const path = relative(sourceRoot, source).replaceAll("\\", "/");
    if (ignoredGenerated.has(path)) continue;
    const destination = resolve(outputRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function scanPublicBoundary(root) {
  const deniedSegments = new Set([".git", "node_modules", "server", ".wrangler"]);
  const deniedNames = [/^\.env/i, /credentials?/i, /private[-_.]?key/i, /\.pem$/i, /\.p12$/i, /\.pfx$/i, /\.map$/i];
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bgh[opsu]_[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bCDISC_LIBRARY_API_KEY\s*=/,
  ];

  for (const file of filesUnder(root)) {
    const path = relative(root, file).replaceAll("\\", "/");
    const segments = path.split("/");
    if (segments.some((segment) => deniedSegments.has(segment)) || deniedNames.some((rule) => rule.test(basename(file)))) {
      fail(`Denied public artifact file: ${path}`);
    }
    if (statSync(file).size <= 2_000_000) {
      const content = readFileSync(file, "utf8");
      if (secretPatterns.some((rule) => rule.test(content))) fail(`Possible credential detected in: ${path}`);
    }
  }
}

function workflow(branch, siteDirectory) {
  return `name: Deploy eCRF to GitHub Pages

on:
  push:
    branches: [${JSON.stringify(branch)}]
    paths:
      - ${JSON.stringify(`${siteDirectory}/**`)}
      - ".github/workflows/deploy-ecrf-pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Configure Pages
        uses: actions/configure-pages@v5
      - name: Upload exact QA artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: ${JSON.stringify(siteDirectory)}
      - name: Deploy Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
}

const bundleArgument = argument("--bundle");
const outputArgument = argument("--output");
const workflowArgument = argument("--workflow");
const branch = argument("--branch");
const replace = hasFlag("--replace");

if (!bundleArgument || !outputArgument || !workflowArgument || !branch) {
  fail("Usage: prepare-pages-release.mjs --bundle DIR --output DIR --workflow FILE --branch NAME [--replace]");
}
if (!/^[A-Za-z0-9._/-]+$/.test(branch)) fail("The branch name contains unsupported characters.");

const bundleRoot = resolve(bundleArgument);
const outputRoot = resolve(outputArgument);
const workflowPath = resolve(workflowArgument);
const repositoryRoot = resolve(dirname(workflowPath), "../..");
if (!existsSync(bundleRoot) || !statSync(bundleRoot).isDirectory()) fail(`Static bundle not found: ${bundleRoot}`);
if (bundleRoot === outputRoot || inside(bundleRoot, outputRoot)) fail("Output must not be inside the source bundle.");
if (outputRoot === repositoryRoot || !inside(repositoryRoot, outputRoot)) {
  fail("The Pages output must be a child directory of the repository resolved from the workflow path.");
}
if (!existsSync(resolve(bundleRoot, "index.html"))) fail("Static bundle is missing index.html.");

const sourceFiles = filesUnder(bundleRoot);
if (!sourceFiles.some((file) => file.endsWith(".js"))) fail("Static bundle is missing compiled JavaScript.");
if (!sourceFiles.some((file) => file.endsWith(".css"))) fail("Static bundle is missing compiled CSS.");
const sourceIndex = readFileSync(resolve(bundleRoot, "index.html"), "utf8");
if (/(?:src|href)=["']\/(?!\/)/i.test(sourceIndex)) {
  fail("index.html contains root-relative local assets that will break on a GitHub project page.");
}

if ((existsSync(outputRoot) || existsSync(workflowPath)) && !replace) {
  fail("Output or workflow already exists. Re-run with --replace only for the resolved generated targets.");
}
if (replace && basename(outputRoot) !== "github-pages") {
  fail("For safety, --replace is allowed only when the output directory is named github-pages.");
}
if (replace && !(basename(workflowPath) === "deploy-ecrf-pages.yml" && basename(dirname(workflowPath)) === "workflows")) {
  fail("For safety, --replace is allowed only for .github/workflows/deploy-ecrf-pages.yml.");
}

scanPublicBoundary(bundleRoot);
if (existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
copyTree(bundleRoot, outputRoot);
writeFileSync(resolve(outputRoot, ".nojekyll"), "", "utf8");

const publicFiles = filesUnder(outputRoot)
  .map((file) => ({
    path: relative(outputRoot, file).replaceAll("\\", "/"),
    bytes: statSync(file).size,
    sha256: sha256(file),
  }))
  .sort((left, right) => left.path.localeCompare(right.path));
const manifestPath = resolve(outputRoot, "asset-manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify({ manifestVersion: 1, renderingMode: "precompiled_static_react", entry: "index.html", files: publicFiles }, null, 2)}\n`,
  "utf8",
);
const checksumFiles = [...filesUnder(outputRoot), manifestPath]
  .filter((file, index, all) => all.indexOf(file) === index && basename(file) !== "checksums.sha256")
  .map((file) => `${sha256(file)}  ${relative(outputRoot, file).replaceAll("\\", "/")}`)
  .sort();
const checksumsPath = resolve(outputRoot, "checksums.sha256");
writeFileSync(checksumsPath, `${checksumFiles.join("\n")}\n`, "utf8");

mkdirSync(dirname(workflowPath), { recursive: true });
const siteDirectory = relative(repositoryRoot, outputRoot).replaceAll("\\", "/");
writeFileSync(workflowPath, workflow(branch, siteDirectory), "utf8");

console.log(JSON.stringify({
  ok: true,
  output: outputRoot,
  workflow: workflowPath,
  manifest: manifestPath,
  checksums: checksumsPath,
  fileCount: filesUnder(outputRoot).length,
}, null, 2));

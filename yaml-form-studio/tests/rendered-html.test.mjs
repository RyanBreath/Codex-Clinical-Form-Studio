import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function builtClientText() {
  const assets = new URL("../dist/client/assets/", import.meta.url);
  const names = await readdir(assets);
  const javascript = names.filter((name) => name.endsWith(".js"));
  return Promise.all(javascript.map((name) => readFile(new URL(name, assets), "utf8"))).then((parts) => parts.join("\n"));
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

test("emits a precompiled HTML, JavaScript, CSS, manifest, and checksum bundle", async () => {
  const [html, manifest, checksums] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/asset-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/checksums.sha256", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<title>AirwayAI eCRF Studio<\/title>/);
  assert.match(html, /<script[^>]+type="module"[^>]+src="\/assets\//);
  assert.equal(JSON.parse(manifest).renderingMode, "precompiled-static-react");
  assert.match(checksums, /client\/index\.html/);
  await access(new URL("../dist/client/cdash-model-v1.3.json", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await assert.rejects(access(new URL("../dist/server/ssr/index.js", import.meta.url)));
});

test("ships the CDASH review and selection UI in the static client", async () => {
  const text = await builtClientText();
  assert.match(text, /Search CDASH/);
  assert.match(text, /Use and write to YAML/);
  assert.match(text, /CDASH Model v1\.3/);
  assert.match(text, /Add as unresolved field/);
});

test("worker delegates HTML to static assets instead of rendering it", async () => {
  const worker = await loadWorker();
  const sentinel = "<!doctype html><title>precompiled sentinel</title>";
  const response = await worker.fetch(new Request("https://example.test/"), {
    ASSETS: {
      fetch: async () => new Response(sentinel, { headers: { "content-type": "text/html" } }),
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), sentinel);
});

test("confirmation requires authenticated identity and complete CDASH review", async () => {
  const worker = await loadWorker();
  const program = {
    project_id: "prj-test",
    selected_form: {
      candidate_id: "baseline",
      approval_status: "pending",
      fields: [
        {
          concept_id: "age",
          label: "Age",
          data_type: "number",
          required: true,
          source_refs: [{ locator: "Protocol p. 4" }],
          coding: {
            status: "matched",
            rationale: "Reviewer selected DM.AGE from CDASH Model v1.3.",
            standard: "CDISC",
            model: "CDASH",
            version: "1.3",
            domain: "DM",
            variable: "AGE",
            source_url: "https://www.cdisc.org/standards/foundational/cdash/cdash-model-v1-3",
          },
        },
      ],
    },
    unresolved_items: [],
  };
  const unauthenticated = await worker.fetch(
    new Request("https://example.test/api/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yaml: JSON.stringify(program) }),
    }),
    {},
  );
  assert.equal(unauthenticated.status, 401);

  const authenticated = await worker.fetch(
    new Request("https://example.test/api/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-email": "reviewer@example.test",
        "oai-authenticated-user-full-name": "Clinical%20Reviewer",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
      body: JSON.stringify({ yaml: JSON.stringify(program) }),
    }),
    {},
  );
  assert.equal(authenticated.status, 200);
  const body = await authenticated.json();
  assert.match(body.yaml, /approved_by: Clinical Reviewer <reviewer@example\.test>/);
});

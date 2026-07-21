import { parse, stringify } from "yaml";

type Actor = { displayName: string; email: string; fullName: string | null };
type Coding = {
  status?: string;
  rationale?: string | null;
  standard?: string;
  model?: string;
  version?: string;
  domain?: string;
  variable?: string;
  source_url?: string;
};
type Field = {
  concept_id?: string;
  label?: string;
  data_type?: string;
  required?: boolean | "unresolved";
  source_refs?: Array<{ locator?: string }>;
  coding?: Coding;
};
type Program = {
  selected_form?: {
    approval_status?: string;
    fields?: Field[];
    [key: string]: unknown;
  };
  unresolved_items?: Array<{ severity?: string; resolution?: unknown }>;
  approvals?: Record<string, unknown>;
};
type Env = {
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safeDecode(value: string | null, encoding: string | null) {
  if (!value || encoding !== "percent-encoded-utf-8") return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function getActor(request: Request): Actor | null {
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  if (!email) return null;
  const fullName = safeDecode(
    request.headers.get("oai-authenticated-user-full-name"),
    request.headers.get("oai-authenticated-user-full-name-encoding"),
  );
  return { displayName: fullName ?? email, email, fullName };
}

function validationIssue(program: Program): string | null {
  const fields = program.selected_form?.fields ?? [];
  if (!fields.length) return "Confirmation requires at least one selected-form field.";
  const blocking = (program.unresolved_items ?? []).some(
    (item) => item.severity === "blocking" && !item.resolution,
  );
  if (blocking) return "Confirmation is blocked by unresolved blocking items.";

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const name = `Field ${index + 1}`;
    if (!field.concept_id || !field.label) return `${name} is missing its concept ID or label.`;
    if (!field.data_type || field.data_type === "unresolved") return `${name} has an unresolved data type.`;
    if (field.required === undefined || field.required === "unresolved") {
      return `${name} has unresolved requiredness.`;
    }
    if (!field.source_refs?.[0]?.locator) return `${name} requires a protocol source locator.`;
    const coding = field.coding;
    if (!coding?.status || coding.status === "unresolved") return `${name} has unresolved CDISC coding.`;
    if (coding.status === "not-applicable" && !coding.rationale) {
      return `${name} requires a rationale for not-applicable coding.`;
    }
    if (coding.status === "matched") {
      if (
        coding.standard !== "CDISC" ||
        coding.model !== "CDASH" ||
        coding.version !== "1.3" ||
        !coding.domain ||
        !coding.variable ||
        !coding.source_url ||
        !coding.rationale
      ) {
        return `${name} does not contain a complete CDASH Model v1.3 mapping.`;
      }
    }
  }
  return null;
}

async function confirmYaml(request: Request) {
  const actor = getActor(request);
  if (!actor) return json({ error: "Authentication is required." }, 401);
  const rawBody = await request.text();
  if (rawBody.length > 2_100_000) return json({ error: "The request is too large." }, 413);

  let body: { yaml?: string };
  try {
    body = JSON.parse(rawBody) as { yaml?: string };
  } catch {
    return json({ error: "A JSON request containing YAML is required." }, 400);
  }
  if (!body.yaml || body.yaml.length > 2_000_000) {
    return json({ error: "A supported YAML document is required." }, 400);
  }
  if (/^\s*(---|%|!|&|\*|<<:)/m.test(body.yaml)) {
    return json({ error: "Unsafe YAML constructs are not supported." }, 400);
  }

  try {
    const program = parse(body.yaml) as Program;
    const issue = validationIssue(program);
    if (issue) return json({ error: issue }, 422);
    const approvedAt = new Date().toISOString();
    const approvedBy = `${actor.displayName} <${actor.email}>`;
    if (program.selected_form) program.selected_form.approval_status = "approved";
    program.approvals = {
      clinical_meaning: {
        status: "approved",
        approved_by: approvedBy,
        approved_at: approvedAt,
      },
      form_contract: {
        status: "approved",
        approved_by: approvedBy,
        approved_at: approvedAt,
      },
    };
    return json({ yaml: stringify(program) });
  } catch {
    return json({ error: "YAML could not be confirmed." }, 400);
  }
}

async function serveStatic(request: Request, env: Env) {
  if (!env.ASSETS) return new Response("Static asset binding is unavailable.", { status: 503 });
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || request.method !== "GET") return response;
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return response;
  return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/me" && request.method === "GET") {
      const actor = getActor(request);
      return json({ actor: actor ? { name: actor.displayName, email: actor.email } : null });
    }
    if (url.pathname === "/api/confirm") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      return confirmYaml(request);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return serveStatic(request, env);
  },
};

export default worker;

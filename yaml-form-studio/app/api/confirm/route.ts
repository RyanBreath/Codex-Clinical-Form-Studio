import { NextResponse } from "next/server";
import { parse, stringify } from "yaml";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const body = (await request.json()) as { yaml?: string };
  if (!body.yaml || body.yaml.length > 2_000_000) return NextResponse.json({ error: "A supported YAML document is required." }, { status: 400 });
  try {
    const program = parse(body.yaml) as { selected_form?: { fields?: unknown[]; [key: string]: unknown }; unresolved_items?: { severity?: string; resolution?: unknown }[]; approvals?: Record<string, unknown> };
    const blocking = (program.unresolved_items ?? []).some((item) => item.severity === "blocking" && !item.resolution);
    if (!program.selected_form?.fields?.length || blocking) return NextResponse.json({ error: "Confirmation is blocked by missing fields or unresolved blocking items." }, { status: 422 });
    const at = new Date().toISOString();
    const by = `${user.displayName} <${user.email}>`;
    program.selected_form.approval_status = "approved";
    program.approvals = { clinical_meaning: { status: "approved", approved_by: by, approved_at: at }, form_contract: { status: "approved", approved_by: by, approved_at: at } };
    return NextResponse.json({ yaml: stringify(program) });
  } catch {
    return NextResponse.json({ error: "YAML could not be confirmed." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const key = process.env.CDISC_LIBRARY_API_KEY;
  const endpoint = process.env.CDASH_API_URL;
  const query = new URL(request.url).searchParams.get("query")?.trim();
  if (!query)
    return NextResponse.json(
      { error: "A field query is required." },
      { status: 400 },
    );
  if (!key || !endpoint)
    return NextResponse.json(
      {
        error:
          "CDASH lookup is not configured. Set CDISC_LIBRARY_API_KEY and CDASH_API_URL in the hosted environment.",
      },
      { status: 503 },
    );
  try {
    const target = new URL(endpoint);
    target.searchParams.set("q", query);
    const response = await fetch(target, {
      headers: { "api-key": key, Accept: "application/json" },
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "CDASH Library did not return a usable response." },
        { status: 502 },
      );
    const body = (await response.json()) as {
      items?: Array<Record<string, unknown>>;
    };
    const candidates = (body.items ?? [])
      .slice(0, 8)
      .map((item) => ({
        label: String(
          item.label ?? item.name ?? item.title ?? "Unnamed CDASH record",
        ),
        domain: item.domain ? String(item.domain) : undefined,
        variable: item.variable ? String(item.variable) : undefined,
        source: target.origin,
        confidence: "Review required",
      }));
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json(
      { error: "Unable to reach the configured CDASH API." },
      { status: 502 },
    );
  }
}

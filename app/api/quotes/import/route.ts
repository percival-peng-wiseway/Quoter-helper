import { extractImportedQuotePayloads } from "../../../../lib/quote-transfer";
import { importQuotes, requireViewer } from "../../../../lib/server/store";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as unknown;
    const payloads = extractImportedQuotePayloads(body);
    const imported = await importQuotes(viewer, payloads);
    return Response.json({ imported, status: "done" });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import quotes" }, { status: 400 });
  }
}

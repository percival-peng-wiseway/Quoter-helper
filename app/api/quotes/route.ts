import type { QuoteInputs } from "../../../lib/model";
import { requireViewer, saveQuote } from "../../../lib/server/store";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { id?: string | null; payload?: QuoteInputs };
    if (!body.payload) return Response.json({ error: "Quote inputs are required" }, { status: 400 });
    const id = await saveQuote(viewer, body.id ?? null, body.payload);
    return Response.json({ id });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save quote" }, { status: 500 });
  }
}

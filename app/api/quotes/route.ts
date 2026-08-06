import type { QuoteInputs, QuoteStatus } from "../../../lib/model";
import { deleteQuote, requireViewer, saveQuote, updateQuoteStatus } from "../../../lib/server/store";

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

export async function PUT(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { id?: string; status?: QuoteStatus };
    if (!body.id || !body.status || !["drafting", "done"].includes(body.status)) {
      return Response.json({ error: "A valid quote and status are required" }, { status: 400 });
    }
    await updateQuoteStatus(viewer, body.id, body.status);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update quote status" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { id?: string };
    if (!body.id) return Response.json({ error: "A valid quote is required" }, { status: 400 });
    await deleteQuote(viewer, body.id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete quote" }, { status: 500 });
  }
}

import { deleteQuote, requireViewer } from "../../../../lib/server/store";

export async function POST(request: Request) {
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

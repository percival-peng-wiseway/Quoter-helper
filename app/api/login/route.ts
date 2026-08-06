import { loginWithPassword } from "../../../lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "Enter your username and password" }, { status: 400 });
    }
    const clientAddress = request.headers.get("cf-connecting-ip") ?? "unknown";
    const result = await loginWithPassword(body.username, body.password, clientAddress);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to sign in" },
      { status: 500 },
    );
  }
}

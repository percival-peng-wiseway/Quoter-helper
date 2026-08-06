import { logoutCurrentSession } from "../../../lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await logoutCurrentSession();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to sign out" },
      { status: 500 },
    );
  }
}

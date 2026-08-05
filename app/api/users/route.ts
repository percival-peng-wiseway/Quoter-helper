import type { Role } from "../../../lib/model";
import { requireViewer, updateUserRole } from "../../../lib/server/store";

export async function PUT(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { userId?: string; role?: Role };
    if (!body.userId || !body.role || !["admin", "user"].includes(body.role)) {
      return Response.json({ error: "用户或角色无效" }, { status: 400 });
    }
    await updateUserRole(viewer, body.userId, body.role);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 });
  }
}

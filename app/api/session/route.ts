import { getSettings, listQuotes, listUsers, requireViewer } from "../../../lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await requireViewer();
    const [settings, quotes, users] = await Promise.all([
      getSettings(),
      listQuotes(viewer),
      listUsers(viewer),
    ]);
    return Response.json({ viewer, settings, quotes, users });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "加载失败" }, { status: 500 });
  }
}

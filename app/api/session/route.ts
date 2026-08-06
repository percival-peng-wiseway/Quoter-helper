import { getSettings, listNotifications, listQuotes, listUsers, requireViewer } from "../../../lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await requireViewer();
    const [settings, quotes, users, notifications] = await Promise.all([
      getSettings(),
      listQuotes(),
      listUsers(viewer),
      listNotifications(),
    ]);
    return Response.json({ viewer, settings, quotes, users, notifications });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load data" }, { status: 500 });
  }
}

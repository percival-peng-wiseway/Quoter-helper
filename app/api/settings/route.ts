import type { AppSettings } from "../../../lib/model";
import { requireViewer, updateSettings } from "../../../lib/server/store";

export async function PUT(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = await request.json() as { settings?: AppSettings };
    if (!payload.settings?.inverters?.length || !payload.settings?.batteries?.length) {
      return Response.json({ error: "Equipment catalogues cannot be empty" }, { status: 400 });
    }
    const settings = {
      ...payload.settings,
      thresholds: {
        approval: Math.round(payload.settings.thresholds.approval * 1_000_000) / 1_000_000,
        target: Math.round(payload.settings.thresholds.target * 1_000_000) / 1_000_000,
      },
    };
    await updateSettings(viewer, settings);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save settings" }, { status: 500 });
  }
}

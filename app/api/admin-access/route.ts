import { env } from "cloudflare:workers";
import { grantViewerAdminAccess, requireViewer } from "../../../lib/server/store";

export const dynamic = "force-dynamic";

function configuredAdminPassword(): string | null {
  const runtimeEnv = env as unknown as { ADMIN_PASSWORD?: string };
  const password = runtimeEnv.ADMIN_PASSWORD?.trim();
  return password || null;
}

async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length === 0) {
      return Response.json({ error: "Enter the administrator password" }, { status: 400 });
    }

    const expected = configuredAdminPassword();
    if (!expected) {
      return Response.json(
        { error: "Administrator access is not configured" },
        { status: 503 },
      );
    }
    if (!(await secretsMatch(body.password, expected))) {
      return Response.json({ error: "Incorrect administrator password" }, { status: 403 });
    }

    await grantViewerAdminAccess(viewer);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to grant administrator access" },
      { status: 500 },
    );
  }
}

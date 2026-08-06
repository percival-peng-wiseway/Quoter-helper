import { cookies, headers } from "next/headers";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const CLOUDFLARE_ACCESS_EMAIL_HEADER =
  "cf-access-authenticated-user-email";
const PUBLIC_VISITOR_COOKIE = "e3-quoter-visitor";
const PUBLIC_VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const PUBLIC_VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();

  const accessEmail = requestHeaders.get(CLOUDFLARE_ACCESS_EMAIL_HEADER)?.trim();
  if (accessEmail) {
    const normalizedEmail = accessEmail.toLowerCase();
    return {
      userId: `cloudflare-access:${normalizedEmail}`,
      displayName: accessEmail,
      email: accessEmail,
      fullName: null,
    };
  }

  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function getPublicVisitor(): Promise<ChatGPTUser> {
  const cookieStore = await cookies();
  const existingVisitorId = cookieStore.get(PUBLIC_VISITOR_COOKIE)?.value;
  const visitorId = existingVisitorId && PUBLIC_VISITOR_ID.test(existingVisitorId)
    ? existingVisitorId
    : crypto.randomUUID();

  if (visitorId !== existingVisitorId) {
    cookieStore.set(PUBLIC_VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      maxAge: PUBLIC_VISITOR_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  const shortId = visitorId.slice(0, 8);
  return {
    userId: `public-visitor:${visitorId}`,
    displayName: `Guest ${shortId}`,
    email: `guest-${shortId}@public.invalid`,
    fullName: null,
  };
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

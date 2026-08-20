import { cookies } from "next/headers";
import { getRawDb } from "../../db";
import type { Role } from "../model";

const SESSION_COOKIE = "e3-quoter-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
const PBKDF2_ITERATIONS = 100_000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

type LoginAccount = {
  username: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  salt: string;
  passwordHash: string;
};

export type AuthenticatedAccount = Omit<LoginAccount, "salt" | "passwordHash">;

const LOGIN_ACCOUNTS: LoginAccount[] = [
  {
    username: "sam",
    userId: "password-account:sam",
    email: "sam@e3energy.com.au",
    displayName: "Sam",
    role: "user",
    salt: "hZFC0GJKkB+WkGAUck1Rmw==",
    passwordHash: "XOdL3EFo9MiexxPDov2sYuPT6pHhmgob36kcgCEDZUY=",
  },
  {
    username: "ruihan",
    userId: "password-account:ruihan",
    email: "ruihan@e3energy.com.au",
    displayName: "Ruihan",
    role: "user",
    salt: "3fn1b1YfcAz7CQ890Dabkw==",
    passwordHash: "JDYKjlACbgDNICltvgdetIfRmltqz4Ydn3gxHEHv5/g=",
  },
  {
    username: "kevin",
    userId: "password-account:kevin",
    email: "kevin@e3energy.com.au",
    displayName: "Kevin",
    role: "user",
    salt: "63FRShjLx/UXbwgduqm8jA==",
    passwordHash: "a9hrBfWiOBUCwtT5lb5OFk9IEDivhoWsuHeybDq95A4=",
  },
  {
    username: "daniel",
    userId: "password-account:daniel",
    email: "daniel@e3energy.com.au",
    displayName: "Daniel",
    role: "user",
    salt: "TSVo9+zZf7N83TXTq0GZCw==",
    passwordHash: "L52dyrwRd8LGVtUvBLY6XFIIMdzxH1N3Qub1GP+4RCo=",
  },
  {
    username: "wendy",
    userId: "password-account:wendy",
    email: "wendy@e3energy.com.au",
    displayName: "Wendy",
    role: "user",
    salt: "0N5P9V/nOiPKhRqMBUMnjQ==",
    passwordHash: "iO77z34Gapn+VKRrBZHaNyIGpwd2pZqKzuNxTZWyDLs=",
  },
  {
    username: "hogan",
    userId: "password-account:hogan",
    email: "hogan@e3energy.com.au",
    displayName: "Hogan",
    role: "admin",
    salt: "HgMeLVZVFs2dZLroxJjCKw==",
    passwordHash: "J1UZHRn8bhFQJstVnDe7Nmdlcq4ERwbOoSrKGowS3HY=",
  },
  {
    username: "admin",
    userId: "password-account:admin",
    email: "admin@e3energy.com.au",
    displayName: "Admin",
    role: "admin",
    salt: "G2ix9cx+lkma8yjoGj1uSw==",
    passwordHash: "dyv6GusPJIZIC7ClN5trla8r8+aBQKIOKsD7XCHWwzo=",
  },
];

const DUMMY_CREDENTIALS = {
  salt: "U5zvAHidSCsyQhVKZGjQLg==",
  passwordHash: "5VSCOiodI0soUqf7lH5IasXF0iUs6m8T28ft+YeDUZA=",
};

let authSchemaReady = false;

export async function ensureAuthSchema() {
  if (authSchemaReady) return;
  const db = getRawDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      failure_count INTEGER NOT NULL,
      first_failed_at INTEGER NOT NULL,
      blocked_until INTEGER
    )`),
    ...LOGIN_ACCOUNTS.map((account) => db.prepare(`INSERT INTO users
      (user_id, email, display_name, role) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role`)
      .bind(account.userId, account.email, account.displayName, account.role)),
  ]);
  authSchemaReady = true;
}

export async function loginWithPassword(
  usernameInput: string,
  password: string,
  clientAddress: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 429; error: string }> {
  await ensureAuthSchema();
  const username = usernameInput.trim().toLowerCase();
  const account = LOGIN_ACCOUNTS.find((candidate) => candidate.username === username);
  const attemptKey = await sha256Hex(`${clientAddress}:${username || "unknown"}`);
  const now = Date.now();
  const db = getRawDb();
  const attempt = await db.prepare(`SELECT failure_count, first_failed_at, blocked_until
    FROM login_attempts WHERE attempt_key = ?`).bind(attemptKey).first<{
      failure_count: number;
      first_failed_at: number;
      blocked_until: number | null;
    }>();

  if (attempt?.blocked_until && attempt.blocked_until > now) {
    return { ok: false, status: 429, error: "Too many sign-in attempts. Try again in 15 minutes." };
  }

  const credentials = account ?? DUMMY_CREDENTIALS;
  const validPassword = await verifyPassword(password, credentials.salt, credentials.passwordHash);
  if (!account || !validPassword) {
    await recordLoginFailure(attemptKey, attempt, now);
    return { ok: false, status: 401, error: "Incorrect username or password" };
  }

  await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(attemptKey).run();
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run();

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  await db.prepare(`INSERT INTO auth_sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)`).bind(tokenHash, account.userId, expiresAt).run();

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}

export async function getAuthenticatedAccount(): Promise<AuthenticatedAccount | null> {
  await ensureAuthSchema();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const tokenHash = await sha256Hex(token);
  const row = await getRawDb().prepare(`SELECT u.user_id, u.email, u.display_name, u.role
    FROM auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(tokenHash, Date.now())
    .first<{ user_id: string; email: string; display_name: string; role: Role }>();
  if (!row) return null;

  const account = LOGIN_ACCOUNTS.find((candidate) => candidate.userId === row.user_id);
  if (!account) return null;
  return {
    username: account.username,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function logoutCurrentSession() {
  await ensureAuthSchema();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await getRawDb().prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function recordLoginFailure(
  attemptKey: string,
  existing: { failure_count: number; first_failed_at: number; blocked_until: number | null } | null,
  now: number,
) {
  const withinWindow = Boolean(existing && now - existing.first_failed_at < LOGIN_WINDOW_MS);
  const failureCount = withinWindow ? (existing?.failure_count ?? 0) + 1 : 1;
  const firstFailedAt = withinWindow ? existing!.first_failed_at : now;
  const blockedUntil = failureCount >= MAX_LOGIN_FAILURES ? now + LOGIN_BLOCK_MS : null;
  await getRawDb().prepare(`INSERT INTO login_attempts
    (attempt_key, failure_count, first_failed_at, blocked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET
      failure_count = excluded.failure_count,
      first_failed_at = excluded.first_failed_at,
      blocked_until = excluded.blocked_until`)
    .bind(attemptKey, failureCount, firstFailedAt, blockedUntil)
    .run();
}

async function verifyPassword(password: string, saltBase64: string, expectedHashBase64: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: base64Bytes(saltBase64),
  }, key, 256));
  return constantTimeEqual(derived, base64Bytes(expectedHashBase64));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function base64Bytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

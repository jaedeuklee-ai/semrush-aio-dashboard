// Method A — shared password gate.
// The session cookie holds a token derived from APP_PASSWORD + AUTH_SECRET
// (never the raw password). Middleware recomputes the expected token and
// compares. Uses Web Crypto so it works in both the edge middleware and
// Node route handlers.

export const AUTH_COOKIE = "aio_auth";

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The valid session token for the currently configured password + secret.
export async function expectedToken(): Promise<string> {
  const pw = process.env.APP_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  return sha256hex(`${pw}|${secret}`);
}

// Is the gate turned on? (Only enforce once a password is configured, so
// deploying the code without env vars never locks anyone out.)
export function gateEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

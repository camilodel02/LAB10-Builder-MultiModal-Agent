import type { DbClient } from "../client";
import { decrypt, encrypt } from "../crypto";
import { revokeIntegration, upsertIntegration } from "./integrations";

const EXPIRY_SKEW_MS = 60_000;

export type GoogleTokenPayload = {
  access_token: string;
  refresh_token?: string | null;
  token_type?: string;
  scope?: string;
  expires_at?: number | null;
};

/**
 * Returns a valid Google OAuth access token for the user, refreshing with
 * refresh_token when the stored access token is expired.
 */
export async function resolveGoogleAccessToken(
  db: DbClient,
  userId: string
): Promise<string | undefined> {
  const { data: integration, error } = await db
    .from("user_integrations")
    .select("encrypted_tokens, scopes")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("status", "active")
    .maybeSingle();

  if (error || !integration?.encrypted_tokens) {
    return undefined;
  }

  let payload: GoogleTokenPayload;
  try {
    const decrypted = decrypt(integration.encrypted_tokens as string);
    payload = JSON.parse(decrypted) as GoogleTokenPayload;
  } catch (err) {
    console.error("Google token decrypt/parse failed:", err);
    return undefined;
  }

  if (!payload.access_token) {
    return undefined;
  }

  const expiresAt = payload.expires_at ?? null;
  const isExpired =
    expiresAt != null && Date.now() > expiresAt - EXPIRY_SKEW_MS;

  if (!isExpired) {
    return payload.access_token;
  }

  const refreshToken = payload.refresh_token;
  if (!refreshToken) {
    console.warn(
      "[google] Access token expired and no refresh_token; user must reconnect Google in Settings."
    );
    return undefined;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "[google] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET; cannot refresh token."
    );
    return undefined;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
    if (tokenData.error === "invalid_grant") {
      console.error(
        "[google] Refresh token expired or revoked. User must reconnect Google in Settings.",
        tokenData
      );
      await revokeIntegration(db, userId, "google").catch(() => {
        /* ignore if row missing */
      });
    } else {
      console.error("[google] Token refresh failed:", tokenData);
    }
    return undefined;
  }

  const expiresIn = Number(tokenData.expires_in ?? 0);
  const newExpiresAt =
    expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
  const newRefresh =
    typeof tokenData.refresh_token === "string"
      ? tokenData.refresh_token
      : refreshToken;

  const newPayload: GoogleTokenPayload = {
    access_token: tokenData.access_token as string,
    refresh_token: newRefresh,
    token_type:
      (tokenData.token_type as string | undefined) ?? payload.token_type,
    scope:
      (typeof tokenData.scope === "string" ? tokenData.scope : undefined) ??
      payload.scope,
    expires_at: newExpiresAt,
  };

  const scopes = (integration.scopes as string[]) ?? [];
  await upsertIntegration(
    db,
    userId,
    "google",
    scopes,
    encrypt(JSON.stringify(newPayload))
  );

  return newPayload.access_token;
}

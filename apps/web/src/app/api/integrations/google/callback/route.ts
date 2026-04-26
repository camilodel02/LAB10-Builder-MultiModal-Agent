import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, encrypt, upsertIntegration } from "@agents/db";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=${errorParam}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("google_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=state_mismatch`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=no_code`
    );
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    `${origin}/api/integrations/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
    console.error("Google token exchange failed:", tokenData);
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=token_exchange`
    );
  }

  const scopeString =
    typeof tokenData.scope === "string" ? tokenData.scope : "";
  const scopes = scopeString
    ? scopeString.split(" ").filter(Boolean)
    : [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
      ];

  const expiresIn = Number(tokenData.expires_in ?? 0);
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
  const encryptedTokenPayload = encrypt(
    JSON.stringify({
      access_token: tokenData.access_token as string,
      refresh_token: (tokenData.refresh_token as string | undefined) ?? null,
      token_type: (tokenData.token_type as string | undefined) ?? "Bearer",
      scope: scopeString,
      expires_at: expiresAt,
    })
  );

  const db = createServerClient();
  await upsertIntegration(
    db,
    user.id,
    "google",
    scopes,
    encryptedTokenPayload
  );

  const response = NextResponse.redirect(`${origin}/settings?google=connected`);
  response.cookies.delete("google_oauth_state");
  return response;
}

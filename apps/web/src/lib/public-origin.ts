/**
 * Base URL of the app as seen by the user's browser (HTTPS in production).
 * Used for post-OAuth redirects so users never land on the wrong host if
 * GOOGLE_REDIRECT_URI / proxies disagree with Request.url.
 */
export function getPublicAppOrigin(requestUrl: string): string {
  const trimmed = (value: string | undefined) => value?.trim().replace(/\/+$/, "");

  const explicit =
    trimmed(process.env.NEXT_PUBLIC_APP_URL) ||
    trimmed(process.env.APP_PUBLIC_URL) ||
    trimmed(process.env.PUBLIC_APP_URL);
  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`).origin;
    } catch {
      /* fall through */
    }
  }

  const railwayHost = trimmed(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayHost) {
    return `https://${railwayHost}`;
  }

  const googleRedirect = trimmed(process.env.GOOGLE_REDIRECT_URI);
  if (googleRedirect) {
    try {
      return new URL(googleRedirect).origin;
    } catch {
      /* fall through */
    }
  }

  return new URL(requestUrl).origin;
}

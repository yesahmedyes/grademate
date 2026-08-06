import { cache } from "react";
import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";

export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Build an authorized OAuth2 client for a signed-in teacher.
 * googleapis auto-refreshes the access token from the refresh token when
 * expired; the "tokens" listener persists refreshed tokens back to the DB.
 *
 * Memoized per request: every ClassroomAPI method calls this, so without the
 * cache a page listing N courses would read the accounts row N+1 times and
 * attach N+1 duplicate "tokens" listeners.
 */
export const googleAuthFor = cache(async function googleAuthFor(
  userId: string
): Promise<GoogleAuthClient> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
  });
  if (!account || (!account.access_token && !account.refresh_token)) {
    throw new Error("No linked Google account — sign in with Google first.");
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  client.on("tokens", (tokens) => {
    void (async () => {
      try {
        await db
          .update(accounts)
          .set({
            access_token: tokens.access_token ?? undefined,
            expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
            refresh_token: tokens.refresh_token ?? undefined,
          })
          .where(
            and(
              eq(accounts.provider, "google"),
              eq(accounts.providerAccountId, account.providerAccountId)
            )
          );
      } catch {
        // best-effort token refresh persistence
      }
    })();
  });

  return client;
});

export function classroomClient(auth: GoogleAuthClient) {
  return google.classroom({ version: "v1", auth });
}

export function driveClient(auth: GoogleAuthClient) {
  return google.drive({ version: "v3", auth });
}

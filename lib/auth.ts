import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

export const MOCK_MODE = process.env.USE_MOCK_CLASSROOM === "true";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.profile.photos",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // offline + consent → refresh token on every sign-in (Testing-mode tokens expire after 7 days)
      authorization: {
        params: { access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES },
      },
    }),
    ...(MOCK_MODE
      ? [
          Credentials({
            id: "demo",
            name: "Demo Teacher",
            credentials: {},
            async authorize() {
              const [user] = await db
                .insert(users)
                .values({ email: "demo@grademate.local", name: "Demo Teacher" })
                .onConflictDoUpdate({
                  target: users.email,
                  set: { name: "Demo Teacher" },
                })
                .returning();
              return user;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    // The adapter only stores tokens on first link; keep them fresh on every sign-in.
    async signIn({ account }) {
      if (account?.provider !== "google" || !account.access_token) return;
      try {
        await db
          .update(accounts)
          .set({
            access_token: account.access_token,
            expires_at: account.expires_at ?? undefined,
            refresh_token: account.refresh_token ?? undefined,
            scope: account.scope ?? undefined,
            id_token: account.id_token ?? undefined,
          })
          .where(
            and(
              eq(accounts.provider, "google"),
              eq(accounts.providerAccountId, account.providerAccountId)
            )
          );
      } catch {
        // first sign-in: linkAccount already wrote the row
      }
    },
  },
});

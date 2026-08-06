import { redirect } from "next/navigation";
import { auth, signIn, MOCK_MODE } from "@/lib/auth";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* blob shapes, like the inspo */}
      <div className="pointer-events-none absolute -top-28 -left-24 h-96 w-96 rounded-[45%_55%_60%_40%/50%_45%_55%_50%] bg-sky/70" />
      <div className="pointer-events-none absolute -bottom-40 -right-28 h-[30rem] w-[30rem] rounded-[55%_45%_40%_60%/45%_55%_45%_55%] bg-butter/70" />
      <div className="pointer-events-none absolute bottom-24 left-16 hidden h-24 w-24 rounded-[50%_50%_45%_55%/55%_45%_55%_45%] bg-coral/60 md:block" />
      <div className="pointer-events-none absolute top-24 right-24 hidden h-16 w-16 rounded-[50%_50%_45%_55%/55%_45%_55%_45%] bg-leaf/60 lg:block" />

      <div className="relative w-full max-w-md rounded-[2rem] bg-white p-10 shadow-card">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral text-2xl font-bold text-white">
          G
        </span>
        <h1 className="mt-6 text-3xl font-light tracking-tight">
          Grade<span className="font-semibold">Mate</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          AI-assisted grading for Google Classroom. Sign in with the Google account you teach with.
        </p>

        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button
            type="submit"
            className="flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-ink/15 bg-white text-sm font-medium transition-colors hover:bg-panel"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </form>

        {MOCK_MODE && (
          <form
            className="mt-3"
            action={async () => {
              "use server";
              await signIn("demo", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-navy text-sm font-medium text-white transition-colors hover:bg-navy-soft"
            >
              Continue as Demo Teacher
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

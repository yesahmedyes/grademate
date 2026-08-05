import Link from "next/link";
import { Calendar, LayoutGrid, LogOut, MessageCircle, Paperclip, Settings } from "lucide-react";
import { signOut } from "@/lib/auth";

function RailIcon({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={
        "flex h-11 w-11 items-center justify-center rounded-2xl transition-colors " +
        (active ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/10 hover:text-white/80")
      }
    >
      {children}
    </span>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed left-4 top-4 bottom-4 z-40 flex w-16 flex-col items-center rounded-[1.75rem] bg-navy py-5">
      <Link href="/dashboard" aria-label="GradeMate home">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-coral text-lg font-bold text-white">
          G
        </span>
      </Link>

      <nav className="mt-10 flex flex-col items-center gap-2">
        <Link href="/dashboard" aria-label="Your classes">
          <RailIcon active>
            <LayoutGrid size={20} strokeWidth={1.8} />
          </RailIcon>
        </Link>
        <RailIcon>
          <Calendar size={20} strokeWidth={1.8} />
        </RailIcon>
        <RailIcon>
          <MessageCircle size={20} strokeWidth={1.8} />
        </RailIcon>
        <RailIcon>
          <Paperclip size={20} strokeWidth={1.8} />
        </RailIcon>
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2">
        <RailIcon>
          <Settings size={20} strokeWidth={1.8} />
        </RailIcon>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" aria-label="Sign out" className="cursor-pointer">
            <RailIcon>
              <LogOut size={20} strokeWidth={1.8} />
            </RailIcon>
          </button>
        </form>
      </div>
    </aside>
  );
}

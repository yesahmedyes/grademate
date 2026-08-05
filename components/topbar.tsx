import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { Avatar } from "@/components/avatar";

export function Topbar({ name, image }: { name: string; image?: string | null }) {
  return (
    <header className="flex items-center justify-between gap-6 border-b border-ink/5 px-8 py-4 lg:px-10">
      <label className="flex h-10 w-full max-w-xs items-center gap-2.5 rounded-full border border-ink/10 bg-white px-4 text-sm text-faint focus-within:border-ink/25">
        <Search size={16} />
        <input
          type="search"
          placeholder="Search"
          className="w-full bg-transparent outline-none placeholder:text-faint text-ink"
        />
      </label>

      <nav className="flex items-center gap-6 text-sm font-medium text-ink/80">
        <Link href="/dashboard" className="hover:text-ink whitespace-nowrap">
          My classes
        </Link>
        <span className="hidden items-center gap-1 text-faint sm:flex whitespace-nowrap">
          Help <ChevronDown size={14} />
        </span>
        <Avatar name={name} src={image} size={38} />
      </nav>
    </header>
  );
}

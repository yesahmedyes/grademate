import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen p-4">
      <Sidebar />
      <main className="ml-[5.5rem] flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[2rem] bg-white shadow-card">
        <Topbar name={session.user.name ?? "Teacher"} image={session.user.image} />
        <div className="flex-1 px-8 py-7 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

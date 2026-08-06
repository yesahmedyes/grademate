"use server";

import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { classroomTag } from "@/lib/classroom-cached";

/**
 * Drop every cached Classroom read for the signed-in teacher.
 * Classroom data is cached on a short TTL (see lib/classroom-cached.ts), so
 * this is the escape hatch for "I just changed something in Google Classroom
 * and want to see it now".
 */
export async function refreshClassroom() {
  const session = await auth();
  if (!session?.user) return;
  revalidateTag(classroomTag(session.user.id));
}

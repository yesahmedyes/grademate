import fs from "node:fs/promises";
import path from "node:path";
import { MOCK_MODE } from "@/lib/auth";
import { googleAuthFor, classroomClient, driveClient } from "@/lib/google";
import { MOCK_FILE_ID, mockCourses, mockCourseWork, mockStudents, mockSubmissions } from "@/lib/mock-data";

export type Course = { id: string; name: string; section?: string };
export type Material = { driveFileId?: string; title?: string; link?: string };
export type CourseWork = {
  id: string;
  title: string;
  description?: string;
  workType: string; // ASSIGNMENT | SHORT_ANSWER_QUESTION | MULTIPLE_CHOICE_QUESTION | COURSEWORK_MATERIAL
  maxPoints?: number;
  dueDate?: string; // yyyy-mm-dd
  materials: Material[];
};
export type Student = { userId: string; name: string; email?: string; photoUrl?: string };
export type Attachment = { driveFileId?: string; title?: string; link?: string };
export type Submission = {
  id: string;
  userId: string;
  state: string; // NEW | CREATED | TURNED_IN | RETURNED | RECLAIMED_BY_STUDENT
  late: boolean;
  updateTime?: string;
  attachments: Attachment[];
};
export type DownloadedFile = { buf: Buffer; mime: string; name: string };

export interface ClassroomAPI {
  listCourses(): Promise<Course[]>;
  /** Single course by id; null when it doesn't exist or isn't visible to this teacher. */
  getCourse(courseId: string): Promise<Course | null>;
  listCourseWork(courseId: string): Promise<CourseWork[]>;
  /** Single coursework item by id; null when it doesn't exist. */
  getCourseWork(courseId: string, workId: string): Promise<CourseWork | null>;
  listStudents(courseId: string): Promise<Student[]>;
  listSubmissions(courseId: string, workId: string): Promise<Submission[]>;
  downloadFile(fileId: string): Promise<DownloadedFile>;
}

/** Google returns 404 for both "gone" and "not visible to you" — treat each as null. */
function isNotFound(e: unknown): boolean {
  return (e as { code?: number; status?: number })?.code === 404 ||
    (e as { code?: number; status?: number })?.status === 404;
}

export function classroomFor(userId: string): ClassroomAPI {
  return MOCK_MODE ? new MockClassroom() : new RealClassroom(userId);
}

// ---------------- real ----------------

/** Shape of a classroom_v1.Schema$CourseWork, narrowed to the fields we read. */
type RawCourseWork = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  workType?: string | null;
  maxPoints?: number | null;
  dueDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  materials?:
    | {
        driveFile?: { driveFile?: { id?: string | null; title?: string | null } | null } | null;
        link?: { url?: string | null; title?: string | null } | null;
      }[]
    | null;
};

/** Shared by listCourseWork and getCourseWork so both produce identical shapes. */
function toCourseWork(w: RawCourseWork): CourseWork | null {
  if (!w.id || !w.title) return null;
  const d = w.dueDate;
  return {
    id: w.id,
    title: w.title,
    description: w.description ?? undefined,
    workType: w.workType ?? "ASSIGNMENT",
    maxPoints: w.maxPoints ?? undefined,
    dueDate: d
      ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
      : undefined,
    materials: (w.materials ?? []).map((m) => ({
      driveFileId: m.driveFile?.driveFile?.id ?? undefined,
      title: m.driveFile?.driveFile?.title ?? m.link?.title ?? undefined,
      link: m.link?.url ?? undefined,
    })),
  };
}

class RealClassroom implements ClassroomAPI {
  constructor(private userId: string) {}

  private async auth() {
    return googleAuthFor(this.userId);
  }

  async listCourses(): Promise<Course[]> {
    const classroom = classroomClient(await this.auth());
    const out: Course[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await classroom.courses.list({
        teacherId: "me",
        courseStates: ["ACTIVE"],
        pageSize: 50,
        pageToken,
      });
      for (const c of data.courses ?? []) {
        if (c.id && c.name) out.push({ id: c.id, name: c.name, section: c.section ?? undefined });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  /** Fetch one course instead of paging the whole list to find it. */
  async getCourse(courseId: string): Promise<Course | null> {
    const classroom = classroomClient(await this.auth());
    try {
      const { data: c } = await classroom.courses.get({ id: courseId });
      if (!c.id || !c.name) return null;
      return { id: c.id, name: c.name, section: c.section ?? undefined };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async listCourseWork(courseId: string): Promise<CourseWork[]> {
    const classroom = classroomClient(await this.auth());
    const out: CourseWork[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await classroom.courses.courseWork.list({
        courseId,
        pageSize: 50,
        pageToken,
        orderBy: "dueDate desc",
      });
      for (const w of data.courseWork ?? []) {
        const mapped = toCourseWork(w);
        if (mapped) out.push(mapped);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  /** Fetch one coursework item instead of paging the whole list to find it. */
  async getCourseWork(courseId: string, workId: string): Promise<CourseWork | null> {
    const classroom = classroomClient(await this.auth());
    try {
      const { data } = await classroom.courses.courseWork.get({ courseId, id: workId });
      return toCourseWork(data);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /**
   * Paginated (API pages at 30) and deduped by userId — real rosters repeat entries.
   * Students without both a name and an email are filtered out (unidentifiable entries).
   */
  async listStudents(courseId: string): Promise<Student[]> {
    const classroom = classroomClient(await this.auth());
    const byId = new Map<string, Student>();
    let pageToken: string | undefined;
    do {
      const { data } = await classroom.courses.students.list({ courseId, pageSize: 100, pageToken });
      for (const s of data.students ?? []) {
        const id = s.userId;
        if (!id || byId.has(id)) continue;
        const name = s.profile?.name?.fullName?.trim();
        const email = s.profile?.emailAddress?.trim();
        if (!name || !email) continue;
        let photo = s.profile?.photoUrl ?? undefined;
        if (photo?.startsWith("//")) photo = "https:" + photo;
        byId.set(id, { userId: id, name, email, photoUrl: photo });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return [...byId.values()];
  }

  async listSubmissions(courseId: string, workId: string): Promise<Submission[]> {
    const classroom = classroomClient(await this.auth());
    const out: Submission[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await classroom.courses.courseWork.studentSubmissions.list({
        courseId,
        courseWorkId: workId,
        pageSize: 100,
        pageToken,
      });
      for (const s of data.studentSubmissions ?? []) {
        if (!s.id || !s.userId) continue;
        out.push({
          id: s.id,
          userId: s.userId,
          state: s.state ?? "NEW",
          late: Boolean(s.late),
          updateTime: s.updateTime ?? undefined,
          attachments: (s.assignmentSubmission?.attachments ?? []).map((a) => ({
            driveFileId: a.driveFile?.id ?? undefined,
            title: a.driveFile?.title ?? a.link?.title ?? undefined,
            link: a.link?.url ?? undefined,
          })),
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  /** Download a Drive file; Google-native docs are exported to PDF. */
  async downloadFile(fileId: string): Promise<DownloadedFile> {
    const drive = driveClient(await this.auth());
    const { data: meta } = await drive.files.get({ fileId, fields: "name,mimeType" });
    const name = meta.name ?? fileId;
    if ((meta.mimeType ?? "").startsWith("application/vnd.google-apps")) {
      const r = await drive.files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" }
      );
      return { buf: Buffer.from(r.data as ArrayBuffer), mime: "application/pdf", name: `${name}.pdf` };
    }
    const r = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return {
      buf: Buffer.from(r.data as ArrayBuffer),
      mime: meta.mimeType ?? "application/octet-stream",
      name,
    };
  }
}

// ---------------- mock ----------------

class MockClassroom implements ClassroomAPI {
  async listCourses() {
    return mockCourses;
  }
  async getCourse(courseId: string) {
    return mockCourses.find((c) => c.id === courseId) ?? null;
  }
  async listCourseWork(courseId: string) {
    return mockCourseWork[courseId] ?? [];
  }
  async getCourseWork(courseId: string, workId: string) {
    return (mockCourseWork[courseId] ?? []).find((w) => w.id === workId) ?? null;
  }
  async listStudents() {
    return mockStudents.filter((s) => s.name?.trim() && s.email?.trim());
  }
  async listSubmissions(courseId: string, workId: string) {
    return mockSubmissions(courseId, workId);
  }
  async downloadFile(fileId: string): Promise<DownloadedFile> {
    if (fileId !== MOCK_FILE_ID) throw new Error(`Unknown mock file ${fileId}`);
    const buf = await fs.readFile(path.join(process.cwd(), "mock", "sample.pdf"));
    return { buf, mime: "application/pdf", name: "sample-submission.pdf" };
  }
}

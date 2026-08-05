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
  listCourseWork(courseId: string): Promise<CourseWork[]>;
  listStudents(courseId: string): Promise<Student[]>;
  listSubmissions(courseId: string, workId: string): Promise<Submission[]>;
  downloadFile(fileId: string): Promise<DownloadedFile>;
}

export function classroomFor(userId: string): ClassroomAPI {
  return MOCK_MODE ? new MockClassroom() : new RealClassroom(userId);
}

// ---------------- real ----------------

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
        if (!w.id || !w.title) continue;
        const due = w.dueDate
          ? `${w.dueDate.year}-${String(w.dueDate.month).padStart(2, "0")}-${String(w.dueDate.day).padStart(2, "0")}`
          : undefined;
        out.push({
          id: w.id,
          title: w.title,
          description: w.description ?? undefined,
          workType: w.workType ?? "ASSIGNMENT",
          maxPoints: w.maxPoints ?? undefined,
          dueDate: due,
          materials: (w.materials ?? []).map((m) => ({
            driveFileId: m.driveFile?.driveFile?.id ?? undefined,
            title: m.driveFile?.driveFile?.title ?? m.link?.title ?? undefined,
            link: m.link?.url ?? undefined,
          })),
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
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
  async listCourseWork(courseId: string) {
    return mockCourseWork[courseId] ?? [];
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

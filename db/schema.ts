import { relations } from "drizzle-orm";
import { integer, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Timestamps are `timestamptz`; Drizzle maps them to/from JS `Date` in both directions.
const ts = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

const uuid = () => crypto.randomUUID();

// ---------------- Auth.js ----------------

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: ts("emailVerified"),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires").notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

// ---------------- GradeMate ----------------

export const gradingSessions = pgTable(
  "grading_session",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    teacherId: text("teacherId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: text("courseId").notNull(),
    courseName: text("courseName").notNull(),
    courseWorkId: text("courseWorkId").notNull(),
    courseWorkTitle: text("courseWorkTitle").notNull(),
    maxPoints: real("maxPoints"),
    status: text("status").notNull().default("draft"), // draft | grading | done
    markingScheme: text("markingScheme").notNull().default(""),
    assignmentSource: text("assignmentSource").notNull().default("classroom"), // classroom | upload
    assignmentDriveId: text("assignmentDriveId"),
    createdAt: ts("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex("gs_teacher_course_work_key").on(t.teacherId, t.courseId, t.courseWorkId)]
);

export const uploadedFiles = pgTable("uploaded_file", {
  id: text("id").primaryKey().$defaultFn(uuid),
  // The owner is the access-control root: OCR figures from a marking-scheme
  // transcribe have no parent session, so `sessionId` cannot carry that job.
  ownerId: text("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("sessionId").references(() => gradingSessions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // assignment | markingScheme | ocrImage
  path: text("path").notNull(),
  originalName: text("originalName").notNull(),
  mime: text("mime").notNull(),
  // Mistral OCR transcript. Written in the background after upload, so the row
  // exists (and is previewable) well before the Markdown lands.
  markdown: text("markdown"),
  ocrStatus: text("ocrStatus").notNull().default("pending"), // pending | running | done | error | skipped
  ocrError: text("ocrError"),
  ocrPages: integer("ocrPages"),
  createdAt: ts("createdAt").notNull().$defaultFn(() => new Date()),
});

export const studentResults = pgTable(
  "student_result",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    sessionId: text("sessionId")
      .notNull()
      .references(() => gradingSessions.id, { onDelete: "cascade" }),
    googleUserId: text("googleUserId").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    photoUrl: text("photoUrl"),
    driveFileId: text("driveFileId"),
    mime: text("mime"),
    state: text("state").notNull().default("pending"), // pending | grading | done | error
    // Mistral OCR transcript of the submission, persisted before grading starts and
    // reused on re-grades so a retry never pays for OCR twice.
    markdown: text("markdown"),
    ocrStatus: text("ocrStatus").notNull().default("pending"), // pending | running | done | error | skipped
    ocrPages: integer("ocrPages"),
    score: real("score"),
    maxPoints: real("maxPoints"),
    perCriterion: text("perCriterion").notNull().default("[]"), // JSON string
    feedback: text("feedback").notNull().default(""),
    error: text("error"),
    gradedAt: ts("gradedAt"),
  },
  (t) => [uniqueIndex("sr_session_user_key").on(t.sessionId, t.googleUserId)]
);

// ---------------- relations (for the `with` query API) ----------------

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  gradingSessions: many(gradingSessions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const gradingSessionsRelations = relations(gradingSessions, ({ one, many }) => ({
  teacher: one(users, { fields: [gradingSessions.teacherId], references: [users.id] }),
  files: many(uploadedFiles),
  results: many(studentResults),
}));

export const uploadedFilesRelations = relations(uploadedFiles, ({ one }) => ({
  session: one(gradingSessions, {
    fields: [uploadedFiles.sessionId],
    references: [gradingSessions.id],
  }),
  owner: one(users, {
    fields: [uploadedFiles.ownerId],
    references: [users.id],
  }),
}));

export const studentResultsRelations = relations(studentResults, ({ one }) => ({
  session: one(gradingSessions, {
    fields: [studentResults.sessionId],
    references: [gradingSessions.id],
  }),
}));

// ---------------- inferred types ----------------

export type GradingSession = typeof gradingSessions.$inferSelect;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type StudentResult = typeof studentResults.$inferSelect;

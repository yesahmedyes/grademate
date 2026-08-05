CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "grading_session" (
	"id" text PRIMARY KEY NOT NULL,
	"teacherId" text NOT NULL,
	"courseId" text NOT NULL,
	"courseName" text NOT NULL,
	"courseWorkId" text NOT NULL,
	"courseWorkTitle" text NOT NULL,
	"maxPoints" real,
	"status" text DEFAULT 'draft' NOT NULL,
	"markingScheme" text DEFAULT '' NOT NULL,
	"assignmentSource" text DEFAULT 'classroom' NOT NULL,
	"assignmentDriveId" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_result" (
	"id" text PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"googleUserId" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"photoUrl" text,
	"driveFileId" text,
	"mime" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"markdown" text,
	"ocrStatus" text DEFAULT 'pending' NOT NULL,
	"ocrPages" integer,
	"score" real,
	"maxPoints" real,
	"perCriterion" text DEFAULT '[]' NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"error" text,
	"gradedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "uploaded_file" (
	"id" text PRIMARY KEY NOT NULL,
	"sessionId" text,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"originalName" text NOT NULL,
	"mime" text NOT NULL,
	"markdown" text,
	"ocrStatus" text DEFAULT 'pending' NOT NULL,
	"ocrError" text,
	"ocrPages" integer,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp with time zone,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_session" ADD CONSTRAINT "grading_session_teacherId_user_id_fk" FOREIGN KEY ("teacherId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_result" ADD CONSTRAINT "student_result_sessionId_grading_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."grading_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_sessionId_grading_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."grading_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gs_teacher_course_work_key" ON "grading_session" USING btree ("teacherId","courseId","courseWorkId");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_session_user_key" ON "student_result" USING btree ("sessionId","googleUserId");
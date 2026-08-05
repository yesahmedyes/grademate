// Test 4: Google OAuth -> Classroom -> Drive.
// Proves your OAuth client + enabled APIs let a teacher list their classes,
// assignments, submissions, and download a student's submitted file.
//
// Reuses your app's already-registered redirect URI so no console change is
// needed: http://localhost:3000/api/auth/callback/google
// (Make sure nothing else is running on port 3000 while you run this.)
import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { here } from "./lib.mjs";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in ../.env");
}

const PORT = 3000;
const CALLBACK_PATH = "/api/auth/callback/google";
const REDIRECT = `http://localhost:${PORT}${CALLBACK_PATH}`;

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.profile.photos",
  "https://www.googleapis.com/auth/drive.readonly",
];

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

// 1) Run the browser consent flow, capturing the ?code on the redirect.
const code = await new Promise((resolve, reject) => {
  let settled = false;
  let bound = 0;
  let pending = 2;
  const servers = [];
  const closeAll = () => servers.forEach((s) => { try { s.close(); } catch {} });

  const handler = (req, res) => {
    if (!req.url.startsWith(CALLBACK_PATH)) {
      res.statusCode = 404;
      res.end("waiting for Google redirect...");
      return;
    }
    const u = new URL(req.url, REDIRECT);
    const c = u.searchParams.get("code");
    const err = u.searchParams.get("error");
    res.setHeader("content-type", "text/html");
    res.end(`<h2>${c ? "GradeMate: authorized ✓ — you can close this tab." : "Auth error: " + err}</h2>`);
    if (settled) return;
    settled = true;
    closeAll();
    if (c) resolve(c);
    else reject(new Error(err || "no authorization code returned"));
  };

  // Bind BOTH IPv4 and IPv6 loopback so the browser reaches us no matter how it
  // resolves "localhost" — this is the fix for the "can't find the server" error.
  for (const host of ["127.0.0.1", "::1"]) {
    const s = http.createServer(handler);
    s.on("error", (e) => {
      pending--;
      console.warn(`! listen on ${host}:${PORT} failed (${e.code})${e.code === "EADDRINUSE" ? " — a previous run may still be open" : ""}`);
      if (bound === 0 && pending === 0 && !settled) {
        settled = true;
        reject(new Error(`Could not bind port ${PORT} on any address. Free it with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN   then   kill <PID>`));
      }
    });
    s.listen(PORT, host, () => {
      bound++;
      pending--;
      if (bound === 1) {
        console.log("\nOpen this URL in your browser to authorize (opening it for you):\n");
        console.log(authUrl + "\n");
        exec(`open "${authUrl}"`); // macOS; if it doesn't open, copy the URL above
      }
    });
    servers.push(s);
  }
});

// 2) Exchange code -> tokens.
const { tokens } = await oauth2.getToken(code);
oauth2.setCredentials(tokens);
console.log("✓ Tokens received. refresh_token present:", Boolean(tokens.refresh_token));
if (!tokens.refresh_token) {
  console.log("  (No refresh token — Google only returns it on first consent. " +
    "Revoke the app at myaccount.google.com/permissions and re-run to get one.)");
}

const classroom = google.classroom({ version: "v1", auth: oauth2 });
const drive = google.drive({ version: "v3", auth: oauth2 });

// 3) List classes where the signed-in user is a teacher.
const { data: cs } = await classroom.courses.list({
  teacherId: "me",
  courseStates: ["ACTIVE"],
});
const courses = cs.courses || [];
console.log(`\n✓ ${courses.length} active course(s) you teach:`);
courses.forEach((c) => console.log(`   - ${c.name}  (id ${c.id})`));
if (!courses.length) {
  console.log("\nNo courses found. Create a Classroom class as this teacher (and add an assignment with a submission) to test the full flow.");
  process.exit(0);
}

// 4) Find a course that has coursework, then inspect its first assignment.
for (const course of courses) {
  const { data: cw } = await classroom.courses.courseWork.list({ courseId: course.id });
  const works = cw.courseWork || [];
  if (!works.length) continue;

  const work = works[0];
  console.log(`\n✓ Course "${course.name}" -> assignment "${work.title}" (${work.maxPoints ?? "?"} pts)`);

  // roster: map userId -> name
  const { data: roster } = await classroom.courses.students.list({ courseId: course.id });
  const nameById = Object.fromEntries(
    (roster.students || []).map((s) => [s.userId, s.profile?.name?.fullName])
  );

  const { data: subs } = await classroom.courses.courseWork.studentSubmissions.list({
    courseId: course.id,
    courseWorkId: work.id,
  });
  const submissions = subs.studentSubmissions || [];
  console.log(`   ${submissions.length} submission(s):`);
  for (const s of submissions) {
    const att = (s.assignmentSubmission?.attachments || [])[0];
    const file = att?.driveFile ? ` [file: ${att.driveFile.title}]` : "";
    console.log(`     - ${nameById[s.userId] || s.userId}: ${s.state}${file}`);
  }

  // 5) Try downloading the first Drive-file attachment (PDF or exported Google Doc).
  const withFile = submissions.find((s) =>
    (s.assignmentSubmission?.attachments || []).some((a) => a.driveFile)
  );
  if (withFile) {
    const df = withFile.assignmentSubmission.attachments.find((a) => a.driveFile).driveFile;
    try {
      const { data: meta } = await drive.files.get({ fileId: df.id, fields: "name,mimeType" });
      const outDir = path.join(here, "out");
      await fs.mkdir(outDir, { recursive: true });
      let outPath, buf;
      if ((meta.mimeType || "").startsWith("application/vnd.google-apps")) {
        const r = await drive.files.export(
          { fileId: df.id, mimeType: "application/pdf" },
          { responseType: "arraybuffer" }
        );
        outPath = path.join(outDir, `submission-${df.id}.pdf`);
        buf = Buffer.from(r.data);
      } else {
        const r = await drive.files.get(
          { fileId: df.id, alt: "media" },
          { responseType: "arraybuffer" }
        );
        const ext = (meta.mimeType || "").includes("pdf") ? "pdf" : "bin";
        outPath = path.join(outDir, `submission-${df.id}.${ext}`);
        buf = Buffer.from(r.data);
      }
      await fs.writeFile(outPath, buf);
      console.log(`\n✓ Downloaded "${meta.name}" (${meta.mimeType}) -> ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.log(`\n! Drive download failed: ${e.message}`);
    }
  } else {
    console.log("\n(No Drive-file submissions to download on this assignment.)");
  }
  break;
}

console.log("\nDone.");
process.exit(0);

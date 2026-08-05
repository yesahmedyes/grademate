import type { Course, CourseWork, Student, Submission } from "@/lib/classroom";

export const MOCK_FILE_ID = "mock-sample";

export const mockCourses: Course[] = [
  { id: "c1", name: "Calculus & Analytical Geometry", section: "BSAI — Fall 2026" },
  { id: "c2", name: "Physics I: Mechanics", section: "Section B" },
  { id: "c3", name: "Intro to Computer Science", section: "CS-101" },
  { id: "c4", name: "Linear Algebra", section: "Section A" },
];

export const mockStudents: Student[] = [
  { userId: "s1", name: "Ayesha Khan", email: "ayesha@school.edu" },
  { userId: "s2", name: "Bilal Ahmed", email: "bilal@school.edu" },
  { userId: "s3", name: "Chen Wei", email: "chen@school.edu" },
  { userId: "s4", name: "Daniyal Raza", email: "daniyal@school.edu" },
  { userId: "s5", name: "Emaan Fatima", email: "emaan@school.edu" },
  { userId: "s6", name: "Fahad Malik", email: "fahad@school.edu" },
  { userId: "s7", name: "Hira Shah", email: "hira@school.edu" },
  { userId: "s8", name: "Ibrahim Ali", email: "ibrahim@school.edu" },
  { userId: "s9", name: "Javeria Iqbal", email: "javeria@school.edu" },
  { userId: "s10", name: "Kamran Yousaf", email: "kamran@school.edu" },
];

export const mockCourseWork: Record<string, CourseWork[]> = {
  c1: [
    {
      id: "w1",
      title: "Assignment 4 — Integration",
      description: "Definite integrals and areas under curves. Show all working.",
      workType: "ASSIGNMENT",
      maxPoints: 10,
      dueDate: "2026-07-24",
      materials: [{ driveFileId: MOCK_FILE_ID, title: "assignment-4.pdf" }],
    },
    {
      id: "w2",
      title: "Quiz 3 — Limits & Continuity",
      workType: "ASSIGNMENT",
      maxPoints: 15,
      dueDate: "2026-07-15",
      materials: [],
    },
    {
      id: "w3",
      title: "Practice Set (ungraded)",
      workType: "COURSEWORK_MATERIAL",
      materials: [],
    },
  ],
  c2: [
    {
      id: "w4",
      title: "Lab Report — Projectile Motion",
      workType: "ASSIGNMENT",
      maxPoints: 20,
      dueDate: "2026-07-21",
      materials: [],
    },
  ],
  c3: [
    {
      id: "w5",
      title: "PS2 — Recursion",
      description: "Implement and analyze recursive algorithms.",
      workType: "ASSIGNMENT",
      maxPoints: 100,
      dueDate: "2026-07-30",
      materials: [{ driveFileId: MOCK_FILE_ID, title: "ps2.pdf" }],
    },
  ],
  c4: [],
};

const states = [
  "TURNED_IN",
  "TURNED_IN",
  "TURNED_IN",
  "TURNED_IN",
  "CREATED",
  "TURNED_IN",
  "RETURNED",
  "CREATED",
  "TURNED_IN",
  "NEW",
] as const;

export function mockSubmissions(courseId: string, workId: string): Submission[] {
  const work = (mockCourseWork[courseId] ?? []).find((w) => w.id === workId);
  if (!work || work.workType !== "ASSIGNMENT") return [];
  return mockStudents.map((s, i) => {
    const state = states[i % states.length];
    const hasFile = state === "TURNED_IN" || state === "RETURNED";
    return {
      id: `sub-${workId}-${s.userId}`,
      userId: s.userId,
      state,
      late: i === 5,
      updateTime: `2026-07-1${(i % 9) + 1}T10:0${i % 10}:00Z`,
      attachments: hasFile
        ? [{ driveFileId: MOCK_FILE_ID, title: `${s.name.split(" ")[0].toLowerCase()}-${workId}.pdf` }]
        : [],
    };
  });
}

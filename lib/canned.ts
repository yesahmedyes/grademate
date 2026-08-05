// Fallback content used when BEDROCK_* env vars are absent (offline/demo dev).

export const CANNED_SCHEME = `# Marking Scheme — Assignment

**Total: 10 points**

## Q1 — Solve the equation (5 pts)

Solve $2x + 3 = 11$.

- Correct rearrangement $2x = 8$ — **2 pts**
- Final answer $x = 4$ — **3 pts**

## Q2 — Definite integral (5 pts)

Evaluate $\\int_0^3 x\\,dx$.

- Correct antiderivative $\\frac{x^2}{2}$ — **2 pts**
- Correct evaluation $\\frac{9}{2} = 4.5$ — **3 pts**

\`\`\`python
# reference check
from sympy import integrate, symbols
x = symbols("x")
assert integrate(x, (x, 0, 3)) == 4.5
\`\`\`
`;

export function cannedGradeFor(name: string, maxPoints: number) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const frac = 0.55 + (h % 40) / 100; // 0.55 – 0.94
  const score = Math.round(maxPoints * frac * 2) / 2;
  return {
    score,
    perCriterion: [
      { criterion: "Correctness", points: Math.round(score * 0.5 * 2) / 2, maxPoints: maxPoints * 0.5, comment: "Mostly correct answers." },
      { criterion: "Working shown", points: Math.round(score * 0.3 * 2) / 2, maxPoints: maxPoints * 0.3, comment: "Steps are shown for most questions." },
      { criterion: "Notation & clarity", points: Math.round(score * 0.2 * 2) / 2, maxPoints: maxPoints * 0.2, comment: "Legible and organized." },
    ],
    feedback: `**Nice effort, ${name.split(" ")[0]}!** Q1 is solved correctly ($x=4$). For Q2, re-check the evaluation of $\\int_0^3 x\\,dx$ — remember it equals $\\frac{9}{2}$, not $3$.`,
    flags: ["demo-mode: canned grade (no AI credentials configured)"],
  };
}

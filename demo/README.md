# GradeMate — integration smoke tests

Throwaway scripts to confirm the risky external pieces work **before** we build the app.
They read secrets from the project-root `../.env`. Run everything from inside this `demo/` folder.

```bash
cd demo
pnpm install
```

| Command | What it proves | Needs |
|---|---|---|
| `pnpm bedrock` | Mantle endpoint + API key + model + dialect reachable | Bedrock keys |
| `pnpm sample`  | (re)generate `sample.pdf` mock submission | — |
| `pnpm pdf`     | PDF → per-page PNG conversion works on this machine | — |
| `pnpm grade`   | **The real loop:** PDF → images → model → JSON grade | Bedrock keys |
| `pnpm google`  | Google OAuth → list classes/assignments/submissions → download a file | Google OAuth + a real class |

## Notes / gotchas

- **Path matters (verified):** Gemma is an OpenAI-dialect model and must use `.../openai/v1` (now set in `../.env`). The plain `.../v1` path returns a *misleading* `Berm is not enabled for this account` 401, and `.../anthropic` (Claude-only) returns `model does not support this API`. The scripts auto-select OpenAI vs Anthropic request format from the URL, and auth is a Bearer token either way.
- **`pnpm bedrock` on failure** runs a raw HTTP probe and prints the endpoint's actual status/body — that tells us if it's an auth (401), model-id (404/400), or dialect problem.
- **`pnpm google`** reuses your app's registered redirect URI `http://localhost:3000/api/auth/callback/google`, so no Google Console change is needed — but **stop any dev server on port 3000** first. Make sure your teacher email is a **Test user** on the OAuth consent screen, and that you have at least one Classroom class with an assignment + submission to see the full output.
- Google refresh tokens only come back on **first** consent; the script tells you if one was returned.
- Outputs (page images, downloaded submissions) are written to `demo/out/`.

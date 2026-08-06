"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { FileDown, Loader2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/markdown-view";
import { printHtmlToPdf } from "@/lib/print-doc";

type Props = {
  sessionId: string;
  kind: "markingScheme";
  title: string;
  hint: string;
  value: string;
  /** Called on the autosave debounce, not per keystroke — see the note on `text`. */
  onCommit: (v: string) => void;
};

export function SourceEditor({ sessionId, kind, title, hint, value, onCommit }: Props) {
  // The draft lives here, not in GradeWizard. Lifting it made every keystroke —
  // and every streamed token — re-render the whole wizard including the KaTeX
  // preview. The parent only hears about it on the 900ms autosave tick.
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState<null | "generate" | "upload">(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Compare against what's actually persisted rather than skipping "the first"
  // save — under StrictMode's double-invoked effects a boolean flag gets burned
  // on the throwaway pass and the untouched initial value is PATCHed anyway.
  const lastSaved = useRef(value);

  // Markdown+KaTeX parsing is the expensive part; deferring it keeps typing and
  // token streaming responsive while the preview catches up at low priority.
  const preview = useDeferredValue(text);

  function downloadPdf() {
    // Print exactly what's in the live preview (KaTeX/code already rendered).
    const html = previewRef.current?.querySelector(".md-body")?.innerHTML;
    if (!html) return;
    printHtmlToPdf(`<div class="md-body">${html}</div>`, title, "GradeMate");
  }

  // debounced autosave + commit upward
  useEffect(() => {
    if (text === lastSaved.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      lastSaved.current = text;
      onCommit(text);
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [kind]: text }),
        });
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [text, kind, sessionId, onCommit]);

  async function streamInto(res: Response, replace: boolean) {
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => res.statusText);
      setText((cur) => (replace ? "" : cur + "\n\n") + `> ⚠️ ${msg}`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = replace ? "" : text ? text + "\n\n" : "";

    // Coalesce chunks onto animation frames — the model emits tokens far faster
    // than the screen refreshes, and one setState per token is wasted work.
    let frame = 0;
    const flush = () => {
      frame = 0;
      setText(acc);
    };
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        acc += dec.decode(chunk, { stream: true });
        if (!frame) frame = requestAnimationFrame(flush);
      }
    } finally {
      if (frame) cancelAnimationFrame(frame);
      setText(acc);
    }
  }

  async function generate() {
    setBusy("generate");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, kind }),
      });
      await streamInto(res, true);
    } finally {
      setBusy(null);
    }
  }

  async function uploadDoc(file: File) {
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
      await streamInto(res, true);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-faint">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-xs text-faint">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !text.trim()}
            onClick={downloadPdf}
            title="Download as PDF"
          >
            <FileDown size={14} />
            Download PDF
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.md,.txt,.markdown,image/*,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "upload" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            Upload doc
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={generate}>
            {busy === "generate" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generate with AI
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={`Paste or write the ${title.toLowerCase()} here…\n\nMath: $x^2$ or $$\\int_0^3 x\\,dx$$ · Code: \`\`\`python`}
          className="h-[26rem] w-full resize-none rounded-card border border-ink/10 bg-panel/50 p-4 font-mono text-[13px] leading-relaxed outline-none transition-colors focus:border-coral/60 focus:bg-white thin-scroll"
        />
        <div
          ref={previewRef}
          className="h-[26rem] overflow-auto rounded-card border border-ink/8 bg-white p-5 thin-scroll"
        >
          {preview.trim() ? (
            <MarkdownView>{preview}</MarkdownView>
          ) : (
            <p className="text-sm text-faint">Live preview — KaTeX math and code render here.</p>
          )}
        </div>
      </div>
    </div>
  );
}

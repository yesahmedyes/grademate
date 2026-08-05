"use client";

import { useEffect, useRef, useState } from "react";
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
  onChange: (v: string) => void;
};

export function SourceEditor({ sessionId, kind, title, hint, value, onChange }: Props) {
  const [busy, setBusy] = useState<null | "generate" | "upload">(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const skipNextSave = useRef(true); // don't PATCH the initial value

  function downloadPdf() {
    // Print exactly what's in the live preview (KaTeX/code already rendered).
    const html = previewRef.current?.querySelector(".md-body")?.innerHTML;
    if (!html) return;
    printHtmlToPdf(`<div class="md-body">${html}</div>`, title, "GradeMate");
  }

  // debounced autosave
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [kind]: value }),
        });
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [value, kind, sessionId]);

  async function streamInto(res: Response, replace: boolean) {
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => res.statusText);
      onChange((replace ? "" : value + "\n\n") + `> ⚠️ ${msg}`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = replace ? "" : value ? value + "\n\n" : "";
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      acc += dec.decode(chunk, { stream: true });
      onChange(acc);
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
            disabled={busy !== null || !value.trim()}
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={`Paste or write the ${title.toLowerCase()} here…\n\nMath: $x^2$ or $$\\int_0^3 x\\,dx$$ · Code: \`\`\`python`}
          className="h-[26rem] w-full resize-none rounded-card border border-ink/10 bg-panel/50 p-4 font-mono text-[13px] leading-relaxed outline-none transition-colors focus:border-coral/60 focus:bg-white thin-scroll"
        />
        <div
          ref={previewRef}
          className="h-[26rem] overflow-auto rounded-card border border-ink/8 bg-white p-5 thin-scroll"
        >
          {value.trim() ? (
            <MarkdownView>{value}</MarkdownView>
          ) : (
            <p className="text-sm text-faint">Live preview — KaTeX math and code render here.</p>
          )}
        </div>
      </div>
    </div>
  );
}

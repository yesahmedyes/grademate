"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { cn } from "@/lib/utils";

export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false }]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

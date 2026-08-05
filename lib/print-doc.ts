"use client";

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/**
 * Print an already-rendered HTML fragment (e.g. a MarkdownView's innerHTML) to
 * PDF via the browser's print dialog ("Save as PDF"). We clone the page's own
 * stylesheets into a hidden, same-origin iframe so KaTeX, highlight.js, the
 * theme and web fonts all render exactly as in the live preview — the font
 * URLs stay valid because they still point at the same /_next asset paths.
 */
export function printHtmlToPdf(innerHTML: string, title: string, subtitle = "") {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  // Resolve root-relative asset URLs (fonts, /_next/... CSS) against the app origin.
  const base = doc.createElement("base");
  base.href = `${location.origin}/`;
  doc.head.appendChild(base);

  // Reuse the parent document's stylesheets (KaTeX / highlight.js / theme + @font-face).
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    doc.head.appendChild(node.cloneNode(true));
  }

  const style = doc.createElement("style");
  style.textContent = `
    @page { margin: 18mm; }
    html, body { background: #fff; }
    body { margin: 0; padding: 0; color: #1b1f2b;
      font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif; }
    .print-head { margin: 0 0 20px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
    .print-title { font-size: 20px; font-weight: 600; margin: 0; }
    .print-sub { font-size: 12px; color: #6b7280; margin: 4px 0 0; }
    .md-body { font-size: 13px; line-height: 1.65; }
    .md-body h1, .md-body h2, .md-body h3 { break-after: avoid; }
    .md-body pre, .md-body table, .md-body .katex-display { break-inside: avoid; }
    .md-body img { max-width: 100%; }
  `;
  doc.head.appendChild(style);

  doc.title = title;
  doc.body.innerHTML =
    `<div class="print-head"><h1 class="print-title">${escapeHtml(title)}</h1>` +
    (subtitle ? `<p class="print-sub">${escapeHtml(subtitle)}</p>` : "") +
    `</div>${innerHTML}`;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };
  const trigger = () => {
    win.focus();
    win.print();
    // afterprint is unreliable across browsers; clean up shortly after too.
    setTimeout(cleanup, 1000);
  };
  win.addEventListener("afterprint", cleanup);

  // Wait for fonts (which also implies the font-bearing CSS has loaded) before printing.
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) {
    fonts.ready.then(() => setTimeout(trigger, 100)).catch(() => trigger());
  } else {
    setTimeout(trigger, 300);
  }
}

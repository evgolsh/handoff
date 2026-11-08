import type { Html } from "../console/html";

/**
 * Markdown from other people's assistants (briefs, .md files), rendered for the Assets pages. Everything is
 * escaped first; then only headings, lists, quotes, fenced code, paragraphs with their line breaks, inline code,
 * bold, and https links come back as tags. Links open in a new tab and send no referrer. No raw HTML, images,
 * or relative links.
 */

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const LINK = 'target="_blank" rel="noopener noreferrer nofollow"';

function inline(text: string): Html {
  // Code spans first, so nothing inside them becomes a link or bold.
  const parts = esc(text).split(/(`[^`]+`)/g);
  return parts
    .map((p) =>
      p.startsWith("`") && p.endsWith("`") && p.length > 1
        ? `<code>${p.slice(1, -1)}</code>`
        : p
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, `<a href="$2" ${LINK}>$1</a>`)
            .replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:!?])/g, `$1<a href="$2" ${LINK}>$2</a>`),
    )
    .join("");
}

export function renderBrief(md: string): Html {
  const out: string[] = [];
  let para: string[] = [];
  let list: "ul" | "ol" | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join("<br>")}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    closeList();
    flushQuote();
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      if (/^\s*```/.test(raw)) {
        out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (/^\s*```/.test(raw)) {
      flushAll();
      fence = [];
      continue;
    }
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (h) {
      flushAll();
      // A brief's own headings sit under the page's: h3 and below.
      const n = Math.min(6, h[1]!.length + 2);
      out.push(`<h${n}>${inline(h[2]!)}</h${n}>`);
    } else if (ul || ol) {
      flushPara();
      flushQuote();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else if (q) {
      flushPara();
      closeList();
      quote.push(q[1]!);
    } else if (line.trim() === "") {
      flushAll();
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
    } else {
      closeList();
      flushQuote();
      para.push(line.trim());
    }
  }
  if (fence) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flushAll();
  return out.join("\n");
}

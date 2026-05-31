/**
 * ingest -- markdown chunker + embedding client.
 * Uses embedding-client.ts (Ollama/OpenAI/vLLM/TEI) with graceful degradation.
 */

import type { SectionResult } from "./engine.js";

const CHARS_PER_TOKEN = 4;
const EMBED_BATCH_SIZE = 20;

/**
 * Section extracted from markdown heading hierarchy.
 * Used for PageIndex-style tree-structured retrieval.
 */
export interface Section {
  slug: string;
  level: number;
  heading: string;
  path: string;
  chunkStart: number;
  chunkEnd: number;
}

/**
 * Extract heading hierarchy from markdown content.
 * Returns sections with hierarchical path (parent headings prefixed).
 *
 * Example:
 *   # Title
 *   ## Section A
 *   ### Subsection
 *   ## Section B
 *
 * Yields:
 *   { level: 1, heading: "Title", path: "Title" }
 *   { level: 2, heading: "Section A", path: "Title/Section A" }
 *   { level: 3, heading: "Subsection", path: "Title/Section A/Subsection" }
 *   { level: 2, heading: "Section B", path: "Title/Section B" }
 */
export function extractSections(content: string, slug: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const headingStack: { level: number; heading: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;

    const level = match[1].length;
    const heading = match[2].trim();

    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, heading });

    const path = headingStack.map((h) => h.heading).join("/");
    sections.push({ slug, level, heading, path, chunkStart: -1, chunkEnd: -1 });
  }

  return sections;
}

/**
 * Assign chunk ranges to sections based on content position.
 */
export function assignChunkRanges(sections: Section[], chunks: string[], content: string): void {
  if (sections.length === 0 || chunks.length === 0) return;

  const lines = content.split("\n");
  const chunkSize = Math.ceil(lines.length / chunks.length);

  for (const section of sections) {
    let sectionLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (match && match[1].length === section.level && match[2].trim() === section.heading) {
        sectionLineIdx = i;
        break;
      }
    }

    if (sectionLineIdx >= 0) {
      section.chunkStart = Math.min(Math.floor(sectionLineIdx / chunkSize), chunks.length - 1);

      let nextSectionLineIdx = lines.length;
      for (let i = sectionLineIdx + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (match && match[1].length <= section.level) {
          nextSectionLineIdx = i;
          break;
        }
      }
      section.chunkEnd = Math.min(Math.ceil(nextSectionLineIdx / chunkSize), chunks.length - 1);
    } else {
      section.chunkStart = 0;
      section.chunkEnd = chunks.length - 1;
    }
  }
}

/** Convert Section to SectionResult for DB storage */
export function sectionToResult(s: Section): SectionResult {
  return {
    slug: s.slug,
    level: s.level,
    heading: s.heading,
    path: s.path,
    chunkStart: s.chunkStart,
    chunkEnd: s.chunkEnd,
  };
}

// Defer import so embedding-client can be absent without breaking other vaultbrain code
async function getEmbedFn() {
  try {
    const { embed } = await import("../../embedding-client.js");
    return embed;
  } catch {
    return null;
  }
}

/**
 * Chunk markdown content into approximately `maxTokens`-sized chunks.
 * Splits on \n\n first, merges small paragraphs, hard-splits oversized ones.
 * Overlap: prepend the last `overlap` tokens of previous chunk to next chunk.
 */
export function chunkMarkdown(content: string, maxTokens = 512, overlap = 64): string[] {
  if (!content.trim()) return [];

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;

  // Split into paragraphs
  const paragraphs = content.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  // First pass: break oversized paragraphs by sentence, then hard-split
  const normalized: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      normalized.push(para);
      continue;
    }
    const sentences = para.split(/(?<=\.\s)/);
    const pieces: string[] = [];
    let buf = "";
    for (const sent of sentences) {
      if ((buf + sent).length > maxChars && buf) {
        pieces.push(buf);
        buf = sent;
      } else {
        buf += sent;
      }
    }
    if (buf) pieces.push(buf);

    const finalPieces: string[] = [];
    for (const piece of pieces) {
      if (piece.length <= maxChars) {
        finalPieces.push(piece);
      } else {
        for (let i = 0; i < piece.length; i += maxChars) {
          finalPieces.push(piece.slice(i, i + maxChars));
        }
      }
    }
    normalized.push(...finalPieces);
  }

  // Second pass: merge small paragraphs up to maxChars
  const chunks: string[] = [];
  let current = "";
  for (const para of normalized) {
    if (!current) {
      current = para;
      continue;
    }
    const combined = current + "\n\n" + para;
    if (combined.length <= maxChars) {
      current = combined;
    } else {
      chunks.push(current);
      current = para;
    }
  }
  if (current) chunks.push(current);

  // Third pass: apply overlap -- prepend tail of previous chunk to next
  if (overlapChars > 0 && chunks.length > 1) {
    const withOverlap: string[] = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const tail = prev.slice(Math.max(0, prev.length - overlapChars));
      withOverlap.push(tail + "\n\n" + chunks[i]);
    }
    return withOverlap;
  }

  return chunks;
}

/**
 * Embed texts via embedding-client.ts (Ollama, OpenAI, vLLM, TEI).
 * Returns [] if no embedding provider available (non-fatal).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embed = await getEmbedFn();
  if (!embed) {
    console.warn("[vaultbrain] embedTexts: no embedding provider (VAULT_MIND_EMBED_URL not set, embedding-client unavailable)");
    return [];
  }

  const allEmbeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const results = await Promise.all(batch.map((t) => embed(t)));
      allEmbeddings.push(...results);
    } catch (err) {
      console.warn(`[vaultbrain] embedTexts batch error: ${(err as Error).message}`);
      return [];
    }
  }
  return allEmbeddings;
}

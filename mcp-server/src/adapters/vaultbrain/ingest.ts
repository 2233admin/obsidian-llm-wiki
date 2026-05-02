/**
 * ingest -- markdown chunker + OpenAI embedding client.
 * Graceful degradation: if OPENAI_API_KEY missing, embedTexts returns [].
 */

const CHARS_PER_TOKEN = 4;
// Jina v3: 1024-dim default (Matryoshka), 89 languages, paid endpoint.
// Curry has JINA_API_KEY setx-persisted (HKCU\Environment); .claude.json
// llm-wiki MCP env block must explicitly include JINA_API_KEY because
// child process env from cmd /c node spawn doesn't auto-load setx registry.
const JINA_EMBEDDING_MODEL = "jina-embeddings-v3";
const JINA_EMBEDDING_URL = "https://api.jina.ai/v1/embeddings";
const JINA_EMBEDDING_DIMS = 1024;
const JINA_EMBEDDING_TASK = "retrieval.passage";
const EMBED_BATCH_SIZE = 20;

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
 * Embed texts via Jina jina-embeddings-v3 (1024d, paid).
 * Returns [] if JINA_API_KEY missing or request fails (non-fatal -- chunks
 * still get inserted with embedding=null, keyword path remains usable).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return [];

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const response = await fetch(JINA_EMBEDDING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: JINA_EMBEDDING_MODEL,
          task: JINA_EMBEDDING_TASK,
          dimensions: JINA_EMBEDDING_DIMS,
          input: batch,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn(`[vaultbrain] Jina embedding request failed: ${response.status} ${body.slice(0, 200)}`);
        return [];
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      for (const item of data.data) {
        allEmbeddings.push(item.embedding);
      }
    } catch (err) {
      console.warn(`[vaultbrain] Jina embedding request error: ${(err as Error).message}`);
      return [];
    }
  }

  return allEmbeddings;
}

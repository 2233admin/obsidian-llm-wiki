#!/usr/bin/env node
/**
 * vaultbrain-ingest.mjs -- standalone vaultbrain ingest for E:/knowledge
 * Uses BGE-M3 via Ollama /v1/embeddings + PGLite with pgvector.
 *
 * Usage: node scripts/vaultbrain-ingest.mjs
 *
 * Env:
 *   OLLAMA_BASE_URL   default http://localhost:11434
 *   EMBED_MODEL       default bge-m3
 *   VAULT_PATH        default E:/knowledge
 *   DATA_DIR          default ~/.vault-mind/vaultbrain
 */
import { PGlite } from './mcp-server/node_modules/@electric-sql/pglite/dist/index.js';
import { vector } from './mcp-server/node_modules/@electric-sql/pglite/dist/vector/index.js';
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const SCRIPTS_DIR = resolve('./scripts');
const PGLITE_DIR = resolve('./mcp-server/node_modules/@electric-sql/pglite/dist');

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'bge-m3';
// Comma-separated list of paths, or single path
const VAULT_PATHS = (process.env.VAULT_PATHS || process.env.VAULT_PATH || 'E:/knowledge').split(',').map(p => p.trim());
const VAULT_PATH = VAULT_PATHS[0]; // for pathToSlug backward compat
const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.vault-mind', 'vaultbrain');

const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 512;

// --- Embedding ---
async function embedBatch(texts) {
    if (texts.length === 0) return [];
    const url = `${OLLAMA_BASE}/v1/embeddings`;
    const results = [];
    for (const text of texts) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 60000);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: EMBED_MODEL, input: text }),
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const vec = body.data && body.data[0] && body.data[0].embedding;
            if (!Array.isArray(vec)) throw new Error('missing embedding');
            results.push(vec);
        } catch (e) {
            console.error(`  [embed] FAILED: "${text.slice(0, 50)}...": ${e.message}`);
            results.push(null);
        }
    }
    return results;
}

// --- Markdown chunker ---
function chunkMarkdown(content) {
    if (!content.trim()) return [];
    const maxChars = MAX_TOKENS * CHARS_PER_TOKEN;
    const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const chunks = [];
    let buf = '';
    for (const para of paragraphs) {
        if (para.length <= maxChars) {
            if (buf.length + para.length > maxChars && buf) {
                chunks.push(buf); buf = para;
            } else {
                buf = buf ? buf + '\n\n' + para : para;
            }
        } else {
            if (buf) { chunks.push(buf); buf = ''; }
            for (let i = 0; i < para.length; i += maxChars) {
                chunks.push(para.slice(i, i + maxChars));
            }
        }
    }
    if (buf) chunks.push(buf);
    return chunks;
}

function simpleHash(content) {
    let h = 5381;
    for (let i = 0; i < content.length; i++) { h = ((h << 5) + h) + content.charCodeAt(i); h &= h; }
    return (h >>> 0).toString(16);
}

function pathToSlug(filePath) {
    // Strip any vault prefix to get relative path
    for (const vp of VAULT_PATHS) {
        const rel = filePath.replace(vp, '').replace(/\\/g, '/').replace(/\.md$/, '').replace(/^\//, '');
        if (rel !== filePath) return rel;
    }
    return filePath.replace(/\\/g, '/').replace(/\.md$/, '');
}

function extractTitle(content) {
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    const lines = content.split('\n').filter(l => l.trim());
    return (lines[0] || 'Untitled').slice(0, 80);
}

function extractTags(content) {
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return [];
    const src = fm[1].match(/^tags:\s*\[([^\]]+)\]/m)?.[1]
              || fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m)?.[1] || '';
    return src.split(/[\n,]/).map(t => t.replace(/^-\s*/, '').replace(/['"]/g, '').trim()).filter(Boolean);
}

function extractWikiLinks(content) {
    const matches = content.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g);
    return [...matches].map(m => m[1].trim().toLowerCase().replace(/\s+/g, '-'));
}

function walkVault(dir, files, skipDirs = new Set(['.git', '.obsidian', 'node_modules', '.trash', 'Excalidraw'])) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
        if (skipDirs.has(entry)) continue;
        if (entry.startsWith('ghidra')) continue; // machine-generated disassembly output
        const full = join(dir, entry);
        try {
            const stat = statSync(full);
            if (stat.isDirectory()) walkVault(full, files, skipDirs);
            else if (entry.endsWith('.md')) files.push(full);
        } catch {}
    }
}

// --- Main ---
async function main() {
    console.log('=== VaultBrain Ingest ===');
    console.log(`Vault:   ${VAULT_PATH}`);
    console.log(`Model:   ${EMBED_MODEL} @ ${OLLAMA_BASE}`);
    console.log(`Data:    ${DATA_DIR}\n`);

    // Test embedding
    console.log('[1/3] Testing BGE-M3 embedding...');
    const testVec = await embedBatch(['量化交易因子分析']);
    if (!testVec[0]) { console.error('Embedding FAILED — check Ollama'); process.exit(1); }
    console.log(`  OK — dim=${testVec[0].length}`);

    // Init PGLite with vector extension
    console.log('\n[2/3] Initializing PGLite + pgvector...');
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const db = new PGlite(DATA_DIR, {
        extensions: { vector }
    });
    await db.waitReady;
    await db.exec(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pages (
            slug TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
            hash TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS chunks (
            slug TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_text TEXT NOT NULL,
            embedding vector(1024), token_count INTEGER NOT NULL,
            PRIMARY KEY (slug, chunk_index)
        );
        CREATE TABLE IF NOT EXISTS page_tags (slug TEXT, tag TEXT, PRIMARY KEY (slug, tag));
        CREATE TABLE IF NOT EXISTS page_links (from_slug TEXT, to_slug TEXT, PRIMARY KEY (from_slug, to_slug));
    `);
    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);`);
    } catch (e) { /* HNSW may need pgvector 0.5+ */ }
    console.log('  PGLite + pgvector ready');

    // Scan vaults
    console.log('\n[3/3] Ingesting files...');
    const files = [];
    const vaultCounts = {};
    for (const vp of VAULT_PATHS) {
        const count = files.length;
        walkVault(vp, files);
        vaultCounts[vp] = files.length - count;
    }
    for (const [vp, c] of Object.entries(vaultCounts)) {
        const name = vp.split('/').pop();
        console.log(`  ${name}: ${c} files`);
    }
    console.log(`  Total: ${files.length} .md files\n`);

    let totalChunks = 0, skipped = 0, updated = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        } catch (e) {
            console.error(`\n  SKIP ${file}: ${e.message}`);
            continue;
        }
        const slug = pathToSlug(file);
        const title = extractTitle(content);
        const hash = simpleHash(content);

        let isNew = true;
        try {
            const existing = await db.query(`SELECT hash FROM pages WHERE slug = $1`, [slug]);
            if (existing.rows && existing.rows.length > 0 && existing.rows[0].hash === hash) {
                isNew = false;
            }
        } catch {}

        if (!isNew) { skipped++; process.stdout.write('.'); continue; }

        process.stdout.write(`\n[${i + 1}/${files.length}] ${slug}...`);
        const chunks = chunkMarkdown(content);
        const embeddings = await embedBatch(chunks);

        try {
            await db.query(`
                INSERT INTO pages (slug, title, content, hash, updated_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, hash=EXCLUDED.hash, updated_at=EXCLUDED.updated_at
            `, [slug, title, content, hash]);
            await db.query(`DELETE FROM chunks WHERE slug = $1`, [slug]);

            for (let ci = 0; ci < chunks.length; ci++) {
                const emb = embeddings[ci];
                if (emb) {
                    await db.query(`
                        INSERT INTO chunks (slug, chunk_index, chunk_text, embedding, token_count)
                        VALUES ($1, $2, $3, $4::vector, $5)
                    `, [slug, ci, chunks[ci], JSON.stringify(emb), Math.ceil(chunks[ci].length / CHARS_PER_TOKEN)]);
                }
            }

            for (const tag of extractTags(content)) {
                try { await db.query(`INSERT INTO page_tags (slug, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [slug, tag]); } catch {}
            }
            for (const toSlug of extractWikiLinks(content)) {
                try { await db.query(`INSERT INTO page_links (from_slug, to_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [slug, toSlug]); } catch {}
            }
        } catch (e) {
            console.error(`\n  DB ERROR: ${e.message.split('\n')[0]}`);
            continue;
        }

        totalChunks += chunks.length;
        updated++;
        process.stdout.write(`${chunks.length}ch `);
    }

    console.log(`\n\n=== Done ===`);
    console.log(`Files:   ${files.length} total | ${updated} updated | ${skipped} unchanged`);
    console.log(`Chunks:  ${totalChunks} total`);
    console.log(`DB:      ${DATA_DIR}`);

    // Search test
    console.log('\n--- Semantic search test ---');
    const queries = ['量化交易 因子', '浏览器 历史记录 归档', '时间序列 统计'];
    for (const q of queries) {
        const qvec = (await embedBatch([q]))[0];
        if (!qvec) continue;
        try {
            const results = await db.query(`
                SELECT slug, substr(chunk_text, 1, 100) as snippet,
                       round((1 - (embedding <=> $1::vector))::numeric, 3) as score
                FROM chunks WHERE embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector LIMIT 2
            `, [JSON.stringify(qvec)]);
            console.log(`\n"${q}"`);
            for (const r of results.rows) {
                console.log(`  [${r.score}] ${r.slug}`);
                console.log(`    ${r.snippet}...`);
            }
        } catch (e) {
            console.error(`  Search error: ${e.message.split('\n')[0]}`);
        }
    }

    await db.close();
    console.log('\nVector DB ready. Run again to sync changes.');
}

main().catch(e => {
    console.error('\nFATAL:', e.message.split('\n')[0]);
    process.exit(1);
});

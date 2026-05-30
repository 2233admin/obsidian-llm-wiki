#!/usr/bin/env python3
"""pdf-ingest.py -- extract PDF text via PyMuPDF and ingest into vaultbrain PGLite."""
import argparse, json, os, subprocess, tempfile
from pathlib import Path

OLLAMA = "http://localhost:11434"
MODEL = "bge-m3"
NODE_BIN = r"C:\Program Files\nodejs\node.exe"

def embed(text):
    if not text.strip(): return None
    import urllib.request
    payload = json.dumps({"model": MODEL, "input": text[:8000]}).encode()
    req = urllib.request.Request(f"{OLLAMA}/v1/embeddings", data=payload,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
            return d.get("data", [{}])[0].get("embedding")
    except: return None

def simple_hash(s):
    h = 5381
    for c in s: h = ((h << 5) + h + ord(c)) & 0xFFFFFFFF
    return f"{h & 0xFFFFFFFF:08x}"

def chunk(text, max_chars=2048):
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if len(p) <= max_chars:
            if buf and len(buf)+len(p) > max_chars: chunks.append(buf); buf = p
            else: buf = (buf+"\n\n"+p) if buf else p
        else:
            if buf: chunks.append(buf); buf = ""
            for i in range(0, len(p), max_chars): chunks.append(p[i:i+max_chars])
    if buf: chunks.append(buf)
    return chunks

def find_pdfs(root):
    skip = {".git",".obsidian","node_modules","ghidra"}
    return [p for p in Path(root).rglob("*.pdf") if not any(s in p.parts for s in skip)]

def extract(pdf_path):
    import fitz
    doc = fitz.open(pdf_path)
    text = "".join(page.get_text() for page in doc)
    doc.close()
    title = pdf_path.stem.replace("_"," ").replace("-"," ")
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for l in lines[:8]:
        if 5 < len(l) < 100 and not l.startswith("http"): title = l; break
    return title, text

def upsert(slug, title, content, hash_val, chunks_data, embs, db_dir):
    base = Path(__file__).parent.parent.as_posix().replace("/", "\\\\")
    db_dir_win = db_dir.replace(chr(92), "/")
    script = f"""
const {{PGlite}} = require('{base}/mcp-server/node_modules/@electric-sql/pglite/dist/index.cjs');
const {{vector}} = require('{base}/mcp-server/node_modules/@electric-sql/pglite/dist/vector/index.js');
async function upsert() {{
    const db = new PGlite('{db_dir_win}', {{extensions:{{vector}}}});
    await db.waitReady;
    await db.query(`INSERT INTO pages(slug,title,content,hash,updated_at)
        VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(slug) DO UPDATE SET
        title=EXCLUDED.title,content=EXCLUDED.content,hash=EXCLUDED.hash,updated_at=EXCLUDED.updated_at`,
        [{json.dumps(slug)},{json.dumps(title)},{json.dumps(content[:100000])},{json.dumps(hash_val)}]);
    await db.query(`DELETE FROM chunks WHERE slug=$1`,[{json.dumps(slug)}]);
    const cs={json.dumps(chunks_data)}; const ems={json.dumps(embs)};
    for(let i=0;i<cs.length;i++){{
        if(ems[i]){{
            await db.query(`INSERT INTO chunks(slug,chunk_index,chunk_text,embedding,token_count)
                VALUES($1,$2,$3,$4::vector,$5)`,
                [{json.dumps(slug)},i,cs[i],JSON.stringify(ems[i]),Math.ceil(cs[i].length/4)]);
        }}
    }}
    await db.close(); console.log('OK');
}}
upsert().catch(e=>{{console.error('FAIL:',e.message);process.exit(1);}});
"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(script)
        tmp = f.name
    try:
        r = subprocess.run([NODE_BIN, tmp], capture_output=True, text=True)
        if r.returncode != 0 or "OK" not in r.stdout:
            print(f"Node ERR: {r.stderr[:200]}")
            print(f"Node OUT: {r.stdout[:200]}")
        return r.returncode == 0 and "OK" in r.stdout
    finally:
        os.unlink(tmp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="D:/knowledge")
    ap.add_argument("--db-dir", default="C:/Users/Administrator/.vault-mind/vaultbrain")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    vault, db_dir = Path(args.vault), Path(args.db_dir)
    os.makedirs(db_dir, exist_ok=True)
    print(f"Vault: {vault}  DB: {db_dir}")
    pdfs = find_pdfs(vault)
    print(f"Found {len(pdfs)} PDFs\n")
    for i, pdf in enumerate(pdfs, 1):
        rel = str(pdf.relative_to(vault))
        slug = f"PDF:{rel.replace(chr(92),'/').replace('.pdf','')}"
        print(f"[{i}/{len(pdfs)}] {rel}... ", end="", flush=True)
        title, text = extract(pdf)
        chunks = chunk(text)
        print(f"{len(text)} chars, {len(chunks)} chunks ", end="", flush=True)
        if args.dry_run: print("[dry-run]"); continue
        if len(text) < 100:
            print("SKIP (no text)")
            continue
        h = simple_hash(text)
        embs = [embed(c) for c in chunks]
        ok = upsert(slug, title, text, h, chunks, embs, str(db_dir))
        n_emb = sum(1 for e in embs if e)
        print(f"({n_emb}/{len(embs)} emb) {'OK' if ok else 'FAIL'}")
    print(f"\nDone.")

if __name__ == "__main__": main()

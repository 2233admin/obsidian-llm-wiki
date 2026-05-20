"""Benchmark chunker.py"""

import time
import sys
sys.path.insert(0, 'compiler')

from pathlib import Path
from chunker import chunk_file

# Sample markdown content
SAMPLE_MD = Path(__file__).parent / "README.md"
if SAMPLE_MD.exists():
    text = SAMPLE_MD.read_text("utf-8-sig", errors="replace")
else:
    text = "# Test\n\n" + "\n\n".join([f"Paragraph {i}\n\nLorem ipsum dolor sit amet." * 10 for i in range(100)])

# Create a temp file for testing
import tempfile
tmp = Path(tempfile.mktemp(suffix=".md"))
tmp.write_text(text * 5, encoding="utf-8")

def benchmark_chunk_file():
    iterations = 500
    start = time.perf_counter()
    for _ in range(iterations):
        result = chunk_file(tmp, "test", chunk_size=1000, chunk_overlap=200)
    elapsed = time.perf_counter() - start
    print(f"chunk_file: {elapsed:.4f}s for {iterations} iterations ({elapsed/iterations*1000:.4f}ms per call)")
    print(f"  Chunks produced: {len(result)}")
    return elapsed / iterations

if __name__ == "__main__":
    benchmark_chunk_file()
    tmp.unlink(missing_ok=True)

"""Benchmark extractor.py - focus on _call_api and message building"""

import time
import sys
sys.path.insert(0, 'compiler')

import json
import orjson
from dataclasses import dataclass
from models import Chunk

# Simulate a chunk
@dataclass
class TestChunk:
    content: str
    source: str
    heading: str | None

chunk = TestChunk(
    content="This is a test chunk with some content about machine learning and AI.",
    source="test.md",
    heading="Test Section"
)

def benchmark_build_message():
    """Benchmark _build_user_message logic"""
    iterations = 10000
    existing_concepts = [f"concept_{i}" for i in range(20)]

    start = time.perf_counter()
    for _ in range(iterations):
        existing_str = ", ".join(existing_concepts[:50]) if existing_concepts else "none"
        heading_str = f"\nSection: {chunk.heading}" if chunk.heading else ""
        result = (
            f"Source: {chunk.source}"
            f"{heading_str}\n"
            f"Existing concepts (skip these): {existing_str}\n\n"
            f"---\n{chunk.content}\n---"
        )
    elapsed = time.perf_counter() - start
    print(f"build_message: {elapsed:.4f}s for {iterations} iterations ({elapsed/iterations*1000:.4f}ms per call)")
    return elapsed / iterations

def benchmark_json_payload():
    """Benchmark JSON payload building"""
    iterations = 10000
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello world"},
    ]

    start = time.perf_counter()
    for _ in range(iterations):
        payload = orjson.dumps({
            "model": "test-model",
            "messages": messages,
            "max_tokens": 1024,
            "temperature": 0.2,
        })
    elapsed = time.perf_counter() - start
    print(f"orjson_dumps: {elapsed:.4f}s for {iterations} iterations ({elapsed/iterations*1000:.4f}ms per call)")

    # Compare with stdlib json
    start = time.perf_counter()
    for _ in range(iterations):
        payload = json.dumps({
            "model": "test-model",
            "messages": messages,
            "max_tokens": 1024,
            "temperature": 0.2,
        }).encode("utf-8")
    elapsed2 = time.perf_counter() - start
    print(f"json_dumps+encode: {elapsed2:.4f}s for {iterations} iterations ({elapsed2/iterations*1000:.4f}ms per call)")
    print(f"  Speedup: {elapsed2/elapsed:.2f}x")
    return elapsed / iterations

def benchmark_markdown_strip():
    """Benchmark markdown fence stripping - old vs new"""
    iterations = 10000
    test_strings = [
        '```json\n{"summary": "test"}\n```',
        '```\nsome code\n```',
        'plain text without fences',
        '```json\n{"a": 1}\n```',
    ]

    # Old approach
    start = time.perf_counter()
    for _ in range(iterations):
        for raw in test_strings:
            raw = raw.strip()
            if raw.startswith("```"):
                raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = "\n".join(raw.split("\n")[:-1])
    elapsed_old = time.perf_counter() - start
    total = iterations * len(test_strings)
    print(f"old markdown_strip: {elapsed_old:.4f}s for {total} ({elapsed_old/total*1000:.4f}ms per call)")

    # New approach
    start = time.perf_counter()
    for _ in range(iterations):
        for raw in test_strings:
            raw = raw.strip()
            if raw.startswith("```"):
                first_newline = raw.find("\n")
                last_newline = raw.rfind("\n")
                if first_newline != last_newline:
                    raw = raw[first_newline+1:last_newline]
                else:
                    raw = raw[first_newline+1:] if first_newline >= 0 else ""
            if raw.endswith("```"):
                raw = raw[:-3].rstrip()
    elapsed_new = time.perf_counter() - start
    print(f"new markdown_strip: {elapsed_new:.4f}s for {total} ({elapsed_new/total*1000:.4f}ms per call)")
    print(f"  Speedup: {elapsed_old/elapsed_new:.2f}x")
    return elapsed_new / total

if __name__ == "__main__":
    t1 = benchmark_build_message()
    t2 = benchmark_json_payload()
    t3 = benchmark_markdown_strip()
    print(f"\nTotal benchmark time: {(t1+t2+t3)*1000:.4f}ms per full cycle")

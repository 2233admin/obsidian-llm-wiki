"""orjson-compatible JSON shim with a stdlib fallback.

The compiler is zero-dependency by design (CLAUDE.md). orjson is an optional
speed-up, not a hard requirement -- when it is not installed we fall back to the
stdlib `json`, exposing the byte-oriented subset of the orjson API this codebase
actually uses:

    dumps(obj) -> bytes               # compact, UTF-8, no trailing whitespace
    loads(data: bytes | str) -> obj
    JSONDecodeError                   # raised by loads() on malformed input

Call sites use `import json_compat as orjson`, so `orjson.dumps/.loads/
.JSONDecodeError` work identically whether orjson is present or not.
"""

from __future__ import annotations

try:
    import orjson as _orjson

    dumps = _orjson.dumps
    loads = _orjson.loads
    JSONDecodeError = _orjson.JSONDecodeError
except ModuleNotFoundError:
    import json as _json

    JSONDecodeError = _json.JSONDecodeError

    def dumps(obj) -> bytes:
        """Match orjson.dumps: return compact UTF-8 bytes so callers can append
        b"\\n" and write in binary mode."""
        return _json.dumps(
            obj, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")

    def loads(data):
        """Match orjson.loads: accept bytes or str."""
        if isinstance(data, (bytes, bytearray, memoryview)):
            data = bytes(data).decode("utf-8")
        return _json.loads(data)

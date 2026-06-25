---
id: tasks/implement-kv-cache
description: Implement KV-cache to avoid recomputing attention for past tokens
kind: knowledge-task
status: active
---

# Task: Implement KV-cache

Cache key/value tensors from previous forward passes so autoregressive
decoding only attends to new tokens. Depends on [[attention]].

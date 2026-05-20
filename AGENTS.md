# obsidian-llm-wiki SOTA 优化任务

## 任务列表

### P0 - 性能优化

- [ ] **fast-json-stringify** - mcp-server/src/connector/fs-transport.ts
  用 fast-json-stringify 替换 JSON.stringify，预期 2-5x 序列化加速

- [ ] **预编译正则** - mcp-server/src/index.ts
  walkMd 中的 wikilink 解析正则预编译到模块级别

- [ ] **walkMd 缓存** - mcp-server/src/index.ts
  LRU 缓存 walkMd 结果，避免重复扫描

- [ ] **asyncio.gather** - compiler/extractor.py
  LLM 批量调用改并发，预期 3-5x 加速

### P1 - 功能增强

- [ ] **HNSW 向量索引** - mcp-server/src/embedding-client.ts
  用 hnswlib-node 替换 Ollama 单机 embedding

- [ ] **增量编译** - compiler/compile.py
  git diff 驱动增量更新，不是全量重扫

- [ ] **WAL 追加日志** - compiler/
  append-only 变更日志，支持时间旅行

### P2 - 工程化

- [ ] **benchmark 基准测试** - 添加性能回归测试
- [ ] **CI 优化** - 并行跑 npm test + pytest
- [ ] **bundle 优化** - esbuild tree-shaking

## 验证命令

```bash
cd mcp-server && npm test
cd .. && python -m pytest compiler/tests/
```

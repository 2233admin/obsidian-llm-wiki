# GIF script: 10-second demo

## Scene 1 (0-3s): Paste install prompt

Show Claude Code window. Cursor is on an empty line in a project directory.

Type (animate character by character):

```
Install obsidian-llm-wiki: git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki ~/.claude/skills/vault-wiki && cd ~/.claude/skills/vault-wiki && ./setup
```

Press Enter. Show brief terminal output scrolling (setup runs, completes).

## Scene 2 (3-6s): Ask the librarian

Show Claude Code prompt. Type:

```
/vault-librarian what do I know about attention heads
```

Press Enter. Show thinking indicator (1-2 seconds).

## Scene 3 (6-10s): Citation-backed answer

Show response appearing with citations:

```
Based on your vault, you have 3 notes related to attention heads:

1. [[attention-heads]] (main note)
   - Defines multi-head self-attention as the core mechanism in transformers
   - Links to: [[transformers]], [[kv-cache]]
   - Tags: #transformer #attention-mechanism

2. [[transformers]] (referenced by 5 notes)
   - Uses attention heads as its primary building block
   - Mentions: "scaled dot-product attention" once

3. [[kv-cache]] (backlinks: 2)
   - Optimization for inference with multi-head attention
   - Alias: "kv-cache"
```

Highlight one citation as it appears.

## Recording notes

- Use a dark-theme terminal or Claude Code theme for contrast
- 1200x700 canvas, 30fps
- Use `byzanz-record` or ScreenToGif to capture
- Keep the font monospaced and readable at 16px equivalent
- Do not show API keys, vault paths, or personal data

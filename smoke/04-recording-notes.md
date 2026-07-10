# Recording Notes: GIF Script for README

## Overview
The GIF demonstrates the core value proposition: paste install prompt -> ask librarian a question -> get citation-backed answer.

## Timing Budget (under 10 seconds total)
- 0-2s: Paste install prompt into Claude Code
- 2-4s: Claude Code clones + runs setup
- 4-6s: Claude Code responds with confirmation
- 6-8s: User runs `/vault-librarian what do I know about attention heads`
- 8-10s: Librarian responds with citation to `attention-heads.md`

## Frames to Capture

### Frame 1: Install Prompt (0-2s)
```
$ <paste 01-install-prompt.md contents>
```
Show: Terminal with fresh prompt, paste action

### Frame 2: Clone + Setup (2-4s)
```
Cloning into 'vault-wiki'...
Running setup script...
Done! Your vault is ready.
```
Show: git clone output, setup completing

### Frame 3: Confirmation (4-6s)
```
[vault-wiki] installed successfully
6 personas ready: librarian, architect, curator, teacher, historian, janitor
```
Show: Success message with persona list

### Frame 4: Librarian Query (6-8s)
```
/vault-librarian what do I know about attention heads
```
Show: Claude Code command being typed

### Frame 5: Citation Response (8-10s)
```
Based on your vault, you have notes on attention heads in:
- attention-heads.md (created 2025-02-14)

Key concepts: multi-head attention, scaled dot product, Q/K/V subspaces.
Related: [[kv-cache]], [[speculative-decoding]]
```
Show: Response with citation, related links

## Recording Setup
- Use terminal recorder (asciinema or LICEcap)
- Font: monospace, 14pt minimum
- Theme: dark background, high contrast
- Window: 80x24 or 120x40
- Show cursor blink during typing

## Verification Checklist
- [ ] Install prompt is ONE paste, no extra commands
- [ ] Setup completes without user interaction
- [ ] Librarian response includes REAL citation to demo-vault file
- [ ] Response mentions `attention-heads.md` specifically
- [ ] Total GIF length under 10 seconds
- [ ] No personal information or secrets visible

## Post-Production
- Trim to exact timing
- Add subtle fade-in at start, fade-out at end
- No audio required
- Export as GIF or WebM (GIF for maximum compatibility)

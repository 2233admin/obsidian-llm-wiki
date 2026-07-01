# Links in Code Blocks

These should NOT be extracted as links:

```markdown
This is inside a fenced code block:
[[NotALink]]
[NotALink](real-link.md)
```

```python
# Python code
link = "[[CodeBlockLink]]"
```

And inline code: `[[InlineCodeLink]]` and `[inline](link.md)`

These SHOULD be extracted:

- Real wikilink: [[RealLink]]
- Real markdown: [Real](real-link.md)

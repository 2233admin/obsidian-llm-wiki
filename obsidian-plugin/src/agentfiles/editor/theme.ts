import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const obsidianHighlightStyle = HighlightStyle.define([
	{ tag: tags.heading1, fontWeight: "700", fontSize: "1.4em" },
	{ tag: tags.heading2, fontWeight: "700", fontSize: "1.2em" },
	{ tag: tags.heading3, fontWeight: "700", fontSize: "1.1em" },
	{ tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
	{ tag: tags.strong, fontWeight: "700" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
	{ tag: tags.keyword, color: "var(--color-purple)" },
	{ tag: [tags.atom, tags.bool], color: "var(--color-orange)" },
	{ tag: tags.number, color: "var(--color-orange)" },
	{ tag: tags.string, color: "var(--color-green)" },
	{ tag: tags.variableName, color: "var(--text-normal)" },
	{ tag: [tags.processingInstruction, tags.inserted], color: "var(--color-green)" },
	{ tag: [tags.deleted], color: "var(--color-red)" },
	{ tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
	{ tag: tags.meta, color: "var(--text-faint)" },
	{ tag: tags.link, color: "var(--text-accent)", textDecoration: "underline" },
	{ tag: tags.url, color: "var(--text-accent)" },
	{ tag: tags.monospace, fontFamily: "var(--font-monospace)" },
	{ tag: [tags.contentSeparator], color: "var(--text-faint)" },
	{ tag: [tags.definition(tags.variableName)], color: "var(--color-cyan)" },
	{ tag: [tags.typeName], color: "var(--color-yellow)" },
	{ tag: [tags.function(tags.variableName)], color: "var(--color-blue)" },
]);

export const obsidianTheme = EditorView.theme({
	"&": {
		backgroundColor: "var(--background-primary)",
		color: "var(--text-normal)",
		fontFamily: "var(--font-monospace)",
		fontSize: "var(--font-ui-small)",
		height: "100%",
	},
	".cm-scroller": {
		overflow: "auto",
		lineHeight: "1.6",
	},
	".cm-gutters": {
		backgroundColor: "var(--background-secondary)",
		color: "var(--text-faint)",
		border: "none",
		paddingLeft: "4px",
	},
	".cm-activeLineGutter": {
		backgroundColor: "var(--background-modifier-hover)",
		color: "var(--text-muted)",
	},
	".cm-activeLine": {
		backgroundColor: "var(--background-modifier-hover)",
	},
	"&.cm-focused .cm-cursor": {
		borderLeftColor: "var(--text-accent)",
	},
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
		backgroundColor: "var(--text-selection)",
	},
	".cm-foldGutter .cm-gutterElement": {
		color: "var(--text-faint)",
		cursor: "pointer",
	},
	".cm-foldPlaceholder": {
		backgroundColor: "var(--background-modifier-hover)",
		color: "var(--text-muted)",
		border: "none",
		padding: "0 4px",
		borderRadius: "var(--radius-s)",
	},
	".cm-tooltip": {
		backgroundColor: "var(--background-secondary)",
		color: "var(--text-normal)",
		border: "1px solid var(--background-modifier-border)",
		borderRadius: "var(--radius-s)",
	},
	".cm-tooltip-lint": {
		backgroundColor: "var(--background-secondary)",
	},
	".cm-lintRange-warning": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--text-warning)",
		textUnderlineOffset: "3px",
	},
	".cm-lintRange-info": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--text-faint)",
		textUnderlineOffset: "3px",
	},
	".cm-lint-marker-warning::after": {
		content: '"⚠"',
	},
});





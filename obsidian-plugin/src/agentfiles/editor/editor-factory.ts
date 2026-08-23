import {
	EditorView,
	lineNumbers,
	highlightActiveLineGutter,
	highlightActiveLine,
	drawSelection,
	highlightSpecialChars,
	keymap,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
	indentOnInput,
	bracketMatching,
	foldGutter,
	foldKeymap,
	syntaxHighlighting,
} from "@codemirror/language";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap } from "@codemirror/search";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { markdown } from "@codemirror/lang-markdown";
import { obsidianTheme, obsidianHighlightStyle } from "./theme";
import { frontmatterLinter } from "./frontmatter-lint";
import { frontmatterFoldService } from "./frontmatter-fold";

interface SkillEditorConfig {
	doc: string;
	parent: HTMLElement;
	onSave: (content: string) => void;
}

export function createSkillEditor(config: SkillEditorConfig): EditorView {
	const { doc, parent, onSave } = config;

	const extensions = [
		obsidianTheme,
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightActiveLine(),
		highlightSpecialChars(),
		history(),
		foldGutter(),
		drawSelection(),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		syntaxHighlighting(obsidianHighlightStyle),
		EditorView.darkTheme.of(activeDocument.body.classList.contains("theme-dark")),
		frontmatterLinter,
		frontmatterFoldService,
		lintGutter(),
		EditorView.lineWrapping,
		keymap.of([
			{
				key: "Mod-s",
				run: (view) => {
					onSave(view.state.doc.toString());
					return true;
				},
			},
			indentWithTab,
			...closeBracketsKeymap,
			...defaultKeymap,
			...historyKeymap,
			...foldKeymap,
			...searchKeymap,
			...lintKeymap,
		]),
	];

	extensions.push(markdown());

	return new EditorView({
		state: EditorState.create({ doc, extensions }),
		parent,
	});
}





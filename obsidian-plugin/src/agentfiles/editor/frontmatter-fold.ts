import { foldService } from "@codemirror/language";

export const frontmatterFoldService = foldService.of(
	(state, lineStart, _lineEnd) => {
		const line = state.doc.lineAt(lineStart);
		if (line.number !== 1 || line.text.trim() !== "---") return null;

		for (let i = line.number + 1; i <= state.doc.lines; i++) {
			const nextLine = state.doc.line(i);
			if (nextLine.text.trim() === "---") {
				return { from: line.to, to: nextLine.to };
			}
		}
		return null;
	},
);





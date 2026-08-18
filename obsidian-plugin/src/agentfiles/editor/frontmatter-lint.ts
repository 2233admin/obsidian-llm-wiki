import { linter, type Diagnostic } from "@codemirror/lint";

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const frontmatterLinter = linter((view) => {
	const diagnostics: Diagnostic[] = [];
	const doc = view.state.doc.toString();

	if (!doc.startsWith("---")) return diagnostics;

	const closingIndex = doc.indexOf("\n---", 3);
	if (closingIndex === -1) {
		diagnostics.push({
			from: 0,
			to: 3,
			severity: "error",
			message: "Unclosed frontmatter block, missing closing ---",
		});
		return diagnostics;
	}

	const fmContent = doc.slice(4, closingIndex);
	const lines = fmContent.split("\n");
	let offset = 4;
	const seenKeys: string[] = [];

	for (const line of lines) {
		const keyMatch = line.match(/^(\w[\w-]*)\s*:(.*)/);
		if (keyMatch) {
			const key = keyMatch[1];
			const value = keyMatch[2].trim();

			if (seenKeys.includes(key)) {
				diagnostics.push({
					from: offset,
					to: offset + key.length,
					severity: "warning",
					message: `Duplicate key: "${key}"`,
				});
			}
			seenKeys.push(key);

			if (key === "name") {
				if (!value) {
					diagnostics.push({
						from: offset,
						to: offset + line.length,
						severity: "error",
						message: "name is required",
					});
				} else if (value.length > 64) {
					diagnostics.push({
						from: offset,
						to: offset + line.length,
						severity: "warning",
						message: `name exceeds 64 chars (${value.length})`,
					});
				} else if (!NAME_PATTERN.test(value)) {
					diagnostics.push({
						from: offset + key.length + 2,
						to: offset + line.length,
						severity: "warning",
						message: "name must be lowercase alphanumeric with single hyphens, no leading/trailing hyphens",
					});
				}
			}

			if (key === "description") {
				if (!value) {
					diagnostics.push({
						from: offset,
						to: offset + line.length,
						severity: "warning",
						message: "description is empty",
					});
				} else if (value.length > 1024) {
					diagnostics.push({
						from: offset,
						to: offset + line.length,
						severity: "warning",
						message: `description exceeds 1024 chars (${value.length})`,
					});
				}
			}

			if (key === "compatibility" && value.length > 500) {
				diagnostics.push({
					from: offset,
					to: offset + line.length,
					severity: "warning",
					message: `compatibility exceeds 500 chars (${value.length})`,
				});
			}
		}
		offset += line.length + 1;
	}

	return diagnostics;
});





async function switchLightDark() {
  const isDarkMode = app.vault.getConfig("theme") === "obsidian";
  if (isDarkMode) {
    app.setTheme("moonstone");
    app.vault.setConfig("theme", "moonstone");
    app.workspace.trigger("css-change");
  } else {
    app.setTheme("obsidian");
    app.vault.setConfig("theme", "obsidian");
    app.workspace.trigger("css-change");
  }
}

exports.default = {
  name: "switchLightDark",
  description: `Switch between light and dark mode`,
  entry: switchLightDark,
};

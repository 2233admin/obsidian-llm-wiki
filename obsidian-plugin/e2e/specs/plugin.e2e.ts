import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

const PLUGIN_ID = "vault-mind-promote";
const PROJECT_ID = "project/e2e-demo";
const ASK_MATE = '.workspace-leaf-content[data-type="llmwiki-ask-mate"]';

// Collect uncaught errors and console.error calls raised inside Obsidian so
// every step can assert the plugin stayed quiet.
async function captureErrors(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as { __e2eErrors?: string[] };
    if (w.__e2eErrors) return;
    const errors: string[] = (w.__e2eErrors = []);
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errors.push(args.map(a => (a as Error)?.stack ?? String(a)).join(" "));
      original(...args);
    };
    window.addEventListener("error", e => errors.push(e.error?.stack ?? e.message));
    window.addEventListener("unhandledrejection", e => errors.push((e.reason as Error)?.stack ?? String(e.reason)));
  });
}

async function takeErrors(): Promise<string[]> {
  return browser.execute(() => {
    const w = window as unknown as { __e2eErrors: string[] };
    return w.__e2eErrors.splice(0);
  });
}

async function vaultFiles(): Promise<string[]> {
  return browser.executeObsidian(({ app }) => app.vault.getFiles().map(f => f.path).sort());
}

// Obsidian's status bar floats over the bottom of the pane, and WebDriver
// scrolls targets only to the viewport edge, so center them before clicking.
async function clickInAskMate(selector: string): Promise<void> {
  const element = await browser.$(ASK_MATE).$(selector);
  await element.waitForEnabled();
  await browser.execute(el => el.scrollIntoView({ block: "center" }), element);
  await element.click();
}

const clickAskMate = (label: string) => clickInAskMate(`button=${label}`);

describe("LLM Wiki plugin in Obsidian", function () {
  before(async function () {
    await captureErrors();
  });

  afterEach(async function () {
    expect(await takeErrors()).toEqual([]);
  });

  it("loads and registers its commands", async function () {
    const commands = await browser.executeObsidian(({ app }) =>
      Object.keys((app as any).commands.commands).filter(id => id.startsWith("vault-mind-promote:")),
    );
    expect(commands).toEqual(expect.arrayContaining([
      `${PLUGIN_ID}:open-ask-mate`,
      `${PLUGIN_ID}:open-ask-mate-active-note`,
      `${PLUGIN_ID}:promote-candidate`,
      `${PLUGIN_ID}:open-agentfiles`,
    ]));
  });

  it("opens from the ribbon on first run without asking for a Project", async function () {
    await browser.$('.side-dock-ribbon-action[aria-label="Open LLM Wiki"]').click();
    await browser.$(ASK_MATE).waitForDisplayed();
    expect(await browser.$(".llmwiki-project-binding-input").isExisting()).toBe(false);

    const slug = await browser.executeObsidian(({ app }) =>
      (app as any).plugins.plugins["vault-mind-promote"].data.deviceBinding.workspaceProjectId.slice("project/".length),
    );
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(await vaultFiles()).toEqual(expect.arrayContaining([
      `01-Projects/${slug}/_project.md`,
      `Projects/${slug}.md`,
    ]));

    // The rest of the suite works in a fixed Project.
    await browser.executeObsidian(async ({ app }, projectId) => {
      await (app as any).plugins.plugins["vault-mind-promote"].bindWorkspaceProject(projectId);
    }, PROJECT_ID);
  });

  it("understands the active note and applies a map plan", async function () {
    await obsidianPage.openFile("notes/plan.md");
    await browser.executeObsidianCommand(`${PLUGIN_ID}:open-ask-mate-active-note`);
    await expect(browser.$(ASK_MATE)).toHaveText(expect.stringContaining("Markdown note notes/plan.md"));
    for (const label of ["Ask this context", "Understand", "Shape a map", "Prepare a fix"]) {
      await expect(browser.$(ASK_MATE).$(`button=${label}`)).toBeDisplayed({ withinViewport: true });
    }
    const blockIdNotes = await browser.$(ASK_MATE).$$("p*=no block ID").length;
    expect(blockIdNotes).toBe(1);

    await clickAskMate("Understand");
    await expect(browser.$(ASK_MATE)).toHaveText(expect.stringContaining("Interpreted structure"));

    await clickAskMate("Shape a map");
    await clickAskMate("Preview exact plan");
    await clickInAskMate("input[type=checkbox]");
    await clickAskMate("Apply confirmed plan");

    await browser.waitUntil(async () => (await vaultFiles()).some(path => path.startsWith("01-Projects/e2e-demo/maps/")));
  });

  it("answers from Project evidence and saves the answer to Inbox", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("01-Projects/e2e-demo/risks.md", "# Risks\n\nThe Python runtime may be missing on new machines.\n");
    });
    await obsidianPage.openFile("01-Projects/e2e-demo/risks.md");
    await browser.executeObsidianCommand(`${PLUGIN_ID}:open-ask-mate-active-note`);
    await clickAskMate("Ask this context");
    await browser.$(ASK_MATE).$("textarea").setValue("What are the risks?");
    await clickAskMate("Get cited answer");
    await expect(browser.$(ASK_MATE)).toHaveText(expect.stringContaining("01-Projects/e2e-demo/risks.md"));

    await clickAskMate("Save cited answer to Inbox for review");
    await browser.waitUntil(async () => (await vaultFiles()).some(path => path.startsWith("00-Inbox/AI-Output/vault-ask/")));
  });

  it("reads default Canvas edges as directed", async function () {
    await obsidianPage.openFile("board.canvas");
    await browser.executeObsidianCommand(`${PLUGIN_ID}:open-ask-mate-active-canvas`);
    await expect(browser.$(ASK_MATE)).toHaveText(expect.stringContaining("Model:"));
    await expect(browser.$(ASK_MATE)).not.toHaveText(expect.stringContaining("has no arrow"));
  });

  it("renders the settings page and runs Doctor", async function () {
    const { tabCount, status } = await browser.executeObsidian(async ({ app }) => {
      const setting = (app as any).setting;
      setting.open();
      setting.openTabById("vault-mind-promote");
      const tab = setting.activeTab;
      const doctor = Array.from(tab.containerEl.querySelectorAll("button") as NodeListOf<HTMLButtonElement>)
        .find(b => b.innerText.includes("Doctor"));
      doctor?.click();
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = tab.containerEl.innerText as string;
      setting.close();
      return { tabCount: setting.pluginTabs.filter((t: any) => t.id === "vault-mind-promote").length, status: text };
    });
    expect(tabCount).toBe(1);
    expect(status).toContain("System status");
    expect(status).toContain("vault.filesystem");
    expect(status).toContain("runtime.kb_meta");
    expect(status).toContain("LLM Wiki runtime entry is not set");
    expect(status).toContain("Absolute path to compiler/kb_meta.py");
    expect(status).toContain("Capability Library");
    expect(status).toContain("File watching");
  });

  it("survives disable, re-enable, and an app restart", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await (app as any).plugins.disablePlugin("vault-mind-promote");
      await (app as any).plugins.enablePlugin("vault-mind-promote");
    });
    await browser.reloadObsidian();
    await captureErrors();
    const projectId = await browser.executeObsidian(({ app }) =>
      (app as any).plugins.plugins["vault-mind-promote"].data.deviceBinding.workspaceProjectId,
    );
    expect(projectId).toBe(PROJECT_ID);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectHubRecoveryClient,
  RECOVERY_APPLY_OPERATION,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
} from "../src/project-hub/recovery-client";
import { ProjectHubRecoveryPanel } from "../src/project-hub/recovery-panel";
import type { RecoveryFlowResponseV2 } from "../../mcp-server/src/project-hub/recovery-flow";
import type { RecoveryApplyResponseV2 } from "../../mcp-server/src/workflow/recovery-apply";

const projectId = "project/alpha" as const;
const fp = (char: string) => `sha256:${char.repeat(64)}` as `sha256:${string}`;
const binding = { bindingId: "binding/alpha/builder", bindingRevision: 2, role: "builder", profileId: "agent/builder", profileRevision: 3 };
const candidate = { candidateId: "resume:work-run/one", kind: "resume" as const, workItemId: "project/alpha/issue/alpha", workRunId: "work-run/one", contextSource: "work-run" as const, recommended: true };

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly ownerDocument = { activeElement: null as FakeElement | null };
  textContent = "";
  value = "";
  onclick: ((event: unknown) => void) | null = null;
  oninput: (() => void) | null = null;
  onkeydown: ((event: { key: string }) => void) | null = null;
  disabled = false;

  constructor(readonly tagName: string) {}

  createEl(tag: string, options: { text?: string; cls?: string; href?: string; type?: string; attr?: Record<string, string> } = {}): FakeElement {
    const child = new FakeElement(tag.toUpperCase());
    child.textContent = options.text ?? "";
    if (options.cls) child.attributes.set("class", options.cls);
    if (options.href) child.attributes.set("href", options.href);
    if (options.type) child.attributes.set("type", options.type);
    for (const [name, value] of Object.entries(options.attr ?? {})) child.attributes.set(name, value);
    this.children.push(child);
    return child;
  }

  createSpan(options: { text?: string } = {}): FakeElement { return this.createEl("span", options); }
  createDiv(options: { text?: string; cls?: string } = {}): FakeElement { return this.createEl("div", options); }
  empty(): void { this.children.length = 0; }
  addClass(cls: string): void { this.attributes.set("class", `${this.attributes.get("class") ?? ""} ${cls}`.trim()); }
  setAttr(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setText(text: string): void { this.textContent = text; }
  focus(): void { this.ownerDocument.activeElement = this; }

  querySelectorAll<T extends FakeElement>(selector: string): T[] {
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      if (selector === element.tagName.toLowerCase() || (selector === "[data-recovery-focus]" && element.attributes.has("data-recovery-focus"))) matches.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches as T[];
  }
}

function openResponse(): RecoveryFlowResponseV2 {
  return { schemaVersion: "project-hub-recovery-flow/v2", stage: "open", projectId, previousFlowFingerprint: null, actionInputFingerprint: fp("1"), recoveryFingerprint: fp("2"), ownerLocks: [], payload: { kind: "open", workItemId: candidate.workItemId, workRunId: candidate.workRunId, contextSource: "work-run", citations: ["issue:alpha"], suggestedQueries: ["recovery"] }, nextRequestIntents: [{ action: "search", query: "recovery", limit: 5 }], diagnostics: [], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 }, rootOpenFlowFingerprint: fp("3"), nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: "search", openFlowFingerprint: fp("3"), query: "recovery", limit: 5 }], generatedAt: "2026-08-28T00:00:00.000Z", flowFingerprint: fp("3") } as RecoveryFlowResponseV2;
}

function searchedResponse(): RecoveryFlowResponseV2 {
  return { schemaVersion: "project-hub-recovery-flow/v2", stage: "searched", projectId, previousFlowFingerprint: fp("3"), actionInputFingerprint: fp("4"), recoveryFingerprint: fp("2"), ownerLocks: [], payload: { kind: "searched", query: "recovery", limit: 5, searchInputFingerprint: fp("5"), searchFingerprint: fp("6"), results: [], candidates: [candidate], recommendedCandidateId: candidate.candidateId, candidateSetFingerprint: fp("7"), bindings: [binding] }, nextRequestIntents: [{ action: "plan", mode: "from-search", query: "recovery", limit: 5, candidateId: candidate.candidateId, agentSelection: { bindingId: binding.bindingId, bindingRevision: binding.bindingRevision }, priorPlan: null }], diagnostics: [], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 }, rootOpenFlowFingerprint: fp("3"), nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: "plan", mode: "from-search", openFlowFingerprint: fp("3"), searchedBasisFlowFingerprint: fp("8"), plannedFlowFingerprint: null, query: "recovery", limit: 5, candidateId: candidate.candidateId, agentSelection: { bindingId: binding.bindingId, bindingRevision: binding.bindingRevision }, priorPlan: null }], generatedAt: "2026-08-28T00:00:00.000Z", flowFingerprint: fp("8") } as RecoveryFlowResponseV2;
}

function plannedResponse(): RecoveryFlowResponseV2 {
  const plan = { schemaVersion: "project-hub-recovery-plan/v2" as const, projectId, rootOpenFlowFingerprint: fp("3"), searchedBasisFlowFingerprint: fp("8"), recoveryFingerprint: fp("2"), searchInputFingerprint: fp("5"), searchFingerprint: fp("6"), candidateSetFingerprint: fp("7"), candidateId: candidate.candidateId, kind: "resume" as const, workItemId: candidate.workItemId, workRunId: candidate.workRunId, agentSelection: binding, ownerLocks: [], capabilityFacts: [], citationTargets: ["issue:alpha"], owningOperation: "workflow.recovery.apply" as const, createdAt: "2026-08-28T00:00:00.000Z", expiresAt: "2999-08-28T00:05:00.000Z", leaseDurationMs: 0 as const, fingerprint: fp("9") };
  return { schemaVersion: "project-hub-recovery-flow/v2", stage: "planned", projectId, previousFlowFingerprint: fp("8"), actionInputFingerprint: fp("a"), recoveryFingerprint: fp("2"), ownerLocks: [], payload: { kind: "planned", plan, candidates: [candidate.candidateId] }, nextRequestIntents: [{ action: "refresh-plan", query: "recovery", limit: 5, priorPlan: plan }], diagnostics: [], omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 }, rootOpenFlowFingerprint: fp("3"), nextRequests: [{ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: "refresh-plan", openFlowFingerprint: fp("3"), searchedBasisFlowFingerprint: fp("8"), plannedFlowFingerprint: fp("a"), query: "recovery", limit: 5, priorPlan: plan }], generatedAt: "2026-08-28T00:00:00.000Z", flowFingerprint: fp("a") } as RecoveryFlowResponseV2;
}

function applyResponse(state: RecoveryApplyResponseV2["state"]): RecoveryApplyResponseV2 {
  const receipt = state === "applied" ? {
    schemaVersion: "recovery-apply/v2" as const,
    planFingerprint: fp("9"),
    tokenDigest: fp("b"),
    projectId,
    kind: "resume" as const,
    workItemId: candidate.workItemId,
    workRunId: candidate.workRunId,
    ownerOperation: "workflow.agent.join" as const,
    ownerReceiptFingerprint: fp("c"),
    ownerReceipt: { ok: true, projectId, workItemId: candidate.workItemId, workRunId: candidate.workRunId, agent: "obsidian-control-plane" },
    recordedAt: "2026-08-28T00:01:00.000Z",
    fingerprint: fp("d"),
  } : null;
  return {
    schemaVersion: "recovery-apply/v2",
    state,
    projectId,
    planFingerprint: fp("9"),
    tokenDigest: fp("b"),
    actorId: "obsidian-control-plane",
    kind: "resume",
    workRunId: candidate.workRunId,
    receipt,
    diagnostics: state === "outcome-unknown" ? ["Owner outcome is unknown; reconcile before retrying."] : [],
    fingerprint: fp("e"),
  };
}

test("panel follows only the exact closed recommendation and keeps state ephemeral", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      const request = args.request as { action: string };
      if (request.action === "open") return openResponse() as T;
      if (request.action === "search") return searchedResponse() as T;
      return plannedResponse() as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, null);
  await panel.open(projectId);
  await panel.search("recovery");
  assert.equal(panel.state.flow?.stage, "planned");
  assert.deepEqual(calls.map(call => (call.args.request as { action: string }).action), ["open", "search", "plan"]);
  assert.deepEqual(calls[2]?.args.request, searchedResponse().nextRequests[0]);
  panel.dispose();
  assert.equal(panel.state.flow, null);
  assert.equal(panel.state.query, "");
  assert.equal(panel.state.selectedBinding, null);
});

test("panel cancellation ignores a late search response", async () => {
  let release!: (response: RecoveryFlowResponseV2) => void;
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(_operation: string, args: Record<string, unknown>): Promise<T> {
      if ((args.request as { action: string }).action === "open") return openResponse() as T;
      return new Promise<RecoveryFlowResponseV2>(resolve => { release = resolve; }) as Promise<T>;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, null);
  await panel.open(projectId);
  const search = panel.search("recovery");
  panel.cancel();
  release(searchedResponse());
  await search;
  assert.equal(panel.state.flow?.stage, "open");
  assert.equal(panel.state.busy, false);
});

test("exact Plan confirmation supports zero-mutation cancel and applied owner restart", async () => {
  const root = new FakeElement("div");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === RECOVERY_APPLY_OPERATION) return applyResponse("applied") as T;
      const request = args.request as { action: string };
      if (request.action === "open") return openResponse() as T;
      if (request.action === "search") return searchedResponse() as T;
      return plannedResponse() as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, root as unknown as HTMLElement, undefined, "obsidian-control-plane");
  await panel.open(projectId);
  await panel.search("recovery");

  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm exact Plan")?.onclick?.({});
  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Cancel")?.onclick?.({});
  assert.equal(calls.some(call => call.operation === RECOVERY_APPLY_OPERATION), false, "cancel must not invoke Workflow apply");

  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm exact Plan")?.onclick?.({});
  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm and apply")?.onclick?.({});
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.filter(call => call.operation === RECOVERY_APPLY_OPERATION).length, 1, "double activation has one apply request");
  const applyCall = calls.find(call => call.operation === RECOVERY_APPLY_OPERATION)!;
  assert.deepEqual((applyCall.args.request as { plan: unknown }).plan, plannedResponse().payload.plan);
  assert.deepEqual((applyCall.args.request as { planningInput: unknown }).planningInput, { query: "recovery", limit: 5 });
  assert.equal(panel.state.flow?.stage, "open", "applied receipt restarts from current owners");
  assert.equal(panel.state.query, "", "owner restart discards current ephemeral query");
  assert.equal(JSON.stringify(panel.state).includes("transitionToken"), false);
  assert.ok(root.querySelectorAll<FakeElement>("p").some(item => item.textContent.includes("Apply state: applied")));
});

test("outcome-unknown displays reconciliation and disables replay", async () => {
  const root = new FakeElement("div");
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      if (operation === RECOVERY_APPLY_OPERATION) return applyResponse("outcome-unknown") as T;
      const action = (args.request as { action: string }).action;
      if (action === "open") return openResponse() as T;
      if (action === "search") return searchedResponse() as T;
      return plannedResponse() as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, root as unknown as HTMLElement);
  await panel.open(projectId);
  await panel.search("recovery");
  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm exact Plan")?.onclick?.({});
  root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm and apply")?.onclick?.({});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(panel.state.applyResponse?.state, "outcome-unknown");
  const confirm = root.querySelectorAll<FakeElement>("button").find(button => button.textContent === "Confirm exact Plan");
  assert.equal(confirm?.disabled, true);
  assert.ok(root.querySelectorAll<FakeElement>("p").some(item => item.textContent.includes("Workflow outcome is unknown")));
  assert.equal(panel.state.flow?.stage, "planned", "unknown outcome does not become current owner truth");
});

test("search button follows the current query and submits once", async () => {
  const root = new FakeElement("div");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      const request = args.request as { action: string };
      if (request.action === "open") return openResponse() as T;
      return { ...searchedResponse(), payload: { ...searchedResponse().payload, recommendedCandidateId: null, bindings: [] }, nextRequests: [] } as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, root as unknown as HTMLElement);

  await panel.open(projectId);

  const input = root.querySelectorAll<FakeElement>("input").find(element => element.getAttribute("type") === "search");
  const button = root.querySelectorAll<FakeElement>("button").find(element => element.textContent === "Search");
  assert.ok(input);
  assert.ok(button);
  assert.equal(button.disabled, true);

  input.value = "   ";
  input.oninput?.();
  assert.equal(button.disabled, true);

  input.value = "current query";
  input.oninput?.();
  assert.equal(button.disabled, false);

  input.value = "\t";
  input.oninput?.();
  assert.equal(button.disabled, true);

  input.value = "current query";
  input.oninput?.();
  button.onclick?.({});
  await Promise.resolve();
  assert.deepEqual(calls.map(call => (call.args.request as { action: string }).action), ["open", "search"]);
  assert.equal((calls[1]?.args.request as { query: string }).query, "current query");
});

test("citation actions are named native buttons with exact callback targets", async () => {
  const root = new FakeElement("div");
  const citationTarget = "issue:alpha";
  const opened: string[] = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(): Promise<T> {
      return { ...openResponse(), payload: { ...openResponse().payload, citations: [citationTarget] } } as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, root as unknown as HTMLElement, target => opened.push(target));

  await panel.open(projectId);

  assert.equal(root.querySelectorAll("a").length, 0, "callback-only citation actions must not use placeholder anchors");
  const citationButtons = root.querySelectorAll<FakeElement>("button").filter(button => button.getAttribute("aria-label")?.startsWith("Open citation target "));
  assert.equal(citationButtons.length, 1);
  const citationButton = citationButtons[0]!;
  assert.equal(citationButton.tagName, "BUTTON");
  assert.equal(citationButton.textContent, citationTarget);
  assert.equal(citationButton.getAttribute("aria-label"), `Open citation target ${citationTarget}`);
  assert.equal(citationButton.getAttribute("href"), null);
  citationButton.onclick?.({});
  assert.deepEqual(opened, [citationTarget]);
});

test("citation action carries the citation-action class and the CSS contract holds", async () => {
  const root = new FakeElement("div");
  const longTarget = "01-Projects/s06a-qa/issues/recovery.md";
  const secondTarget = "issue:alpha";
  const opened: string[] = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(): Promise<T> {
      return { ...openResponse(), payload: { ...openResponse().payload, citations: [longTarget, secondTarget, longTarget] } } as T;
    },
  });
  const panel = new ProjectHubRecoveryPanel(client, root as unknown as HTMLElement, target => opened.push(target));

  await panel.open(projectId);

  const citationButtons = root.querySelectorAll<FakeElement>("button").filter(button => button.getAttribute("aria-label")?.startsWith("Open citation target "));
  assert.equal(citationButtons.length, 2, "duplicate citations must dedupe before rendering");
  for (const citationButton of citationButtons) {
    const className = citationButton.attributes.get("class") ?? "";
    assert.ok(className.includes("llmwiki-ask-mate-citation-action"),
      "native citation button must carry the citation-action class");
    assert.equal(citationButton.tagName, "BUTTON");
    assert.equal(citationButton.getAttribute("href"), null);
  }

  const longButton = citationButtons.find(button => button.textContent === longTarget)!;
  longButton.onclick?.({});
  assert.deepEqual(opened, [longTarget], "exact callback target must be preserved and not re-target by class");

  const css = await readStylesCss();
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*max-width\s*:\s*100%/,
    "citation-action CSS must keep max-width:100%");
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*box-sizing\s*:\s*border-box/,
    "citation-action CSS must use box-sizing:border-box");
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*overflow-wrap\s*:\s*anywhere/,
    "citation-action CSS must wrap with overflow-wrap:anywhere");
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*display\s*:\s*block/,
    "citation-action CSS must lay out as block");
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*white-space\s*:\s*normal/,
    "citation-action CSS must keep normal white-space so long paths wrap");
  assert.match(css, /\.llmwiki-ask-mate-citation-action\s*\{[^}]*text-align\s*:\s*left/,
    "citation-action CSS must left-align the label");
});

async function readStylesCss(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cssPath = (path as { resolve: (...args: string[]) => string }).resolve(process.cwd(), "styles.css");
  return fs.readFile(cssPath, "utf8");
}

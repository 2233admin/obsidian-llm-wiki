import test from "node:test";
import assert from "node:assert/strict";
import {
  AskMateInteractionModel,
  parseRestoredAskMateContext,
  restorableAskMateContext,
} from "../src/ask-mate/interaction-model";

test("restored Ask Mate state never persists selected text or Canvas selection IDs", () => {
  const state = restorableAskMateContext({
    projectId: "project/alpha",
    kind: "selection",
    path: "01-Projects/alpha/notes/context.md",
    selection: { text: "private selected text", from: 10, to: 31 },
    canvasNodeIds: ["private-node-id"],
  });
  assert.deepEqual(state, {
    projectId: "project/alpha",
    kind: "selection",
    path: "01-Projects/alpha/notes/context.md",
  });
  assert.deepEqual(parseRestoredAskMateContext(state), state);
  assert.equal(JSON.stringify(state).includes("private selected text"), false);
  assert.equal(JSON.stringify(state).includes("private-node-id"), false);
});

test("required ambiguity blocks write planning until a reviewed evidence-backed choice exists", () => {
  const model = new AskMateInteractionModel();
  model.setClarifications([{
    id: "root",
    prompt: "Which candidate is the root?",
    kind: "root",
    required: true,
    options: [
      { id: "root-a", label: "Alpha", evidenceRefs: ["note.md#Alpha"] },
      { id: "root-b", label: "Beta", evidenceRefs: ["note.md#Beta"] },
    ],
  }]);
  assert.equal(model.canPlan, false);
  assert.deepEqual(model.unresolvedRequiredClarifications.map(item => item.id), ["root"]);
  model.answerClarification("root", "root-b");
  assert.equal(model.canPlan, true);
  assert.deepEqual(model.answers, { root: "root-b" });
  assert.throws(() => model.answerClarification("root", "invented"), /unknown option/i);
});

test("model failure leaves deterministic manual capability explicit", () => {
  const model = new AskMateInteractionModel();
  assert.equal(model.capabilities.model, "degraded");
  assert.match(model.capabilities.messages.join(" "), /manual outline editing/i);
  model.selectIntent("make_map");
  assert.equal(model.intent, "make_map");
});

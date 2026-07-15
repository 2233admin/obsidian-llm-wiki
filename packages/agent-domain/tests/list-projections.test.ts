import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  AgentProfileStore,
  ProjectAgentBindingStore,
  ThreadStore,
  canonicalDigest,
} from "../src/index.js";
import { NOW } from "./helpers.js";

test("Store list projections return latest records in stable identity order with filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-domain-list-"));
  try {
    const options = { stateRoot: root, clock: () => NOW };
    const profiles = new AgentProfileStore(options);
    const bindings = new ProjectAgentBindingStore(options);
    const threads = new ThreadStore(options);

    for (const profileId of ["agent/zeta", "agent/alpha"] as const) {
      const created = await profiles.create({
        profileId,
        displayName: profileId.endsWith("alpha") ? "Alpha" : "Zeta",
        role: "Project Agent",
        constitution: { principles: ["Preserve evidence"], instructions: ["Use locked context"] },
        actor: "user/tester",
      });
      assert.equal(created.status, "committed");
    }
    const updated = await profiles.update("agent/alpha", 1, { role: "Lead Project Agent" }, "user/tester");
    assert.equal(updated.status, "committed");

    for (const input of [
      { projectId: "project/zeta" as const, profileId: "agent/zeta" as const, enabled: false },
      { projectId: "project/demo" as const, profileId: "agent/zeta" as const, enabled: true },
      { projectId: "project/demo" as const, profileId: "agent/alpha" as const, enabled: true },
    ]) {
      const created = await bindings.create({
        ...input,
        projectContextFingerprint: canonicalDigest({ projectId: input.projectId }),
        profileRevision: input.profileId === "agent/alpha" ? 2 : 1,
        role: "Project Agent",
        actor: "user/tester",
      });
      assert.equal(created.status, "committed");
    }

    for (const input of [
      { threadId: "thread/zeta" as const, projectId: "project/zeta" as const, bindingId: "binding/zeta/zeta" as const, profileId: "agent/zeta" as const },
      { threadId: "thread/demo-zeta" as const, projectId: "project/demo" as const, bindingId: "binding/demo/zeta" as const, profileId: "agent/zeta" as const },
      { threadId: "thread/demo-alpha" as const, projectId: "project/demo" as const, bindingId: "binding/demo/alpha" as const, profileId: "agent/alpha" as const },
    ]) {
      const created = await threads.create({
        ...input,
        bindingRevision: 1,
        profileRevision: input.profileId === "agent/alpha" ? 2 : 1,
        title: input.threadId,
        actor: "user/tester",
      });
      assert.equal(created.status, "committed");
    }
    const closed = await threads.transition("thread/demo-zeta", 1, "closed", "user/tester");
    assert.equal(closed.status, "committed");

    const profileList = await profiles.list();
    assert.deepEqual(profileList.map((record) => record.profileId), ["agent/alpha", "agent/zeta"]);
    assert.equal(profileList[0]!.revision, 2);
    assert.deepEqual((await profiles.list({ profileIds: ["agent/zeta"] })).map((record) => record.profileId), ["agent/zeta"]);

    const demoBindings = await bindings.list({ projectId: "project/demo", enabled: true });
    assert.deepEqual(demoBindings.map((record) => record.bindingId), ["binding/demo/alpha", "binding/demo/zeta"]);
    assert.deepEqual((await bindings.list({ profileId: "agent/zeta", enabled: false })).map((record) => record.bindingId), ["binding/zeta/zeta"]);

    const demoThreads = await threads.list({ projectId: "project/demo" });
    assert.deepEqual(demoThreads.map((record) => record.threadId), ["thread/demo-alpha", "thread/demo-zeta"]);
    assert.deepEqual((await threads.list({ projectId: "project/demo", lifecycle: "closed" })).map((record) => record.threadId), ["thread/demo-zeta"]);
    assert.deepEqual((await threads.list({ bindingId: "binding/demo/alpha" })).map((record) => record.threadId), ["thread/demo-alpha"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

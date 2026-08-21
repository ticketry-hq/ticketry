import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateFinalizedDefaults } from "./reviewed_defaults_validator.mjs";

const artifact = JSON.parse(
  await readFile(new URL("./reviewed_defaults.json", import.meta.url), "utf8"),
);

function fixture(mutate) {
  const value = structuredClone(artifact);
  mutate(value);
  return value;
}

test("accepts the committed finalized-defaults artifact", () => {
  assert.deepEqual(validateFinalizedDefaults(artifact), []);
});

test("accepts omitted launch-policy fields with the legacy defaults", () => {
  const legacyShape = fixture((value) => {
    for (const state of value.states) delete state.autoStart;
    for (const workflow of Object.values(value.workflows)) {
      for (const edge of workflow.transitions) edge.splice(2);
    }
  });

  assert.deepEqual(validateFinalizedDefaults(legacyShape), []);
});

test("committed artifact declares itself authoritative and removes provenance", () => {
  assert.equal(
    artifact.sourceOfTruth.artifact,
    "backend/worktracker/reviewed_defaults.json",
  );
  assert.ok(artifact.sourceOfTruth.consumers.length > 0);
  assert.equal(Object.hasOwn(artifact, "source"), false);
  assert.equal(Object.hasOwn(artifact, "agentsMd"), false);
  assert.deepEqual(
    Object.fromEntries(artifact.states.map((state) => [state.name, state.autoStart])),
    {
      Ideas: true,
      Grill: false,
      Spec: true,
      Tickets: true,
      Implement: false,
      Review: false,
      Done: false,
      Cancelled: false,
    },
  );
  assert.equal(
    artifact.workflows.Story.transitions.find(
      ([source, target]) => source === "Ideas" && target === "Implement",
    )[2].agentAllowed,
    true,
  );
  assert.equal(
    artifact.workflows.Story.transitions.find(
      ([source, target]) => source === "Tickets" && target === "Implement",
    )[2].agentAllowed,
    false,
  );
  assert.equal(
    artifact.workflows.Story.transitions.find(
      ([source, target]) => source === "Implement" && target === "Grill",
    )[2].agentAllowed,
    true,
  );
  assert.ok(
    Object.values(artifact.workflows).every((workflow) =>
      workflow.transitions.every(
        ([source, target, policy]) =>
          (source === "Tickets" && target === "Implement") ||
          policy?.agentAllowed === true,
      ),
    ),
  );
  assert.deepEqual(artifact.requiredSkills, {
    Ideas: [],
    Grill: ["grill-with-docs"],
    Spec: ["to-spec"],
    Tickets: ["to-tickets"],
    Implement: [],
    Review: [],
    Done: [],
    Cancelled: [],
  });
  assert.deepEqual(artifact.entrySkills, {
    Grill: "grill-with-docs",
    Spec: "to-spec",
    Tickets: "to-tickets",
  });
});

test("derives state and issue-type expectations from the artifact", () => {
  const renamed = fixture((value) => {
    const state = value.states[0];
    const oldStateName = state.name;
    const newStateName = "Inbox";
    state.name = newStateName;
    for (const prompts of Object.values(value.prompts)) {
      prompts[newStateName] = prompts[oldStateName];
      delete prompts[oldStateName];
    }
    value.requiredSkills[newStateName] = value.requiredSkills[oldStateName];
    delete value.requiredSkills[oldStateName];
    if (Object.hasOwn(value.entrySkills, oldStateName)) {
      value.entrySkills[newStateName] = value.entrySkills[oldStateName];
      delete value.entrySkills[oldStateName];
    }
    for (const workflow of Object.values(value.workflows)) {
      if (workflow.start === oldStateName) workflow.start = newStateName;
      workflow.states = workflow.states.map((name) =>
        name === oldStateName ? newStateName : name
      );
      workflow.transitions = workflow.transitions.map(([source, target]) => [
        source === oldStateName ? newStateName : source,
        target === oldStateName ? newStateName : target,
      ]);
    }

    const oldTypeName = value.issueTypes[1];
    const newTypeName = "Investigation";
    value.issueTypes[1] = newTypeName;
    value.prompts[newTypeName] = value.prompts[oldTypeName];
    delete value.prompts[oldTypeName];
    value.workflows[newTypeName] = value.workflows[oldTypeName];
    delete value.workflows[oldTypeName];
  });

  assert.deepEqual(validateFinalizedDefaults(renamed), []);
});

const rejectionFixtures = [
  {
    name: "bad schema version",
    mutate: (value) => {
      value.schemaVersion = 1;
    },
    message: /Schema version '1'/,
  },
  {
    name: "unknown top-level key",
    mutate: (value) => {
      value.unexpected = true;
    },
    message: /Unknown top-level key 'unexpected'/,
  },
  {
    name: "malformed timestamp",
    mutate: (value) => {
      value.finalizedAt = "yesterday";
    },
    message: /timestamp 'yesterday' is malformed/,
  },
  {
    name: "empty guidance",
    mutate: (value) => {
      value.guidance = "   ";
    },
    message: /Guidance is empty/,
  },
  {
    name: "invalid state group",
    mutate: (value) => {
      value.states[0].group = "triage";
    },
    message: /State 'Ideas' has invalid board group 'triage'/,
  },
  {
    name: "unrecognised stage auto-start value",
    mutate: (value) => {
      value.states[0].autoStart = "sometimes";
    },
    message: /Stage 'Ideas'.*unrecognised autoStart value 'sometimes'/,
  },
  {
    name: "auto-start without a prompt",
    mutate: (value) => {
      value.states[0].autoStart = true;
      delete value.prompts.Story.Ideas;
    },
    message: /Stage 'Ideas' declares autoStart.*Story.*no prompt to launch with/,
  },
  {
    name: "missing state group and color",
    mutate: (value) => {
      delete value.states[0].group;
      delete value.states[0].color;
    },
    message: [
      /State 'Ideas' is missing its board group/,
      /State 'Ideas' is missing its color/,
    ],
  },
  {
    name: "duplicate issue type",
    mutate: (value) => {
      value.issueTypes = ["Story", "PathFind", "Story"];
    },
    message: /Issue type 'Story' is declared more than once/,
  },
  {
    name: "required skill absent from pinned snapshot",
    mutate: (value) => {
      value.requiredSkills.Grill.push("not-in-the-pinned-snapshot");
    },
    message: /Required skill 'not-in-the-pinned-snapshot'.*not provided by the pinned snapshot/,
  },
  {
    name: "entry skill absent from pinned snapshot",
    mutate: (value) => {
      value.requiredSkills.Spec = ["not-in-the-pinned-snapshot"];
      value.entrySkills.Spec = "not-in-the-pinned-snapshot";
    },
    message: /Entry skill 'not-in-the-pinned-snapshot'.*not provided by the pinned snapshot/,
  },
  {
    name: "entry skill absent from required skills",
    mutate: (value) => {
      value.entrySkills.Spec = "to-tickets";
    },
    message: /Entry skill 'to-tickets'.*must also be declared in requiredSkills/,
  },
  {
    name: "entry skill for unknown state",
    mutate: (value) => {
      value.entrySkills.Unknown = "to-spec";
    },
    message: /Entry-skills map declares unknown state 'Unknown'/,
  },
  {
    name: "missing prompt cell",
    mutate: (value) => {
      delete value.prompts.Story.Grill;
    },
    message: /Issue type 'Story' is missing the prompt for state 'Grill'/,
  },
  {
    name: "empty prompt cell",
    mutate: (value) => {
      value.prompts.PathFind.Review = "\n";
    },
    message: /Issue type 'PathFind' has an empty prompt for state 'Review'/,
  },
  {
    name: "start state outside vocabulary",
    mutate: (value) => {
      value.workflows.Story.start = "Inbox";
    },
    message: /Issue type 'Story'.*start state 'Inbox'.*outside the canonical state vocabulary/,
  },
  {
    name: "start state outside type state set",
    mutate: (value) => {
      value.workflows.PathFind.start = "Grill";
    },
    message: /Issue type 'PathFind'.*start state 'Grill'.*outside its own state set/,
  },
  {
    name: "edge endpoint outside vocabulary",
    mutate: (value) => {
      value.workflows.PathFind.transitions.push(["Spec", "Inbox"]);
    },
    message: /Issue type 'PathFind' edge 'Spec -> Inbox'.*outside the canonical state vocabulary/,
  },
  {
    name: "unrecognised edge agent-permission value",
    mutate: (value) => {
      value.workflows.Story.transitions.find(
        ([source, target]) => source === "Grill" && target === "Spec",
      )[2].agentAllowed = "sometimes";
    },
    message: /edge 'Grill -> Spec'.*unrecognised agentAllowed value 'sometimes'/,
  },
  {
    name: "edge endpoint outside type state set",
    mutate: (value) => {
      value.workflows.PathFind.transitions.push(["Spec", "Grill"]);
    },
    message: /Issue type 'PathFind' edge 'Spec -> Grill'.*outside its own state set/,
  },
  {
    name: "duplicate edge",
    mutate: (value) => {
      value.workflows.Story.transitions.push(["Grill", "Spec"]);
    },
    message: /Issue type 'Story' has duplicate edge 'Grill -> Spec'/,
  },
  {
    name: "self-edge",
    mutate: (value) => {
      value.workflows.PathFind.transitions.push(["Spec", "Spec"]);
    },
    message: /Issue type 'PathFind' has self-edge 'Spec -> Spec'/,
  },
  {
    name: "outgoing edge from terminal state",
    mutate: (value) => {
      value.workflows.PathFind.transitions.push(["Done", "Cancelled"]);
    },
    message: /Issue type 'PathFind'.*outgoing edge 'Done -> Cancelled'.*terminal state 'Done'/,
  },
  {
    name: "unreachable state",
    mutate: (value) => {
      value.workflows.PathFind.states.push("Grill");
    },
    message: /Issue type 'PathFind' has unreachable state 'Grill'/,
  },
];

for (const { name, mutate, message } of rejectionFixtures) {
  test(`rejects ${name}`, () => {
    const errors = validateFinalizedDefaults(fixture(mutate));
    for (const expected of Array.isArray(message) ? message : [message]) {
      assert.ok(errors.some((error) => expected.test(error)), errors.join("\n"));
    }
  });
}

test("accumulates independent failures in one pass", () => {
  const errors = validateFinalizedDefaults(
    fixture((value) => {
      value.schemaVersion = 1;
      value.finalizedAt = "never";
      value.guidance = "";
      delete value.prompts.Story.Grill;
      value.workflows.PathFind.transitions.push(["Done", "Done"]);
    }),
  );

  assert.ok(errors.length >= 5, errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("Schema version '1'")));
  assert.ok(errors.some((error) => error.includes("timestamp 'never'")));
  assert.ok(errors.some((error) => error.includes("Guidance is empty")));
  assert.ok(
    errors.some((error) =>
      error.includes("Issue type 'Story' is missing the prompt for state 'Grill'"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("Issue type 'PathFind' has self-edge 'Done -> Done'"),
    ),
  );
});

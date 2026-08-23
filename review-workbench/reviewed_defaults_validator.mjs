import { readFileSync } from "node:fs";


const SCHEMA_VERSION = 2;
const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "finalizedAt",
  "sourceOfTruth",
  "guidance",
  "states",
  "issueTypes",
  "requiredSkills",
  "prompts",
  "workflows",
]);
const VALID_GROUPS = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);
const TERMINAL_GROUPS = new Set(["completed", "cancelled"]);
const PINNED_SKILL_LOCK = JSON.parse(
  readFileSync(
    new URL(
      "../studio/src-tauri/resources/launch/skills.lock.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const PINNED_SKILL_IDS = new Set(PINNED_SKILL_LOCK.selected_packages);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describesTimestamp(value) {
  if (typeof value !== "string") return false;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!isoTimestamp.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function edgeName(edge, index) {
  if (Array.isArray(edge) && edge.length >= 2) {
    return `'${String(edge[0])} -> ${String(edge[1])}'`;
  }
  return `at index ${index}`;
}

function validateStateVocabulary(states, errors) {
  if (!Array.isArray(states)) {
    errors.push("State vocabulary is missing; offending state set is not an array.");
    return;
  }

  const seenNames = new Set();
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const stateName =
      isObject(state) && typeof state.name === "string" && state.name.trim()
        ? state.name
        : `<state at index ${index}>`;
    if (!isObject(state)) {
      errors.push(`State '${stateName}' must include its name, group, and color.`);
      continue;
    }
    if (typeof state.name !== "string" || !state.name.trim()) {
      errors.push(`State '${stateName}' is missing its name.`);
    } else if (seenNames.has(state.name)) {
      errors.push(`State '${state.name}' is declared more than once.`);
    } else {
      seenNames.add(state.name);
    }
    if (typeof state.group !== "string" || !state.group.trim()) {
      errors.push(`State '${stateName}' is missing its board group.`);
    } else if (!VALID_GROUPS.has(state.group)) {
      errors.push(
        `State '${stateName}' has invalid board group '${String(state.group)}'.`,
      );
    }
    if (typeof state.color !== "string" || !state.color.trim()) {
      errors.push(`State '${stateName}' is missing its color.`);
    }
    if (
      Object.hasOwn(state, "autoStart") &&
      typeof state.autoStart !== "boolean"
    ) {
      errors.push(
        `Stage '${stateName}' has unrecognised autoStart value '${String(state.autoStart)}'; expected true or false.`,
      );
    }
  }
}

function validateIssueTypes(issueTypes, errors) {
  if (!Array.isArray(issueTypes) || issueTypes.length === 0) {
    errors.push("Issue-type set is offending; expected a non-empty array.");
    return;
  }
  const seen = new Set();
  for (const issueType of issueTypes) {
    if (typeof issueType !== "string" || !issueType.trim()) {
      errors.push(`Issue type '${String(issueType)}' must be a non-empty string.`);
    } else if (seen.has(issueType)) {
      errors.push(`Issue type '${issueType}' is declared more than once.`);
    } else {
      seen.add(issueType);
    }
  }
}

function validatePrompts(prompts, issueTypes, states, errors) {
  for (const issueType of issueTypes) {
    const typePrompts = isObject(prompts) ? prompts[issueType] : undefined;
    for (const state of states) {
      if (!isObject(typePrompts) || !(state in typePrompts)) {
        errors.push(
          `Issue type '${issueType}' is missing the prompt for state '${state}'.`,
        );
      } else if (
        typeof typePrompts[state] !== "string" ||
        !typePrompts[state].trim()
      ) {
        errors.push(
          `Issue type '${issueType}' has an empty prompt for state '${state}'.`,
        );
      }
    }
  }
}

function validateAutoStartPrompts(states, prompts, issueTypes, errors) {
  if (!Array.isArray(states)) return;
  for (const state of states) {
    if (!isObject(state) || state.autoStart !== true) continue;
    for (const issueType of issueTypes) {
      const typePrompts = isObject(prompts) ? prompts[issueType] : undefined;
      const prompt = isObject(typePrompts) ? typePrompts[state.name] : undefined;
      if (typeof prompt !== "string" || !prompt.trim()) {
        errors.push(
          `Stage '${String(state.name)}' declares autoStart, but issue type '${issueType}' has no prompt to launch with.`,
        );
      }
    }
  }
}

function validateRequiredSkills(requiredSkills, states, errors) {
  if (!isObject(requiredSkills)) {
    errors.push("Required-skills map is missing or is not an object.");
    return;
  }
  const vocabulary = new Set(states);
  for (const state of states) {
    const identifiers = requiredSkills[state];
    if (!Array.isArray(identifiers)) {
      errors.push(
        `State '${state}' must declare requiredSkills as an ordered list.`,
      );
      continue;
    }
    const seen = new Set();
    for (const identifier of identifiers) {
      if (typeof identifier !== "string" || !identifier.trim()) {
        errors.push(
          `State '${state}' has malformed requiredSkills identifier '${String(identifier)}'.`,
        );
        continue;
      }
      if (!PINNED_SKILL_IDS.has(identifier)) {
        errors.push(
          `Required skill '${identifier}' for state '${state}' is not provided by the pinned snapshot.`,
        );
      }
      if (seen.has(identifier)) {
        errors.push(
          `Required skill '${identifier}' for state '${state}' is declared more than once.`,
        );
      }
      seen.add(identifier);
    }
  }
  for (const state of Object.keys(requiredSkills)) {
    if (!vocabulary.has(state)) {
      errors.push(
        `Required-skills map declares unknown state '${state}'.`,
      );
    }
  }
}

function validateWorkflow(issueType, workflow, vocabulary, terminalStates, errors) {
  const typeStates = Array.isArray(workflow?.states)
    ? workflow.states.filter((state) => typeof state === "string")
    : [];
  const typeStateSet = new Set(typeStates);
  const start = workflow?.start;

  if (!vocabulary.has(start)) {
    errors.push(
      `Issue type '${issueType}' has start state '${String(start)}' outside the canonical state vocabulary.`,
    );
  }
  if (!typeStateSet.has(start)) {
    errors.push(
      `Issue type '${issueType}' has start state '${String(start)}' outside its own state set [${typeStates.join(", ")}].`,
    );
  }

  if (!Array.isArray(workflow?.states)) {
    errors.push(`Issue type '${issueType}' has an offending state set that is not an array.`);
  }

  const transitions = Array.isArray(workflow?.transitions)
    ? workflow.transitions
    : [];
  if (!Array.isArray(workflow?.transitions)) {
    errors.push(`Issue type '${issueType}' has an offending transition edge list.`);
  }

  const seenEdges = new Set();
  const forward = new Map(typeStates.map((state) => [state, []]));
  const reverse = new Map(typeStates.map((state) => [state, []]));
  for (let index = 0; index < transitions.length; index += 1) {
    const edge = transitions[index];
    const label = edgeName(edge, index);
    if (!Array.isArray(edge) || edge.length < 2 || edge.length > 3) {
      errors.push(`Issue type '${issueType}' has malformed edge ${label}.`);
      continue;
    }
    const [source, target, metadata = {}] = edge;
    if (!isObject(metadata)) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has malformed permission metadata.`,
      );
      continue;
    }
    for (const metadataKey of Object.keys(metadata)) {
      if (metadataKey !== "agentAllowed") {
        errors.push(
          `Issue type '${issueType}' edge ${label} has unrecognised metadata field '${metadataKey}'.`,
        );
      }
    }
    if (
      Object.hasOwn(metadata, "agentAllowed") &&
      typeof metadata.agentAllowed !== "boolean"
    ) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has unrecognised agentAllowed value '${String(metadata.agentAllowed)}'; expected true or false.`,
      );
    }
    const key = JSON.stringify([source, target]);

    if (!vocabulary.has(source)) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has source state '${String(source)}' outside the canonical state vocabulary.`,
      );
    }
    if (!vocabulary.has(target)) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has target state '${String(target)}' outside the canonical state vocabulary.`,
      );
    }
    if (!typeStateSet.has(source)) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has source state '${String(source)}' outside its own state set.`,
      );
    }
    if (!typeStateSet.has(target)) {
      errors.push(
        `Issue type '${issueType}' edge ${label} has target state '${String(target)}' outside its own state set.`,
      );
    }
    if (seenEdges.has(key)) {
      errors.push(`Issue type '${issueType}' has duplicate edge ${label}.`);
    }
    seenEdges.add(key);
    if (source === target) {
      errors.push(`Issue type '${issueType}' has self-edge ${label}.`);
    }
    if (terminalStates.has(source)) {
      errors.push(
        `Issue type '${issueType}' has outgoing edge ${label} from terminal state '${String(source)}'.`,
      );
    }
    if (typeStateSet.has(source) && typeStateSet.has(target)) {
      forward.get(source)?.push(target);
      reverse.get(target)?.push(source);
    }
  }

  function visit(adjacency) {
    const visited = new Set();
    if (!typeStateSet.has(start)) return visited;
    const pending = [start];
    while (pending.length) {
      const state = pending.shift();
      if (visited.has(state)) continue;
      visited.add(state);
      pending.push(...(adjacency.get(state) ?? []));
    }
    return visited;
  }

  const reachable = visit(forward);
  // A type may declare a pre-start intake state (Implementation's Ready state)
  // that flows into its reviewed creation start. It still participates in the
  // connected start-state graph, while an isolated state participates in
  // neither traversal.
  const reachesStart = visit(reverse);
  for (const state of typeStates) {
    if (!reachable.has(state) && !reachesStart.has(state)) {
      errors.push(
        `Issue type '${issueType}' has unreachable state '${state}' from start state '${String(start)}'.`,
      );
    }
  }
}

export function validateFinalizedDefaults(value) {
  const errors = [];
  if (!isObject(value)) {
    return ["Finalized defaults must be an object; offending artifact has no top-level keys."];
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `Schema version '${String(value.schemaVersion)}' is offending; expected '${SCHEMA_VERSION}'.`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unknown top-level key '${key}' is offending.`);
    }
  }
  if (!describesTimestamp(value.finalizedAt)) {
    errors.push(
      `Finalization timestamp '${String(value.finalizedAt)}' is malformed.`,
    );
  }
  if (typeof value.guidance !== "string" || !value.guidance.trim()) {
    errors.push("Guidance is empty; offending guidance must be a non-empty string.");
  }

  validateStateVocabulary(value.states, errors);
  validateIssueTypes(value.issueTypes, errors);
  const canonicalStates = Array.isArray(value.states)
    ? value.states
        .filter(
          (state) =>
            isObject(state) &&
            typeof state.name === "string" &&
            state.name.trim(),
        )
        .map(({ name }) => name)
    : [];
  const canonicalIssueTypes = Array.isArray(value.issueTypes)
    ? value.issueTypes.filter(
        (issueType) =>
          typeof issueType === "string" && issueType.trim(),
      )
    : [];
  validatePrompts(
    value.prompts,
    canonicalIssueTypes,
    canonicalStates,
    errors,
  );
  validateAutoStartPrompts(
    value.states,
    value.prompts,
    canonicalIssueTypes,
    errors,
  );
  validateRequiredSkills(value.requiredSkills, canonicalStates, errors);

  const vocabulary = new Set(canonicalStates);
  const terminalStates = new Set(
    Array.isArray(value.states)
      ? value.states
          .filter(
            (state) =>
              isObject(state) &&
              typeof state.name === "string" &&
              TERMINAL_GROUPS.has(state.group),
          )
          .map(({ name }) => name)
      : [],
  );
  for (const issueType of canonicalIssueTypes) {
    const workflow = isObject(value.workflows)
      ? value.workflows[issueType]
      : undefined;
    validateWorkflow(issueType, workflow, vocabulary, terminalStates, errors);
  }

  return errors;
}

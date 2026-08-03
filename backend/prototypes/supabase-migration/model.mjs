// PROTOTYPE — throw this away after the Supabase boundary is decided.
//
// Question: can Supabase become Ticketry's shared durable data plane without
// also taking ownership of machine-local execution (tmux, worktrees, and the
// filesystem)? This pure reducer makes the proposed boundary and its failure
// modes visible; it performs no I/O and depends on no Supabase project.

const NEXT_STATE = {
  Grill: "Spec",
  Spec: "Tickets",
  Tickets: "Implement",
  Implement: "Review",
  Review: "Done",
};

function clone(state) {
  return structuredClone(state);
}

function deliverCloudItem(state) {
  state.studio.item = { ...state.supabase.item };
  state.studio.cursor = state.supabase.item.revision;
  state.studio.pendingChanges = 0;
}

function commitCloudMove(state, actor, destination) {
  state.supabase.item.state = destination;
  state.supabase.item.revision += 1;
  state.supabase.item.updatedBy = actor;
  state.supabase.events.push({
    revision: state.supabase.item.revision,
    state: destination,
    actor,
  });
  if (state.network.online && state.studio.realtime === "subscribed") {
    deliverCloudItem(state);
  } else {
    state.studio.pendingChanges += 1;
  }
}

export function initialState() {
  return {
    network: { online: true },
    studio: {
      auth: "signed in as you@example.test",
      realtime: "subscribed",
      cursor: 12,
      pendingChanges: 0,
      item: {
        key: "TICK-42",
        state: "Tickets",
        revision: 12,
        updatedBy: "you@example.test",
      },
    },
    supabase: {
      item: {
        key: "TICK-42",
        state: "Tickets",
        revision: 12,
        updatedBy: "you@example.test",
      },
      events: [],
      runLedger: [],
    },
    sidecar: {
      api: "Django policy gateway",
      tmuxSessions: [],
      worktree: "local / ticketry-TICK-42",
    },
    lastOutcome:
      "Ready. Shared work data is in Supabase; machine-local execution stays in the sidecar.",
  };
}

export function reduce(input, action) {
  if (action.type === "RESET") return initialState();
  const state = clone(input);

  switch (action.type) {
    case "TOGGLE_NETWORK": {
      state.network.online = !state.network.online;
      state.studio.realtime = state.network.online ? "reconnecting" : "offline";
      state.lastOutcome = state.network.online
        ? "Network restored. Press [s] to authenticate, pull the authoritative snapshot, and resubscribe."
        : "Network lost. Existing local terminals keep running; shared work-item mutations pause.";
      return state;
    }

    case "SYNC": {
      if (!state.network.online) {
        state.lastOutcome = "Sync blocked: Supabase is unreachable.";
        return state;
      }
      state.studio.realtime = "subscribed";
      deliverCloudItem(state);
      state.lastOutcome =
        "Synced from Supabase and resumed Realtime from the latest durable revision.";
      return state;
    }

    case "LOCAL_MOVE": {
      if (!state.network.online) {
        state.lastOutcome =
          "Move blocked offline: this spike chooses one cloud authority instead of inventing conflict resolution.";
        return state;
      }
      const destination = NEXT_STATE[state.supabase.item.state];
      if (!destination) {
        state.lastOutcome = `Django rejected the move: ${state.supabase.item.state} has no next transition.`;
        return state;
      }
      commitCloudMove(state, "you@example.test", destination);
      // The HTTP response also repairs this client if its Realtime subscription
      // happens to be reconnecting.
      deliverCloudItem(state);
      state.lastOutcome =
        `Django validated ${input.supabase.item.state} → ${destination}; Postgres committed it atomically; Realtime notified peers.`;
      return state;
    }

    case "REMOTE_MOVE": {
      const destination = NEXT_STATE[state.supabase.item.state];
      if (!destination) {
        state.lastOutcome = "The collaborator has no legal next transition to take.";
        return state;
      }
      commitCloudMove(state, "collaborator@example.test", destination);
      state.lastOutcome = state.network.online
        ? `A collaborator moved the item to ${destination}; Supabase Realtime updated this Studio projection.`
        : `A collaborator moved the cloud row to ${destination}; this offline Studio still shows ${state.studio.item.state}.`;
      return state;
    }

    case "DIRECT_MOVE": {
      if (!state.network.online) {
        state.lastOutcome = "Direct browser write blocked: Supabase is unreachable.";
        return state;
      }
      if (state.supabase.item.state === "Done") {
        state.lastOutcome = "The row is already Done. Reset the prototype to try the bypass again.";
        return state;
      }
      const from = state.supabase.item.state;
      commitCloudMove(state, "browser-direct@example.test", "Done");
      state.lastOutcome =
        `WARNING: a direct table update skipped ${from} → Done. RLS can enforce membership, but Ticketry still needs Django or a Postgres RPC/trigger to enforce workflow policy.`;
      return state;
    }

    case "LAUNCH_AGENT": {
      if (!state.network.online) {
        state.lastOutcome =
          "New launch blocked offline: the shared run ledger cannot be reserved safely. Existing tmux sessions are unaffected.";
        return state;
      }
      const ordinal = state.supabase.runLedger.length + 1;
      const runId = `run-${ordinal}`;
      state.supabase.runLedger.push({
        id: runId,
        workItem: state.supabase.item.key,
        status: "running",
        host: "this-mac",
      });
      state.sidecar.tmuxSessions.push({ id: runId, status: "running" });
      state.lastOutcome =
        `Reserved ${runId} in the shared ledger, then the local sidecar created its tmux session. Terminal bytes never pass through Supabase.`;
      return state;
    }

    default:
      return state;
  }
}

import { useEffect, useRef, useState } from "react";
import type {
  SkillAvailabilityCheck,
  SkillAvailabilityRequest,
  SkillAvailabilityResult,
} from "./types";

interface SkillAvailabilityInput {
  check?: SkillAvailabilityCheck;
  moduleId?: string | null;
  agent: string;
  profile: string;
  names: string[];
  /** Changes when the inherited global launch default changes. */
  launchDefaultKey?: string;
}

export interface SkillAvailabilityView {
  /** The result for exactly the current request, or null while none is known. */
  result: SkillAvailabilityResult | null;
  checking: boolean;
  recheck: () => void;
}

function unchecked(
  names: string[],
  message: string,
): SkillAvailabilityResult {
  return {
    status: "unchecked",
    code: null,
    message,
    provider: null,
    searched_roots: [],
    skills: names.map((requested) => ({
      requested,
      status: "unchecked",
      installed_name: null,
      location: null,
      reason: message,
    })),
  };
}

/**
 * Observe stage-skill availability for the stage's current provider, module
 * and names. A result is shown only for the request that produced it, so a
 * slower response for an earlier provider or list never replaces a newer one.
 * Observing is read-only: it never writes the binding.
 */
export function useSkillAvailability({
  check,
  moduleId,
  agent,
  profile,
  names,
  launchDefaultKey = "",
}: SkillAvailabilityInput): SkillAvailabilityView {
  const request: SkillAvailabilityRequest | null = moduleId
    ? { moduleId, agent: agent || null, profile: profile || null, names }
    : null;
  const requestKey = JSON.stringify([request, launchDefaultKey]);
  const [observed, setObserved] = useState<{
    key: string;
    result: SkillAvailabilityResult;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const sequence = ++latest.current;
    if (!check || names.length === 0) {
      setChecking(false);
      return;
    }
    if (!request) {
      setObserved({
        key: requestKey,
        result: unchecked(names, "Select a module to check skill availability."),
      });
      setChecking(false);
      return;
    }
    setChecking(true);
    check(request).then(
      (result) => {
        if (sequence !== latest.current) return;
        setObserved({ key: requestKey, result });
        setChecking(false);
      },
      (error: unknown) => {
        if (sequence !== latest.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        setObserved({
          key: requestKey,
          result: unchecked(names, `Skill availability could not be checked: ${detail}`),
        });
        setChecking(false);
      },
    );
    // `requestKey` covers every field of `request` and `names`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, requestKey, nonce]);

  return {
    result: observed?.key === requestKey && names.length > 0 ? observed.result : null,
    checking,
    recheck: () => setNonce((value) => value + 1),
  };
}

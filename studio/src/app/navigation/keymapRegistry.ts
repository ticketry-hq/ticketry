import {
  DEFAULT_BINDINGS,
  KEYMAP_CONTEXT_PRECEDENCE,
  type BindingOverride,
  type EffectiveBinding,
  type BindingDefinition,
  type KeyChord,
  type KeymapContext,
} from "./keymapBindings";
import { studioRuntime, type StudioPlatform } from "../../runtime";

const DEFAULT_BINDINGS_IN_CONTEXT_PRECEDENCE =
  KEYMAP_CONTEXT_PRECEDENCE.flatMap((context) =>
    DEFAULT_BINDINGS.filter((binding) => binding.context === context),
  );
const CONFIGURABLE_BINDINGS_IN_CONTEXT_PRECEDENCE =
  DEFAULT_BINDINGS_IN_CONTEXT_PRECEDENCE.filter(
    (binding) => binding.configurable !== false,
  );

export {
  KEYMAP_CONTEXT_PRECEDENCE,
  MODAL_ACTIONS,
  type BindingOverride,
  type EffectiveBinding,
  type KeyChord,
  type KeymapContext,
} from "./keymapBindings";

function matches(
  event: KeyboardEvent,
  candidate: KeyChord,
  allowExtraModifiers: boolean,
): boolean {
  return matchesChord(
    {
      key: event.key,
      alt: event.altKey,
      control: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    },
    candidate,
    allowExtraModifiers,
  );
}

function matchesChord(
  input: KeyChord,
  candidate: KeyChord,
  allowExtraModifiers: boolean,
): boolean {
  if (input.key !== candidate.key) return false;
  if (allowExtraModifiers) {
    return (
      (!candidate.alt || input.alt) &&
      (!candidate.control || input.control) &&
      (!candidate.meta || input.meta) &&
      (!candidate.shift || input.shift)
    );
  }
  return (
    input.alt === candidate.alt &&
    input.control === candidate.control &&
    input.meta === candidate.meta &&
    input.shift === candidate.shift
  );
}

class KeymapRegistry {
  private overrides = new Map<string, KeyChord>();
  private listeners = new Set<() => void>();
  private revision = 0;

  resolve(
    context: KeymapContext,
    event: KeyboardEvent,
    actionIds?: ReadonlySet<string>,
  ): string | null {
    const platform = studioRuntime().platform;
    for (const binding of DEFAULT_BINDINGS_BY_CONTEXT.get(context) ?? []) {
      if (
        !availableOnPlatform(binding, platform) ||
        actionIds &&
        !actionIds.has(binding.actionId)
      ) {
        continue;
      }
      const effectiveChord =
        this.overrides.get(bindingKey(binding.context, binding.actionId)) ??
        binding.chord;
      const hasOverride = effectiveChord !== binding.chord;
      const candidates = [
        effectiveChord,
        ...(hasOverride ? [] : binding.defaultAliases ?? []),
        ...(binding.fixedAliases ?? []),
      ];
      if (
        candidates.some((candidate) =>
          matches(event, candidate, binding.allowExtraModifiers ?? false),
        )
      ) {
        return binding.actionId;
      }
    }
    return null;
  }

  getEffectiveBindings(): EffectiveBinding[] {
    const platform = studioRuntime().platform;
    return DEFAULT_BINDINGS_IN_CONTEXT_PRECEDENCE.filter((binding) =>
      availableOnPlatform(binding, platform)
    ).map(
      ({ context, actionId, chord: bindingChord }) => ({
        context,
        actionId,
        chord: {
          ...(this.overrides.get(bindingKey(context, actionId)) ?? bindingChord),
        },
      }),
    );
  }

  getConfigurableBindings(): EffectiveBinding[] {
    return CONFIGURABLE_BINDINGS_IN_CONTEXT_PRECEDENCE.map(
      ({ context, actionId, chord: bindingChord }) => ({
        context,
        actionId,
        chord: {
          ...(this.overrides.get(bindingKey(context, actionId)) ?? bindingChord),
        },
      }),
    );
  }

  getDefaultBindings(): EffectiveBinding[] {
    return CONFIGURABLE_BINDINGS_IN_CONTEXT_PRECEDENCE.map(
      ({ context, actionId, chord: bindingChord }) => ({
        context,
        actionId,
        chord: { ...bindingChord },
      }),
    );
  }

  findMatchingBinding(
    input: KeyChord,
    predicate: (binding: EffectiveBinding) => boolean,
  ): EffectiveBinding | null {
    for (const binding of CONFIGURABLE_BINDINGS_IN_CONTEXT_PRECEDENCE) {
      const effectiveChord =
        this.overrides.get(bindingKey(binding.context, binding.actionId)) ??
        binding.chord;
      const effectiveBinding = {
        context: binding.context,
        actionId: binding.actionId,
        chord: { ...effectiveChord },
      };
      if (!predicate(effectiveBinding)) continue;
      const hasOverride = effectiveChord !== binding.chord;
      const candidates = [
        effectiveChord,
        ...(hasOverride ? [] : binding.defaultAliases ?? []),
        ...(binding.fixedAliases ?? []),
      ];
      if (
        candidates.some((candidate) =>
          matchesChord(input, candidate, binding.allowExtraModifiers ?? false),
        )
      ) {
        return effectiveBinding;
      }
    }
    return null;
  }

  getEffectiveBinding(
    context: KeymapContext,
    actionId: string,
  ): EffectiveBinding | null {
    const key = bindingKey(context, actionId);
    const binding = DEFAULT_BINDINGS_BY_KEY.get(key);
    if (!binding || !availableOnPlatform(binding, studioRuntime().platform)) {
      return null;
    }
    return {
      context,
      actionId,
      chord: {
        ...(this.overrides.get(key) ?? binding.chord),
      },
    };
  }

  getOverrides(): BindingOverride[] {
    return CONFIGURABLE_BINDINGS_IN_CONTEXT_PRECEDENCE.flatMap(
      ({ context, actionId }) => {
        const override = this.overrides.get(bindingKey(context, actionId));
        return override
          ? [{ context, actionId, chord: { ...override } }]
          : [];
      },
    );
  }

  setOverrides(value: unknown): void {
    const next = new Map<string, KeyChord>();
    if (Array.isArray(value)) {
      for (const candidate of value) {
        if (!isBindingOverride(candidate)) continue;
        const key = bindingKey(candidate.context, candidate.actionId);
        const binding = DEFAULT_BINDINGS_BY_KEY.get(key);
        if (!binding || binding.configurable === false) continue;
        next.set(key, { ...candidate.chord });
      }
    }
    this.overrides = next;
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = (): number => this.revision;
}

function bindingKey(context: KeymapContext, actionId: string): string {
  return `${context}:${actionId}`;
}

function availableOnPlatform(
  binding: BindingDefinition,
  platform: StudioPlatform,
): boolean {
  return !binding.platforms || binding.platforms.includes(platform);
}

const DEFAULT_BINDINGS_BY_CONTEXT = new Map<
  KeymapContext,
  BindingDefinition[]
>();
const DEFAULT_BINDINGS_BY_KEY = new Map<string, BindingDefinition>();
for (const binding of DEFAULT_BINDINGS) {
  const contextBindings = DEFAULT_BINDINGS_BY_CONTEXT.get(binding.context);
  if (contextBindings) contextBindings.push(binding);
  else DEFAULT_BINDINGS_BY_CONTEXT.set(binding.context, [binding]);
  DEFAULT_BINDINGS_BY_KEY.set(
    bindingKey(binding.context, binding.actionId),
    binding,
  );
}

function isKeyChord(value: unknown): value is KeyChord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KeyChord>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.control === "boolean" &&
    typeof candidate.meta === "boolean" &&
    typeof candidate.shift === "boolean"
  );
}

function isBindingOverride(value: unknown): value is BindingOverride {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BindingOverride>;
  return (
    KEYMAP_CONTEXT_PRECEDENCE.includes(candidate.context as KeymapContext) &&
    typeof candidate.actionId === "string" &&
    isKeyChord(candidate.chord)
  );
}

export const studioKeymapRegistry = new KeymapRegistry();

// Generated from operations/keybindings.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface KeybindingSetting {
  readonly scope: "host";
  readonly key: "keybindings";
  readonly value: unknown;
  readonly updated_at: string;
}

export interface LoadKeybindingSettingQuery {
  readonly keybinding_setting: KeybindingSetting | null;
}

export type LoadKeybindingSettingVariables = Record<string, never>;

export interface UpdateKeybindingSettingMutation {
  readonly update_keybinding_setting: KeybindingSetting;
}

export interface UpdateKeybindingSettingVariables {
  readonly value: unknown;
}

export const LoadKeybindingSettingDocument: TypedDocumentNode<
  LoadKeybindingSettingQuery,
  LoadKeybindingSettingVariables
> = {
  kind: "Document",
  operationName: "LoadKeybindingSetting",
  source: "query LoadKeybindingSetting {\n  keybinding_setting {\n    scope\n    key\n    value\n    updated_at\n  }\n}",
};

export const UpdateKeybindingSettingDocument: TypedDocumentNode<
  UpdateKeybindingSettingMutation,
  UpdateKeybindingSettingVariables
> = {
  kind: "Document",
  operationName: "UpdateKeybindingSetting",
  source: "mutation UpdateKeybindingSetting($value: Json!) {\n  update_keybinding_setting(value: $value) {\n    scope\n    key\n    value\n    updated_at\n  }\n}",
};

# Extractable components

## PaneShell

- Source: `studio/src/app/shell/PaneShell.tsx`
- Category: layout
- Description: Focus-aware bordered panel with a compact title bar and scrollable body.
- Extractable props: `title`, `focused`
- Hardcoded: square corners, panel colors, title typography

## StudioFooter

- Source: `studio/src/app/shell/StudioFooter.tsx`
- Category: layout
- Description: Persistent keyboard-hint and utility bar.
- Extractable props: shortcut labels, utility actions
- Hardcoded: 24px height, title background, compact typography

## SettingsStatusLine

- Source: `studio/src/shared/ui/SettingsPrimitives.tsx`
- Category: basic
- Description: Left-accent status message for success, attention, and failure states.
- Extractable props: `tone`, `children`
- Hardcoded: border and background treatment

## SettingsButton

- Source: `studio/src/shared/ui/SettingsPrimitives.tsx`
- Category: basic
- Description: Square bordered button with primary, secondary, and danger tiers.
- Extractable props: tier, label, disabled
- Hardcoded: padding, border width, typography

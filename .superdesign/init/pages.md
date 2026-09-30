# Key view dependency trees

## Main workbench

Entry: `studio/src/app/StudioApp.tsx`

- `studio/src/app/startup/ServiceHealthGate.tsx`
- `studio/src/app/startup/BootstrapGate.tsx`
- `studio/src/app/onboarding/OnboardingGate.tsx`
- `studio/src/app/shell/StudioShell.tsx`
  - `studio/src/app/shell/StudioLayout.tsx`
    - `studio/src/app/shell/sidebar/StudioSidebar.tsx`
    - `studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx`
    - `studio/src/app/shell/layout/useStudioPanelLayout.ts`
  - `studio/src/app/shell/StudioFooter.tsx`

## App-server schema explorer, new target

No implementation exists yet. The design should use generated contract context from:

- `schemas/index.ts`
- `schemas/ClientRequest.ts`
- `schemas/ServerRequest.ts`
- `schemas/ServerNotification.ts`
- `schemas/v2/index.ts`

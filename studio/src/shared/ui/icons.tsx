import type { SVGProps } from "react";

// Static geometry hoisted to module scope so icon renders reuse the same
// element objects instead of recreating them (rendering-hoist-jsx).

// F6: one consistent inline-SVG icon set (lucide-style: 24-grid geometry,
// 1.75px round stroke), replacing the improvised Unicode glyphs. Inline so
// there's no external request and no 1,000-icon dependency; every icon inherits
// currentColor and sizes via the `size` prop (default 16). Stroke-only, so they
// read crisply on the dark sibling palette.

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

function Icon({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

// Backlog — list.
const LIST_GEOMETRY = (
  <>
    <line x1="8" x2="21" y1="6" y2="6" />
    <line x1="8" x2="21" y1="12" y2="12" />
    <line x1="8" x2="21" y1="18" y2="18" />
    <line x1="3" x2="3.01" y1="6" y2="6" />
    <line x1="3" x2="3.01" y1="12" y2="12" />
    <line x1="3" x2="3.01" y1="18" y2="18" />
  </>
);
export const IconList = (p: IconProps) => <Icon {...p}>{LIST_GEOMETRY}</Icon>;

// Board — columns.
const COLUMNS_GEOMETRY = (
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </>
);
export const IconColumns = (p: IconProps) => <Icon {...p}>{COLUMNS_GEOMETRY}</Icon>;

// Epics — layers.
const LAYERS_GEOMETRY = (
  <>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </>
);
export const IconLayers = (p: IconProps) => <Icon {...p}>{LAYERS_GEOMETRY}</Icon>;

// Story Map — layout grid.
const LAYOUT_GRID_GEOMETRY = (
  <>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </>
);
export const IconLayoutGrid = (p: IconProps) => <Icon {...p}>{LAYOUT_GRID_GEOMETRY}</Icon>;

// Dependencies — a small directed graph (lucide "git-fork"/network style).
const DEPENDENCY_GEOMETRY = (
  <>
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="5" cy="18" r="2.5" />
    <circle cx="19" cy="12" r="2.5" />
    <path d="M7.3 6.8 16.6 11" />
    <path d="M7.3 17.2 16.6 13" />
  </>
);
export const IconDependency = (p: IconProps) => <Icon {...p}>{DEPENDENCY_GEOMETRY}</Icon>;

// Settings — gear.
const SETTINGS_GEOMETRY = (
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconSettings = (p: IconProps) => <Icon {...p}>{SETTINGS_GEOMETRY}</Icon>;

// Switcher / collapse caret — chevron down.
const CHEVRON_DOWN_GEOMETRY = (
  <>
    <path d="m6 9 6 6 6-6" />
  </>
);
export const IconChevronDown = (p: IconProps) => <Icon {...p}>{CHEVRON_DOWN_GEOMETRY}</Icon>;

// Source tree folder.
const FOLDER_GEOMETRY = (
  <>
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </>
);
export const IconFolder = (p: IconProps) => <Icon {...p}>{FOLDER_GEOMETRY}</Icon>;

// Source tree file.
const FILE_GEOMETRY = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </>
);
export const IconFile = (p: IconProps) => <Icon {...p}>{FILE_GEOMETRY}</Icon>;

// Collapse / expand the nav drawer — panel-left toggle.
const PANEL_LEFT_GEOMETRY = (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </>
);
export const IconPanelLeft = (p: IconProps) => <Icon {...p}>{PANEL_LEFT_GEOMETRY}</Icon>;

// Drawer close / remove — x.
const X_GEOMETRY = (
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
);
export const IconX = (p: IconProps) => <Icon {...p}>{X_GEOMETRY}</Icon>;

// External link.
const EXTERNAL_LINK_GEOMETRY = (
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>
);
export const IconExternalLink = (p: IconProps) => <Icon {...p}>{EXTERNAL_LINK_GEOMETRY}</Icon>;

// Sub-task / nesting — corner down right.
const CORNER_DOWN_RIGHT_GEOMETRY = (
  <>
    <polyline points="15 10 20 15 15 20" />
    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
  </>
);
export const IconCornerDownRight = (p: IconProps) => <Icon {...p}>{CORNER_DOWN_RIGHT_GEOMETRY}</Icon>;

// Blocker warning — alert triangle.
const ALERT_TRIANGLE_GEOMETRY = (
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>
);
export const IconAlertTriangle = (p: IconProps) => <Icon {...p}>{ALERT_TRIANGLE_GEOMETRY}</Icon>;

// Create / add — plus.
const PLUS_GEOMETRY = (
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>
);
export const IconPlus = (p: IconProps) => <Icon {...p}>{PLUS_GEOMETRY}</Icon>;

// Search — magnifier.
const SEARCH_GEOMETRY = (
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
);
export const IconSearch = (p: IconProps) => <Icon {...p}>{SEARCH_GEOMETRY}</Icon>;

// Filter — funnel.
const FILTER_GEOMETRY = (
  <>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </>
);
export const IconFilter = (p: IconProps) => <Icon {...p}>{FILTER_GEOMETRY}</Icon>;

// Editable affordance — pencil.
const PENCIL_GEOMETRY = (
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>
);
export const IconPencil = (p: IconProps) => <Icon {...p}>{PENCIL_GEOMETRY}</Icon>;

// Success — check inside a circle. Toast success glyph.
const CHECK_CIRCLE_GEOMETRY = (
  <>
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </>
);
export const IconCheckCircle = (p: IconProps) => <Icon {...p}>{CHECK_CIRCLE_GEOMETRY}</Icon>;

// Paperclip — an attachment row's type glyph.
const PAPERCLIP_GEOMETRY = (
  <>
    <path d="M13.234 20.252 21 12.3a3.534 3.534 0 0 0 0-5 3.534 3.534 0 0 0-5 0l-8.486 8.486a2 2 0 0 0 0 2.828 2 2 0 0 0 2.829 0l7.879-7.879a1 1 0 1 0-1.415-1.414L9 16.586" />
  </>
);
export const IconPaperclip = (p: IconProps) => <Icon {...p}>{PAPERCLIP_GEOMETRY}</Icon>;

// Link — the copy-deep-link control's glyph.
const LINK_GEOMETRY = (
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>
);
export const IconLink = (p: IconProps) => <Icon {...p}>{LINK_GEOMETRY}</Icon>;

// Bare check — the brief "Copied" confirmation glyph.
const CHECK_GEOMETRY = (
  <>
    <path d="M20 6 9 17l-5-5" />
  </>
);
export const IconCheck = (p: IconProps) => <Icon {...p}>{CHECK_GEOMETRY}</Icon>;

// Run — play.
const PLAY_GEOMETRY = (
  <>
    <path d="m6 3 14 9-14 9Z" />
  </>
);
export const IconPlay = (p: IconProps) => <Icon {...p}>{PLAY_GEOMETRY}</Icon>;

// Grill — flame, for the interactive requirements-grilling stage.
const GRILL_GEOMETRY = (
  <>
    <path d="M12 22a8 8 0 0 0 8-8c0-3.5-2-6.5-5-8.5.1 2-1 4-2.5 5.2C12 7 10 4 7 2c.2 3.5-1.7 5.2-2.8 7.2A8.4 8.4 0 0 0 4 14a8 8 0 0 0 8 8Z" />
    <path d="M9.5 17.5c0-1.8 1.1-2.8 2.5-4.5.2 1.4 1.2 2.2 2 3.1.7.8.5 2.2-.2 3" />
  </>
);
export const IconGrill = (p: IconProps) => <Icon {...p}>{GRILL_GEOMETRY}</Icon>;

// Spec — a document with written requirements.
const SPEC_GEOMETRY = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h6" />
  </>
);
export const IconSpec = (p: IconProps) => <Icon {...p}>{SPEC_GEOMETRY}</Icon>;

// Tickets — a perforated work ticket.
const TICKETS_GEOMETRY = (
  <>
    <path d="M2 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
    <path d="M13 5v2" />
    <path d="M13 17v2" />
    <path d="M13 11v2" />
  </>
);
export const IconTickets = (p: IconProps) => <Icon {...p}>{TICKETS_GEOMETRY}</Icon>;

// Implement — source-code brackets.
const IMPLEMENT_GEOMETRY = (
  <>
    <path d="m8 9-4 3 4 3" />
    <path d="m16 9 4 3-4 3" />
    <path d="m14 5-4 14" />
  </>
);
export const IconImplement = (p: IconProps) => (
  <Icon {...p}>{IMPLEMENT_GEOMETRY}</Icon>
);

// Review — an eye for inspection.
const REVIEW_GEOMETRY = (
  <>
    <path d="M2.1 12a10.9 10.9 0 0 1 19.8 0 10.9 10.9 0 0 1-19.8 0Z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconReview = (p: IconProps) => <Icon {...p}>{REVIEW_GEOMETRY}</Icon>;

// Terminal panel — the window with a strip docked along its bottom edge.
const PANEL_BOTTOM_GEOMETRY = (
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 15h18" />
  </>
);
export const IconPanelBottom = (p: IconProps) => (
  <Icon {...p}>{PANEL_BOTTOM_GEOMETRY}</Icon>
);

// Minimize — the window-furniture rule the panel collapses onto.
const MINIMIZE_GEOMETRY = <path d="M5 17h14" />;
export const IconMinimize = (p: IconProps) => (
  <Icon {...p}>{MINIMIZE_GEOMETRY}</Icon>
);

// Maximize — the empty frame the panel grows to fill.
const MAXIMIZE_GEOMETRY = <rect width="14" height="14" x="5" y="5" rx="1" />;
export const IconMaximize = (p: IconProps) => (
  <Icon {...p}>{MAXIMIZE_GEOMETRY}</Icon>
);

// Restore — the smaller frame stepping back out of the maximized one.
const RESTORE_GEOMETRY = (
  <>
    <rect width="11" height="11" x="4" y="9" rx="1" />
    <path d="M8 9V5h11v11h-4" />
  </>
);
export const IconRestore = (p: IconProps) => (
  <Icon {...p}>{RESTORE_GEOMETRY}</Icon>
);

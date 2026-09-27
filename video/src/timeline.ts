import marks from "../public/marks.json";

// Source recording is 1600x900; `marks` are seconds into it (see capture.sh).
export const FPS = 30;
export const SOURCE = { width: 1600, height: 900 };

export type Focus = { x: number; y: number; zoom: number };
// Camera target in source pixels; `at` is seconds into the scene when the move starts.
export type CameraKey = Focus & { at: number };
export type Scene = {
  caption: string;
  from: number; // source seconds
  to: number;
  camera: CameraKey[];
};

export const SCENES: Scene[] = [
  {
    caption: "Capture ideas the moment they land",
    from: marks.capture - 0.2, to: marks.story,
    camera: [{ at: 0, x: 430, y: 110, zoom: 1.5 }, { at: 2.9, x: 430, y: 250, zoom: 1.35 }],
  },
  {
    caption: "Break stories into tasks",
    from: marks.story, to: marks.state,
    camera: [{ at: 0, x: 400, y: 330, zoom: 1.35 }, { at: 0.8, x: 1230, y: 420, zoom: 1.35 }],
  },
  {
    caption: "Move work through your workflow",
    from: marks.state, to: marks.worktree,
    camera: [{ at: 0, x: 1050, y: 200, zoom: 1.5 }, { at: 2.3, x: 450, y: 370, zoom: 1.35 }],
  },
  {
    caption: "Every task gets its own Git worktree",
    from: marks.worktree, to: marks.terminal - 2.2,
    camera: [{ at: 0, x: 1300, y: 120, zoom: 1.5 }, { at: 1.6, x: 1230, y: 170, zoom: 1.5 }],
  },
  {
    caption: "Real shells, kept alive by tmux",
    from: marks.terminal, to: marks.end,
    camera: [{ at: 0, x: 560, y: 760, zoom: 1.4 }, { at: 3.2, x: 480, y: 700, zoom: 1.25 }],
  },
];

export const INTRO_FRAMES = 3 * FPS;
export const OUTRO_FRAMES = 4 * FPS;
export const OVERLAP = 15; // frames the app window overlaps the title cards

const toFrames = (s: number) => Math.round(s * FPS);
// Scene start frames within the main (app) section.
export const SCENE_STARTS = SCENES.reduce<number[]>(
  (starts, scene, i) => [...starts, (starts[i] ?? 0) + toFrames(scene.to - scene.from)],
  [0],
);
export const MAIN_FRAMES = SCENE_STARTS[SCENES.length];
export const sceneFrames = (scene: Scene) => toFrames(scene.to - scene.from);
export const TOTAL_FRAMES = INTRO_FRAMES + MAIN_FRAMES + OUTRO_FRAMES - 2 * OVERLAP;

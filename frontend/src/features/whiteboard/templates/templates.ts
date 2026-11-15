import type { StickyTone } from '../contract';

/**
 * Starter templates for an empty board. Each template is a list of geometry
 * items in local coordinates (top-left near the origin); `applyTemplate`
 * centres the whole layout at the viewport centre and turns items into normal
 * frame/sticky objects in ONE command.
 */

export type TemplateItem =
  | { readonly kind: 'frame'; readonly label: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'sticky'; readonly text: string; readonly tone: StickyTone; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export interface TemplateDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly items: readonly TemplateItem[];
}

const FRAME_W = 640;
const FRAME_H = 520;
const COL_GAP = 40;
const ROW_GAP = 40;
const STICKY_W = 200;
const STICKY_H = 200;

function frame(label: string, x: number, y: number, w = FRAME_W, h = FRAME_H): TemplateItem {
  return { kind: 'frame', label, x, y, w, h };
}

function sticky(text: string, tone: StickyTone, x: number, y: number): TemplateItem {
  return { kind: 'sticky', text, tone, x, y, w: STICKY_W, h: STICKY_H };
}

/** A labelled grid of empty frames (moodboard and sprite critique walls). */
function frameGrid(labels: readonly string[], cols: number, w: number, h: number, gap: number): TemplateItem[] {
  return labels.map((label, index) => frame(
    label,
    (index % cols) * (w + gap),
    Math.floor(index / cols) * (h + gap),
    w,
    h,
  ));
}

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: 'sprint',
    name: 'Sprint board',
    description: 'To do, Doing and Done columns with a few starter stickies.',
    items: [
      frame('To do', 0, 0),
      frame('Doing', FRAME_W + COL_GAP, 0),
      frame('Done', (FRAME_W + COL_GAP) * 2, 0),
      sticky('Set up the repo', 'mint', 40, 80),
      sticky('First pass at the UI', 'mint', 40, 320),
      sticky('Blocked on art', 'yellow', FRAME_W + COL_GAP + 40, 80),
      sticky('Tune the movement', 'yellow', FRAME_W + COL_GAP + 40, 320),
      sticky('Board channel ships', 'sky', (FRAME_W + COL_GAP) * 2 + 40, 80),
      sticky('Fixed the camera', 'sky', (FRAME_W + COL_GAP) * 2 + 40, 320),
    ],
  },
  {
    id: 'retro',
    name: 'Retro',
    description: 'Went well, To improve and Actions columns.',
    items: [
      frame('Went well', 0, 0),
      frame('To improve', FRAME_W + COL_GAP, 0),
      frame('Actions', (FRAME_W + COL_GAP) * 2, 0),
      sticky('Smooth deploy', 'mint', 40, 80),
      sticky('Great pairing', 'mint', 40, 320),
      sticky('Flaky tests', 'pink', FRAME_W + COL_GAP + 40, 80),
      sticky('Slower sync', 'pink', FRAME_W + COL_GAP + 40, 320),
      sticky('Add an e2e smoke', 'sky', (FRAME_W + COL_GAP) * 2 + 40, 80),
      sticky('Split board sync', 'sky', (FRAME_W + COL_GAP) * 2 + 40, 320),
    ],
  },
  {
    id: 'moodboard',
    name: 'Moodboard',
    description: 'A 2×3 grid of frames for references and vibes.',
    items: frameGrid(['Mood', 'Palette', 'Type', 'Light', 'Texture', 'Vibe'], 2, 640, 400, ROW_GAP),
  },
  {
    id: 'sprite-critique',
    name: 'Sprite critique wall',
    description: 'Labelled frames for reviewing each animation state.',
    items: frameGrid(['Idle', 'Walk', 'Attack', 'Jump', 'Hurt', 'Death'], 3, 640, 400, ROW_GAP),
  },
];

export function templateById(id: string): TemplateDef | undefined {
  return TEMPLATES.find(template => template.id === id);
}

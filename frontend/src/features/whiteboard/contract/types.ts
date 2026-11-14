/**
 * Revision 2: plain JSON only; aliases are not brands. All UUIDs are lowercase
 * canonical hyphenated strings (UUID_PATTERN); generate with crypto.randomUUID().
 * Object ids are globally unique DB primary keys, not merely board-local.
 * Copy/paste/duplicate across boards MUST mint fresh ids; a cross-board collision
 * is HTTP 400 invalid, not a board conflict, and discloses no other-board object.
 */
export type UUID = string;
export type ObjectId = UUID;
export type BoardId = UUID;
export type UserId = UUID;
export type OpId = UUID;
/** Non-negative safe integer. Server writes are > 0; 0 means unacknowledged. */
export type BoardSeq = number;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned world-space bounds; finite numbers, w/h >= 0. No rotation. */
export interface Rect extends Point {
  readonly w: number;
  readonly h: number;
}

/** Viewport-local CSS pixels = world * zoom + (x, y); not device pixels. */
export interface Camera extends Point {
  readonly zoom: number;
}

/**
 * Decisions where the plan is silent: these are the v1 palette & sticky tone allowlists.
 * Colour ids resolve to --wb-colour-{id}, sticky tones to --wb-sticky-{tone}, plus canonical #rrggbb hex.
 * Never persist arbitrary CSS expressions, font family names or arbitrary sizes.
 */
export const PALETTE_COLOURS = [
  'ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink',
] as const;
export type HexColour = `#${string}`;
export type PaletteColourId = (typeof PALETTE_COLOURS)[number];
export type PaletteColour = PaletteColourId | HexColour;
export const STICKY_TONES = ['yellow', 'pink', 'mint', 'sky'] as const;
export type StickyToneId = (typeof STICKY_TONES)[number];
export type StickyTone = StickyToneId | HexColour;
export const STICKY_REACTION_PRESETS = [
  '👍', '👎', '❤️', '😂', '🔥', '🎉',
  '✅', '❓', '👀', '🙌', '💯', '✨',
  '🙏', '😭', '😊', '🚀', '💀', '🤝',
  '💪', '💡', '😎', '🤔', '💖', '😡',
] as const;
export type StickyReactions = Readonly<Record<string, readonly UserId[]>>;
export type FillMode = 'none' | 'tint' | 'solid';
export type StrokeWeight = 'thin' | 'thick';
export type StrokePreset = 'pen' | 'marker';
export type TextSize = 'S' | 'M' | 'L' | 'XL';
export type FontKind = 'app' | 'handwriting';
export type TextAlignment = 'left' | 'center' | 'right';

export interface StrokeStyle {
  readonly colour: PaletteColour;
  readonly weight: StrokeWeight;
}

/** Fill uses the stroke colour: tint is 15% opacity, solid is opaque. */
export interface ShapeStyle extends StrokeStyle {
  readonly fill: FillMode;
}

export interface TextStyle {
  readonly colour: PaletteColour;
  readonly size: TextSize;
  readonly font: Extract<FontKind, 'app'>;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly align: TextAlignment;
}

/** Sticky text is ink, regular handwriting, left-aligned; auto-fit is derived. */
export interface StickyStyle {
  readonly tone: StickyTone;
  readonly font: Extract<FontKind, 'handwriting'>;
}

/**
 * Fractional string, compared by JS code-unit order (never localeCompare), then
 * id by code-unit order. Decision: "0:" prefix for frames, "1:" for all others;
 * suffix uses RANK_ALPHABET, at most MAX_RANK_SUFFIX_LENGTH characters.
 * Canonical fractional-indexing suffix: letter head a..z => integer length
 * head-'a'+2, A..Z => 'Z'-head+2 (including head); enough digits must follow.
 * Optional fractional tail cannot end in '0'; bare A + 26 zeroes is reserved.
 * Backend checks this grammar too, not just RANK_PATTERN. Keys grow on repeated
 * bisection; core throws RangeError at the length cap, never emits invalid wire
 * data. No automatic rebalance in v2: caller must report rank-space exhaustion.
 * Equal ranks are allowed (id tie-break); no key can be inserted strictly
 * between equal bounds. This keeps frames behind everything in the same ordered stack. Reordering
 * never crosses that partition. No parent ids: containment is purely spatial.
 */
export type Rank = string;

/**
 * Finite x/y in [-MAX_COORDINATE, MAX_COORDINATE], w/h in [0, MAX_COORDINATE].
 * Dimensions > 0 except ZERO_EXTENT_KINDS; UI resize minima are not wire minima.
 */
export interface BaseObject<K extends string> extends Rect {
  readonly id: ObjectId;
  readonly kind: K;
  readonly rank: Rank;
  /** Board seq of last write, NOT an object-local incrementing counter. */
  readonly version: BoardSeq;
  /** Creating/recreating actor, immutable until deletion; restore stamps local user. */
  readonly createdBy: UserId;
}

/** Object-local world units, pressure in [0, 1]; use 0.5 if unavailable. */
export interface StrokePoint extends Point {
  readonly pressure: number;
}

/**
 * x/y is the minimum sampled centreline position; w/h its tight extent.
 * At least one point; local tightness allows relative GEOMETRY_EPSILON noise.
 * Points lie in [0,w] × [0,h], not normalized fractions. A dot/flat stroke may
 * have zero extent. The rendered outline may extend outside these bounds.
 * Resize must scale points AND bounds in one patch (zero axes stay zero).
 * Simplify on finish to satisfy BOTH point and serialized-body byte limits.
 * Marker is an opaque broader preset, not a translucent highlighter.
 */
export interface StrokeObject extends BaseObject<'stroke'> {
  readonly points: readonly StrokePoint[];
  readonly preset: StrokePreset;
  readonly style: StrokeStyle;
}

export interface RectObject extends BaseObject<'rect'> {
  readonly style: ShapeStyle;
}

export interface EllipseObject extends BaseObject<'ellipse'> {
  readonly style: ShapeStyle;
}

/**
 * Endpoints use object-local world units, tight bounds as for strokes; w or h
 * may be zero. Preserve start/end direction when crossing or resizing. The
 * arrowhead is at end. No bindings, curves or extra arrowhead configuration.
 */
export interface LineObject extends BaseObject<'line'> {
  readonly start: Point;
  readonly end: Point;
  readonly style: StrokeStyle;
}

export interface ArrowObject extends BaseObject<'arrow'> {
  readonly start: Point;
  readonly end: Point;
  readonly style: StrokeStyle;
}

/** Plain text, LF newlines, no NUL, <= MAX_TEXT_LENGTH Unicode scalars.
 * Width reflows; h is persisted measured height. Byte cap also applies.
 */
export interface TextObject extends BaseObject<'text'> {
  readonly text: string;
  readonly style: TextStyle;
}

/** Starts at base size; derived font fits down to minimum, then h grows.
 * Text rules as above, with MAX_STICKY_TEXT_LENGTH instead.
 */
export interface StickyObject extends BaseObject<'sticky'> {
  readonly text: string;
  readonly style: StickyStyle;
  readonly reactions?: StickyReactions;
}

/** Positive normalized source rectangle: each component in [0,1], w/h > 0;
 * x+w/y+h <= 1 + GEOMETRY_EPSILON. MIN_CROP_SIZE is only an editor default.
 */
export type NormalizedCrop = Rect;

export interface ImageObject extends BaseObject<'image'> {
  readonly assetId: UUID;
  /** Nonempty /uploads/, http:// or https:// URL, <= MAX_ASSET_URL_BYTES UTF-8, no NUL. */
  readonly url: string;
  /** Positive integer natural pixels <= MAX_IMAGE_DIMENSION on each axis,
   * product <= MAX_IMAGE_PIXELS; named width/height on the wire.
   */
  readonly width: number;
  readonly height: number;
  /** Uncropped = {x:0,y:0,w:1,h:1}; w/h on the object describe visible bounds. */
  readonly crop: NormalizedCrop;
  /** Crisp pixels. Aspect lock uses (width * crop.w) / (height * crop.h). */
  readonly pixelated: boolean;
}

/**
 * Capture non-frame members by inclusive centre containment at pointer-down;
 * never include nested frames. Move captured ids plus frame in one command;
 * refuse gestures exceeding MAX_CHANGES_PER_COMMAND rather than split writes.
 * Label <= MAX_FRAME_LABEL_LENGTH Unicode scalars, no NUL. Label/hit geometry
 * uses FRAME_LABEL_*; marquee selects frames only when fully enclosing bounds.
 */
export interface FrameObject extends BaseObject<'frame'> {
  readonly label: string;
  readonly style: StrokeStyle;
}

export interface BoardObjectByKind {
  readonly stroke: StrokeObject;
  readonly rect: RectObject;
  readonly ellipse: EllipseObject;
  readonly line: LineObject;
  readonly arrow: ArrowObject;
  readonly text: TextObject;
  readonly sticky: StickyObject;
  readonly image: ImageObject;
  readonly frame: FrameObject;
}
export type ObjectKind = keyof BoardObjectByKind;
export type BoardObject = BoardObjectByKind[ObjectKind];

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type EndpointHandleId = 'start' | 'end';
export type HandleId = ResizeHandleId | EndpointHandleId;
/** Text: e/w reflow, corners step size. Images: aspect-locked corners. */
export type ToolId =
  | 'select' | 'hand' | 'pen' | 'laser' | 'sticky' | 'rect' | 'ellipse'
  | 'line' | 'arrow' | 'text' | 'frame' | 'image';
/** Pen and arrow stay active; other creation tools return to select. */
export type Unsubscribe = () => void;

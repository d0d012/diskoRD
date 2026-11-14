/** Contract revision 2. Backend Go constants mirror this file (parity-tested).
 * Byte caps use UTF-8 JSON, not JS string.length; object KB = KiB, board MB =
 * decimal MB. The server is authoritative for JSON encoding/storage overhead.
 * Object cap counts the compact stored body (all fields except id/version);
 * frontend whole-wire-body checks are intentionally conservative. Board totals
 * use the same canonical Go JSON encoding, NOT PostgreSQL JSONB's spaced text.
 */
export const CONTRACT_REVISION = 2;
export const MAX_OBJECTS_PER_BOARD = 5_000;
export const MAX_BOARD_BODY_BYTES = 10_000_000;
export const MAX_OBJECT_BODY_BYTES = 32 * 1024;
export const MAX_CHANGES_PER_COMMAND = 500;
export const MAX_STROKE_POINTS = 2_048;
export const MAX_COMMANDS_PER_SECOND = 10;
export const COMMAND_BURST = 20;
/** Count distinct assets referenced by live objects, not unused uploads. */
export const MAX_REFERENCED_ASSETS_PER_BOARD = 100;
export const MAX_UPLOADS_PER_MINUTE = 10;
export const UPLOAD_RATE_WINDOW_MS = 60_000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_MEGAPIXELS = 16;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_DIMENSION = 32_768;
/** Applied independently to x/y (absolute value), w/h and local coordinates. */
export const MAX_COORDINATE = 10_000_000;
export const MAX_ASSET_URL_BYTES = 2_048;
/** Relative geometry tolerance; absolute tolerance for unit crops. */
export const GEOMETRY_EPSILON = 1e-9;
export const ZERO_EXTENT_KINDS = ['stroke', 'line', 'arrow'] as const;

export const RANK_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const FRAME_RANK_PREFIX = '0:';
export const OBJECT_RANK_PREFIX = '1:';
export const MAX_RANK_SUFFIX_LENGTH = 64;
/** Alphabet/length screen only; canonical suffix rules are documented on Rank. */
export const RANK_PATTERN = '^[01]:[0-9A-Za-z]{1,64}$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const HEX_COLOUR_PATTERN = '^#[0-9a-f]{6}$';
export const MAX_LASER_POINTS = 32;
export const LASER_DECAY_MS = 900;
export const MAX_STICKY_REACTION_EMOJIS = 16;
export const MAX_STICKY_REACTION_USERS = 100;
export const MAX_REACTION_EMOJI_LENGTH = 16;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Screen CSS pixels, independent of zoom/devicePixelRatio. */
export const MIN_SHAPE_DRAG_DISTANCE_PX = 6;
export const LINE_SNAP_DEGREES = 15;
export const STICKY_BASE_WIDTH = 200;
export const STICKY_BASE_HEIGHT = 200;
export const STICKY_MIN_FONT_SIZE = 14;

export const MAX_CURSOR_PRESENCE_HZ = 20;
export const MAX_OTHER_PRESENCE_HZ = 5;
/** Full serialized BOARD_PRESENCE d, including channelId and stamped userId. */
export const MAX_PRESENCE_BYTES = 2 * 1024;
export const PRESENCE_EXPIRY_MS = 10_000;
export const SEQUENCE_GAP_HOLD_MS = 300;
export const COMMAND_ACK_TIMEOUT_MS = 5_000;
export const MAX_COMMAND_RESENDS = 1;
export const OP_IDEMPOTENCY_TTL_MS = 10 * 60_000;
/** Blur flushes immediately; IME composition postpones the debounce commit. */
export const TEXT_COMMIT_DEBOUNCE_MS = 500;

/** Decisions absent from the plan, frozen so independent packages agree. */
export const BOARD_SUBSCRIBE_TIMEOUT_MS = 5_000;
export const CURSOR_IDLE_FADE_MS = 3_000;
/** Unicode scalar counts; the stricter serialized byte cap still applies. */
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_STICKY_TEXT_LENGTH = 5_000;
export const MAX_FRAME_LABEL_LENGTH = 256;
/** Editing/geometry defaults, NOT extra server-side minimum dimensions. */
export const MIN_RESIZE_SIZE = 1;
export const MIN_TEXT_WIDTH = 1;
export const MIN_CROP_SIZE = 0.01;
export const DEFAULT_SIMPLIFY_TOLERANCE = 1;
/** Deterministic label hit box: entirely above the frame at its top-left. */
export const FRAME_LABEL_HEIGHT = 24;
export const FRAME_LABEL_PADDING_X = 10;
export const FRAME_LABEL_FONT_SIZE = 14;
export const FRAME_LABEL_CHAR_WIDTH = FRAME_LABEL_FONT_SIZE * 0.55;
export const STICKY_PREFERRED_FONT_SIZE = 24;
export const TEXT_SIZE_WORLD_UNITS = { S: 16, M: 24, L: 32, XL: 48 } as const;
export const STROKE_WEIGHT_WORLD_UNITS = { thin: 2, thick: 4 } as const;
/** Applied to the selected stroke weight, opaque rather than highlighter alpha. */
export const MARKER_WIDTH_MULTIPLIER = 3;
export const TINT_FILL_OPACITY = 0.15;
/** Pointer drags shorter than the threshold create these world-space bounds. */
export const DEFAULT_SHAPE_WIDTH = 160;
export const DEFAULT_SHAPE_HEIGHT = 100;
export const DEFAULT_LINE_LENGTH = 160;
export const DEFAULT_TEXT_WIDTH = 240;
export const DEFAULT_FRAME_WIDTH = 640;
export const DEFAULT_FRAME_HEIGHT = 400;

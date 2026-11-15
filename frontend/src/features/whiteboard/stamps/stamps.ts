/**
 * Built-in pixel-art stamps. Pure data + rasterization; no React here so the
 * sprite definitions and the PNG exporter are unit-testable without a DOM.
 *
 * Each stamp is a 16×16 grid of single-character palette indices. '.' is
 * transparent; every other character must resolve through the stamp's palette.
 * Stamps become ordinary `image` objects on the board (the server validates
 * object kinds strictly), so nothing here extends the wire contract.
 */

export const STAMP_SIZE = 16;
/** Natural pixel size of the uploaded PNG (nearest-neighbour upscale). */
export const STAMP_PNG_SIZE = 64;
/** Default world-unit side of a placed stamp. */
export const STAMP_WORLD_SIZE = 64;

export interface StampDef {
  readonly id: string;
  readonly name: string;
  /** Single-character colour key → '#rrggbb'. */
  readonly palette: Readonly<Record<string, string>>;
  /** STAMP_SIZE rows, each exactly STAMP_SIZE characters. */
  readonly rows: readonly string[];
}

export interface StampCell {
  readonly x: number;
  readonly y: number;
  readonly colour: string;
}

const PALETTE: Readonly<Record<string, string>> = {
  k: '#1e293b', // ink / outline
  w: '#ffffff',
  y: '#ffd56b', // yellow
  o: '#f59e0b', // orange
  r: '#ef4444', // red
  g: '#22c55e', // green
  b: '#3b82f6', // blue
  n: '#8b5a2b', // brown
  e: '#fde68a', // cream / skin
};

export const STAMPS: readonly StampDef[] = [
  {
    id: 'thumbs-up',
    name: 'Thumbs up',
    palette: PALETTE,
    rows: [
      '................',
      '......kkkkk.....',
      '.....keeeeek....',
      '....keeee.ke....',
      '....keeee.ke....',
      '....keeee.ke....',
      '....keeeeek.....',
      '....keeeek......',
      '....keeeek......',
      '....keeeek......',
      '....keeeek......',
      '....keeeek......',
      '....keeeek......',
      '....kkkkkk......',
      '....bbbbbb......',
      '................',
    ],
  },
  {
    id: 'star',
    name: 'Star',
    palette: PALETTE,
    rows: [
      '................',
      '.......yy.......',
      '.......yy.......',
      '......yyyy......',
      '......yyyy......',
      '.yyyyyyyyyyyyyy.',
      '..yyyyyyyyyyyy..',
      '...yyyyyyyyyy...',
      '....yyyyyyyy....',
      '....yyyyyyyy....',
      '...yyyy..yyyy...',
      '..yyyy....yyyy..',
      '.yyyy......yyyy.',
      '.yy..........yy.',
      '................',
      '................',
    ],
  },
  {
    id: 'heart',
    name: 'Heart',
    palette: PALETTE,
    rows: [
      '................',
      '...rr......rr...',
      '..rrrr....rrrr..',
      '.rrrrrr..rrrrrr.',
      '.rrrrrrrrrrrrrr.',
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
      '.rrrrrrrrrrrrrr.',
      '..rrrrrrrrrrrr..',
      '...rrrrrrrrrr...',
      '....rrrrrrrr....',
      '.....rrrrrr.....',
      '......rrrr......',
      '.......rr.......',
      '................',
      '................',
    ],
  },
  {
    id: 'check',
    name: 'Check',
    palette: PALETTE,
    rows: [
      '................',
      '................',
      '................',
      '..............gg',
      '.............ggg',
      '............ggg.',
      '...........ggg..',
      '..........ggg...',
      '.gg......ggg....',
      '..ggg...ggg.....',
      '...ggggggg......',
      '....ggggg.......',
      '.....ggg........',
      '......g.........',
      '................',
      '................',
    ],
  },
  {
    id: 'cross',
    name: 'Cross',
    palette: PALETTE,
    rows: [
      '................',
      '................',
      '...rr......rr...',
      '...rrr....rrr...',
      '....rrr..rrr....',
      '.....rrrrrr.....',
      '......rrrr......',
      '.......rr.......',
      '.......rr.......',
      '......rrrr......',
      '.....rrrrrr.....',
      '....rrr..rrr....',
      '...rrr....rrr...',
      '...rr......rr...',
      '................',
      '................',
    ],
  },
  {
    id: 'question',
    name: 'Question',
    palette: PALETTE,
    rows: [
      '................',
      '....bbbbbb......',
      '...bbbbbbbb.....',
      '..bbb....bbb....',
      '..bbb....bbb....',
      '.........bbb....',
      '........bbb.....',
      '.......bbb......',
      '......bbb.......',
      '......bbb.......',
      '................',
      '......bbb.......',
      '......bbb.......',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'fire',
    name: 'Fire',
    palette: PALETTE,
    rows: [
      '................',
      '.......yy.......',
      '......yyy.......',
      '.....oyyy.......',
      '....oyyyo.......',
      '...oyyyoo.......',
      '..oyyyyoo.......',
      '..oyyyyoo.......',
      '.oyyyyyoo.......',
      '.oyyyyooo.......',
      '.oyyyyoro.......',
      '.oyyyyyyro......',
      '..oyyyyoro......',
      '...ooooooo......',
      '................',
      '................',
    ],
  },
  {
    id: 'crown',
    name: 'Crown',
    palette: PALETTE,
    rows: [
      '..k..........k..',
      '.kkk........kkk.',
      '.kyk........kyk.',
      '.kyyk......kyyk.',
      '.kyykkkkkkkkyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyykrykkykryyk.',
      '.kyykrykkykryyk.',
      '.kyyyyyyyyyyyyk.',
      '..kkkkkkkkkkkk..',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'skull',
    name: 'Skull',
    palette: PALETTE,
    rows: [
      '....kkkkkkkk....',
      '..kkwwwwwwwwkk..',
      '.kwwwwwwwwwwwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kwwkkwwwwkkwwk.',
      '.kwwkkwwwwkkwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kwwwwwwwwwwwwk.',
      '..kwwwwwwwwwwk..',
      '...kkkkkkkkkk...',
      '....k.k..k.k....',
      '....kk....kk....',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'arrow',
    name: 'Arrow',
    palette: PALETTE,
    rows: [
      '................',
      '................',
      '......bbb.......',
      '......bbbb......',
      '......bbbbb.....',
      '......bbbbbb....',
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
      '......bbbbbb....',
      '......bbbbb.....',
      '......bbbb......',
      '......bbb.......',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'flag',
    name: 'Flag',
    palette: PALETTE,
    rows: [
      '................',
      '..k.............',
      '..k.............',
      '..k...rrrrrr....',
      '..k..rrrrrrrr...',
      '..k.rrrrrrrrrr..',
      '..k..rrrrrrrr...',
      '..k...rrrrrr....',
      '..k.............',
      '..k.............',
      '..k.............',
      '..k.............',
      '..k.............',
      '..k.............',
      '..k.............',
      '................',
    ],
  },
  {
    id: 'eyes',
    name: 'Eyes',
    palette: PALETTE,
    rows: [
      '................',
      '................',
      '................',
      '...kkk....kkk...',
      '..kwwwk..kwwwk..',
      '.kwwwwk..kwwwwk.',
      '.kwwbwk..kwwbwk.',
      '.kwwwk...kwwwk..',
      '..kkk....kkk....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'hundred',
    name: '100',
    palette: PALETTE,
    rows: [
      '................',
      '..r..rrr..rrr...',
      '.rr..r.r..r.r...',
      '..r..r.r..r.r...',
      '..r..r.r..r.r...',
      '..r..rrr..rrr...',
      '..rrrrrrrrrrrr..',
      '..rrrrrrrrrrrr..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'party',
    name: 'Party',
    palette: PALETTE,
    rows: [
      '................',
      '.......kk.......',
      '......krrk......',
      '.....krrrrk.....',
      '....krryrrrk....',
      '...krryyyyrrk...',
      '..krrryyyyrrrk..',
      '.krrrryyyyrrrrk.',
      '.krrrryyyyrrrrk.',
      '.krrrrrrrrrrrrk.',
      '.kkrrrrrrrrrrkk.',
      '..kkkrrrrrrkkk..',
      '....kkkkkkkk....',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'coffee',
    name: 'Coffee',
    palette: PALETTE,
    rows: [
      '................',
      '...w.....w......',
      '....w...w.......',
      '.....www........',
      '..kkkkkkkkkkk...',
      '.knnnnnnnnnnnk..',
      '.knnnnnnnnnnnk..',
      '.knnnnnnnnnnnk..',
      '.knnnnnnnnnnnk..',
      '.knnnnnnnnnnnk..',
      '.kkkkkkkkkkkkk..',
      '..kkkkkkkkkkk...',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 'bug',
    name: 'Bug',
    palette: PALETTE,
    rows: [
      '................',
      '................',
      '....kk....kk....',
      '...kggk..kggk...',
      '..kggggkkggggk..',
      '.kggggggggggggk.',
      '.kgkkggggggkkgk.',
      '.kggggggggggggk.',
      '.kggkggggggkggk.',
      '.kggggggggggggk.',
      '..kggggggggggk..',
      '...kkkkkkkkkk...',
      '................',
      '................',
      '................',
      '................',
    ],
  },
];

/** Non-transparent cells of a stamp, validating its grid shape and palette. */
export function stampCells(stamp: StampDef): StampCell[] {
  if (stamp.rows.length !== STAMP_SIZE) throw new Error(`stamp ${stamp.id}: expected ${STAMP_SIZE} rows, got ${stamp.rows.length}`);
  const cells: StampCell[] = [];
  stamp.rows.forEach((row, y) => {
    if (row.length !== STAMP_SIZE) throw new Error(`stamp ${stamp.id}: row ${y} has length ${row.length}`);
    for (let x = 0; x < STAMP_SIZE; x++) {
      const key = row[x];
      if (key === '.' || key === ' ') continue;
      const colour = stamp.palette[key];
      if (!colour) throw new Error(`stamp ${stamp.id}: unknown colour key "${key}"`);
      cells.push({ x, y, colour });
    }
  });
  return cells;
}

/** The colour at a grid cell, or null for a transparent cell (validated). */
export function stampColourAt(stamp: StampDef, x: number, y: number): string | null {
  const key = stamp.rows[y]?.[x];
  if (key === undefined || key === '.' || key === ' ') return null;
  const colour = stamp.palette[key];
  if (!colour) throw new Error(`stamp ${stamp.id}: unknown colour key "${key}"`);
  return colour;
}

/** Nearest-neighbour upscaled PNG of a stamp (default 64×64, crisp pixels). */
export async function rasterizeStamp(stamp: StampDef, size = STAMP_PNG_SIZE): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');
  context.imageSmoothingEnabled = false;
  const scale = size / STAMP_SIZE;
  for (const cell of stampCells(stamp)) {
    context.fillStyle = cell.colour;
    context.fillRect(cell.x * scale, cell.y * scale, scale, scale);
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render stamp PNG.');
  return blob;
}

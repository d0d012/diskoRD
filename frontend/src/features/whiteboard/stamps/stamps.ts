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
    palette: { k: '#0f172a', s: '#f6c89f', h: '#ffe4cc', d: '#d9965f', c: '#3b82f6', b: '#1d4ed8' },
    rows: [
      '......kkk.......',
      '.....khhsk......',
      '.....khssk......',
      '.....khssk......',
      '.....khsskkkkk..',
      '....khssshhhhsk.',
      '...khsssssssshk.',
      '.kkkhsssssssdk..',
      '.kchsssskkkkkk..',
      '.kchssssshhhhsk.',
      '.kchssssssssshk.',
      '.kcbsssskkkkkk..',
      '.kcbssssshhhhsk.',
      '.kcbddddssssdk..',
      '.kkbddddkkkkk...',
      '..kkkkkk........',
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
    palette: { k: '#0f172a', r: '#ef4444', o: '#f97316', y: '#facc15', w: '#fef9c3' },
    rows: [
      '.......kk.......',
      '......krk.......',
      '.....krrok..kk..',
      '.....krook.krok.',
      '..kk.kroookrook.',
      '.krok.kroorook..',
      '.krookkroooook..',
      '.krooorrooyoook.',
      'kroooorooyyyoook',
      'kroooooyyyyyyook',
      'krooooyyywwyyook',
      '.krooyyywwwwyok.',
      '.kroyyywwwwyyok.',
      '..kroyywwwwyok..',
      '...kkoyyyyyokk..',
      '.....kkkkkkkk...',
    ],
  },
  {
    id: 'crown',
    name: 'Crown',
    palette: { k: '#0f172a', g: '#eab308', h: '#fef08a', d: '#ca8a04', r: '#ef4444', b: '#3b82f6' },
    rows: [
      '................',
      '.......kk.......',
      '.kk...krrk...kk.',
      'kbbk..krrk..kbbk',
      'kbbk..kghk..kbbk',
      '.kgk..kghk..kgk.',
      '.kghk.kghk.kghk.',
      '.kghkkghggkkghk.',
      '.kghgghgggghghk.',
      '.kghggggggggghk.',
      '.kgggggggggggdk.',
      '.kddddddddddddk.',
      '.kgbrggrrggrbgk.',
      '.kgbrggrrggrbgk.',
      '.kddddddddddddk.',
      '..kkkkkkkkkkkk..',
    ],
  },
  {
    id: 'skull',
    name: 'Skull',
    palette: { k: '#0f172a', b: '#f1f5f9', h: '#ffffff', s: '#94a3b8' },
    rows: [
      '................',
      '....kkkkkkkk....',
      '..kkhhhhhhhhkk..',
      '.khhhbbbbbbhhhk.',
      '.khbbbbbbbbbbhk.',
      'khbbbbbbbbbbbbhk',
      'khbkkkbbbbkkkbhk',
      'khbkkkkbbkkkkbhk',
      'khbkkkkbbkkkkbhk',
      'kssbkkbkkbkkbssk',
      '.kssbbkkkkbbssk.',
      '..kkbbbbbbbbkk..',
      '...kbskbbskbsk..',
      '...kbskbbskbsk..',
      '....kkkkkkkkk...',
      '................',
    ],
  },
  {
    id: 'arrow',
    name: 'Arrow',
    palette: { k: '#0f172a', b: '#3b82f6', h: '#93c5fd', d: '#1d4ed8' },
    rows: [
      '................',
      '........kk......',
      '........khk.....',
      '........khhk....',
      '........khhhk...',
      '.kkkkkkkkhhhhk..',
      '.khhhhhhhhhhhhk.',
      '.khbbbbbbbbbbbhk',
      '.kbbbbbbbbbbbbbk',
      '.kdddddddddddddk',
      '.kkkkkkkkdddddk.',
      '........kddddk..',
      '........kdddk...',
      '........kddk....',
      '........kdk.....',
      '........kk......',
    ],
  },
  {
    id: 'flag',
    name: 'Flag',
    palette: { k: '#0f172a', p: '#94a3b8', y: '#facc15', r: '#ef4444', h: '#f87171', d: '#b91c1c' },
    rows: [
      '..kk............',
      '.kyyk...........',
      '..kk.kkkkk......',
      '..kpkrhhhhkkkk..',
      '..kpkrhhhrrrrrk.',
      '..kpkrhhrrrrddk.',
      '..kpkrrrrrrddk..',
      '..kpkrrrrrddk...',
      '..kpkrhhrrrddk..',
      '..kpkrhhhrrrrdk.',
      '..kpkrddddrkkkk.',
      '..kpkrkkkkk.....',
      '..kpk...........',
      '..kpk...........',
      '.kpppk..........',
      '.kkkkk..........',
    ],
  },
  {
    id: 'eyes',
    name: 'Eyes',
    palette: { k: '#0f172a', w: '#ffffff', s: '#cbd5e1', h: '#f8fafc' },
    rows: [
      '................',
      '................',
      '..kkkk....kkkk..',
      '.khhhhk..khhhhk.',
      'khwwwwwhkhwwwwwh',
      'kwwkkwwwkwwkkwww',
      'kwkhkwwwkwkhkwww',
      'kwkkkwwwkwkkkwww',
      'kwkkkwwwkwkkkwww',
      'kwwkkwwwkwwkkwww',
      'kwwwwwwwkwwwwwww',
      'kswwwwwhkswwwwwh',
      '.kssssk..kssssk.',
      '..kkkk....kkkk..',
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
    palette: { k: '#0f172a', w: '#cbd5e1', m: '#f8fafc', h: '#ffffff', s: '#cbd5e1', c: '#6f4e37', r: '#d97706' },
    rows: [
      '.....w....w.....',
      '....w....w......',
      '.....w....w.....',
      '................',
      '..kkkkkkkkkkk...',
      '.kmcccccccccmk..',
      '.kmmmmmmmmmmmk..',
      '.kmhhhhhhhhmmkkk',
      '.kmhhhhhhhhmsmk.',
      '.kmhhhhhhhhmssk.',
      '.kmhhhhhhhhmssk.',
      '.kmhhhhhhhhmmkkk',
      '.kmmmmmmmmmsmk..',
      '..ksssssssssk...',
      '...kkkkkkkkk....',
      '................',
    ],
  },
  {
    id: 'frog',
    name: 'Frog',
    palette: { k: '#0f172a', g: '#4ade80', h: '#86efac', d: '#16a34a', w: '#ffffff', b: '#f472b6', y: '#fef08a' },
    rows: [
      '................',
      '..kkkk....kkkk..',
      '.kwwwwk..kwwwwk.',
      '.kwkkwk..kwkkwk.',
      '.kwkkwkkkkwkkwk.',
      '.kwwwwghhgwwwwk.',
      '.kggggggggggggk.',
      'kghhgggggggghhgk',
      'kbbggggggggggbbk',
      'kbbggkkkkkkggbbk',
      'kgggggddddgggggk',
      '.kgggyyyyyygggk.',
      '.kdgyyyyyyyygdk.',
      '..kddddddddddk..',
      '...kkkkkkkkkk...',
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

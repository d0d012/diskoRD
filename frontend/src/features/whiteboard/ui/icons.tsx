import type { SVGProps } from 'react';

export type BoardIconName = 'select' | 'hand' | 'pen' | 'eraser' | 'laser' | 'sticky' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'frame' | 'minus' | 'plus' | 'undo' | 'redo' | 'front' | 'back' | 'delete' | 'people';

const paths: Record<BoardIconName, string> = {
  select: 'M5 3 20 13l-7 1-3 7Z',
  hand: 'M8 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 2',
  pen: 'm4 20 1-6L16 3l5 5L10 19Zm9-14 5 5M5 14l5 5',
  eraser: 'm7 21-4-4a2 2 0 0 1 0-3L13 4a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9ZM22 21H7M9 8l7 7',
  laser: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  sticky: 'M4 4h16v10l-6 6H4ZM14 20v-6h6',
  rect: 'M4 4h16v16H4Z',
  ellipse: 'M21 12a9 8 0 1 1-18 0 9 8 0 1 1 18 0',
  line: 'M4 20 20 4',
  arrow: 'M4 20 20 4M9 4h11v11',
  text: 'M4 6V4h16v2M12 4v16M8 20h8',
  frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  minus: 'M5 12h14', plus: 'M5 12h14M12 5v14',
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12',
  front: 'M8 8h12v12H8ZM4 15V4h11M12 12h4v4h-4Z',
  back: 'M4 4h12v12H4ZM9 20h11V9M8 8h4v4H8Z',
  delete: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
};

export function BoardIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: BoardIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}

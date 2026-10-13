interface OpenProfileCard {
  id: string;
  close: () => void;
}

let current: OpenProfileCard | null = null;

/**
 * Claims the single app-wide open profile card, closing any other one first.
 * Returns a release function for the caller's unmount. Works for mouse and
 * keyboard activation alike (outside-mousedown alone would miss keyboard).
 */
export function claimProfileCard(id: string, close: () => void): () => void {
  if (current && current.id !== id) current.close();
  current = { id, close };
  return () => {
    if (current?.id === id) current = null;
  };
}

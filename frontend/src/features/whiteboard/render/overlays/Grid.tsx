/** Screen-space dot grid; the scene writes its camera tokens (see paintGrid). */
export function Grid() {
  return <div className="wb-root__canvas wb-render-grid" data-wb-grid="" aria-hidden="true" />;
}

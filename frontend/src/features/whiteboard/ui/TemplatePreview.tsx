import type { PaletteColour, StickyTone } from '../contract';
import type { TemplateDef } from '../templates/templates';

function colour(value: PaletteColour | StickyTone, sticky = false): string {
  return value.startsWith('#') ? value : `var(--wb-${sticky ? 'sticky' : 'colour'}-${value})`;
}
interface TemplatePreviewProps { readonly template: TemplateDef }
/** A schematic of the actual items, not a separately maintained thumbnail. */
export function TemplatePreview({ template }: TemplatePreviewProps) {
  const minX = Math.min(...template.items.map(i => i.x));
  const minY = Math.min(...template.items.map(i => i.y));
  const w = Math.max(...template.items.map(i => i.x + i.w)) - minX;
  const h = Math.max(...template.items.map(i => i.y + i.h)) - minY;
  const weight = Math.max(w, h) / 180;
  const ordered = [...template.items.filter(i => i.kind === 'frame'), ...template.items.filter(i => i.kind !== 'frame')];
  return <svg className="wb-template-preview" viewBox={`${minX - 40} ${minY - 40} ${w + 80} ${h + 80}`} aria-hidden="true" focusable="false">
    {ordered.map((item, index) => {
      if (item.kind === 'line' || item.kind === 'arrow') return <line key={index} x1={item.x + item.start.x} y1={item.y + item.start.y} x2={item.x + item.end.x} y2={item.y + item.end.y} stroke={colour(item.colour ?? 'ink')} strokeWidth={weight} />;
      if (item.kind === 'text') return <rect key={index} x={item.x} y={item.y} width={item.w * 0.8} height={Math.min(item.h, 16)} fill={colour(item.style?.colour ?? 'ink')} opacity={0.65} rx={4} />;
      const mode = 'fill' in item ? item.fill : undefined;
      const fill = item.kind === 'sticky' ? colour(item.tone, true) : item.kind === 'frame' || !mode || mode === 'none' ? 'none' : colour(item.colour ?? 'ink');
      const stroke = item.kind === 'frame' ? 'var(--wb-primary)' : item.kind === 'sticky' ? 'none' : colour(item.colour ?? 'ink');
      const opacity = (item.kind === 'rect' || item.kind === 'ellipse') && item.fill === 'tint' ? 0.15 : 1;
      return item.kind === 'ellipse'
        ? <ellipse key={index} cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill={fill} fillOpacity={opacity} stroke={stroke} strokeWidth={weight} />
        : <rect key={index} x={item.x} y={item.y} width={item.w} height={item.h} rx={8} fill={fill} fillOpacity={opacity} stroke={stroke} strokeOpacity={item.kind === 'frame' ? 0.35 : 1} strokeWidth={weight} />;
    })}
  </svg>;
}

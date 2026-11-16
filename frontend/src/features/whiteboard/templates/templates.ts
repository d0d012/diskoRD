import type { FillMode, PaletteColour, Point, Rect, StickyTone, TextStyle } from '../contract';
import { featuredTemplates } from './featuredTemplates';
import { extraTemplates } from './extraTemplates';

/** Local geometry; connectors use tight object-local endpoints, just like the tools. */
export type TemplateItem = Rect & (
  | { readonly kind: 'frame'; readonly label: string }
  | { readonly kind: 'sticky'; readonly text: string; readonly tone: StickyTone }
  | { readonly kind: 'text'; readonly text: string; readonly style?: Partial<TextStyle> }
  | { readonly kind: 'rect' | 'ellipse'; readonly colour?: PaletteColour; readonly fill?: FillMode }
  | { readonly kind: 'line' | 'arrow'; readonly start: Point; readonly end: Point; readonly colour?: PaletteColour }
);
export const TEMPLATE_CATEGORIES = ['Planning', 'Brainstorm', 'Design', 'Fun'] as const;
export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];
export interface TemplateDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly items: readonly TemplateItem[];
}
export const TEMPLATES: readonly TemplateDef[] = [...featuredTemplates, ...extraTemplates];
export const FEATURED_TEMPLATES = featuredTemplates;
export function templateById(id: string): TemplateDef | undefined {
  return TEMPLATES.find(template => template.id === id);
}

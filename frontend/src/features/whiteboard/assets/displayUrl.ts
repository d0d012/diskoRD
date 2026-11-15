import { resolveMediaUrl } from '../../../lib/api';

/**
 * What the browser should fetch for a board asset URL. The server stores and
 * cross-checks relative `/uploads/...` URLs in production; the desktop build's
 * page origin is the Tauri origin, not the server, so they must be resolved
 * against the API origin before loading. Display only: never write the result
 * back into an image object (the server rejects a url that differs from the
 * asset row). blob:/data:/absolute URLs pass through unchanged.
 */
export function assetDisplayUrl(url: string): string {
  return resolveMediaUrl(url) ?? url;
}

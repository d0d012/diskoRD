import type { ProfileBannerArt } from "../../types";
import { builtinBanner, isBuiltinBanner } from "./lib/banners";
import { encodeDoc, type PixelArtDoc } from "./lib/doc";

const builtinDocs = new Map<string, PixelArtDoc>();

/** The doc a banner shows: built-ins are drawn (once) at 150×48, drawings are used as saved. */
export function bannerArt(banner: ProfileBannerArt | null | undefined): PixelArtDoc | null {
  if (!banner) return null;
  if (banner.builtin) {
    if (!isBuiltinBanner(banner.builtin)) return null;
    let doc = builtinDocs.get(banner.builtin);
    if (!doc) {
      doc = encodeDoc(builtinBanner(banner.builtin));
      builtinDocs.set(banner.builtin, doc);
    }
    return doc;
  }
  return banner.doc ?? null;
}

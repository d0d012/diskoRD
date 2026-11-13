import { useMemo } from "react";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import type { ProfileBannerArt } from "../../types";
import { SharpArtImage } from "./SharpArtImage";
import { bannerArt } from "./bannerArt";

export const BANNER_WIDTH = 300;
export const BANNER_HEIGHT = 96;

/** The art a banner shows as an image URL, or null when there's none / it can't be drawn. */
function useBannerArt(banner: ProfileBannerArt | null | undefined) {
  return useMemo(() => bannerArt(banner), [banner]);
}

/** The 300×96 card banner: the user's pixel banner, or their plain color. */
export function ProfileBanner({ userId, color }: { userId: string; color: string }) {
  const banner = usePixelArtStore((s) => s.profiles[userId]?.banner);
  const art = useBannerArt(banner);
  return (
    <div className="relative" style={{ height: BANNER_HEIGHT, width: "100%", backgroundColor: color, overflow: "hidden" }}>
      {art && (
        <SharpArtImage
          doc={art} width={BANNER_WIDTH} height={BANNER_HEIGHT}
          alt=""
          draggable={false}
          data-testid="pixel-banner"
          style={{ display: "block" }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(180deg, transparent 50%, rgba(17,18,20,0.65) 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15)" }}
      />
    </div>
  );
}

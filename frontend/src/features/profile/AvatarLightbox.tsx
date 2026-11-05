import { ImageLightbox } from "../../components/ImageLightbox";
import { resolveMediaUrl } from "../../lib/api";

interface Props {
  src: string;
  name: string;
  onClose: () => void;
}

/** Full-size view of a user's avatar. Closes on backdrop click or Esc. */
export function AvatarLightbox({ src, name, onClose }: Props) {
  return <ImageLightbox images={[{ src: resolveMediaUrl(src) ?? src, alt: `${name}'s avatar` }]} index={0} onClose={onClose} variant="avatar" />;
}

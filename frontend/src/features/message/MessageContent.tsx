import { useEffect, useState } from "react";
import { ImageLightbox, type LightboxImage } from "../../components/ImageLightbox";
import { api, resolveMediaUrl } from "../../lib/api";
import { parseInviteCode, goToInvite } from "../../lib/inviteLinks";
import { linkify } from "../../lib/linkify";
import { isKlipyMediaUrl } from "../../lib/klipy";

/** Invite links open inside the app instead of a browser tab. */
function openInApp(e: React.MouseEvent, url: string) {
  const code = parseInviteCode(url);
  if (code && /^https?:/i.test(url)) {
    e.preventDefault();
    goToInvite(code);
  }
}

// ── URL detection helpers ───────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
const YOUTUBE_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i;
const URL_RE = /https?:\/\/[^\s<>"]+/gi;

function isImageUrl(url: string) {
  return IMAGE_EXT.test(url.split("?")[0]);
}

function getYoutubeId(url: string) {
  const m = url.match(YOUTUBE_RE);
  return m ? m[1] : null;
}

// ── Link preview component ──────────────────────────────────────────────────

interface OGPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<OGPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/link-preview?url=${encodeURIComponent(url)}`)
      .then(({ data }) => {
        if (!cancelled) {
          const p: OGPreview = data.data;
          if (p.title || p.image) setPreview(p);
          else setFailed(true);
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed || (!preview)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => openInApp(e, url)}
      className="flex mt-2 rounded-lg overflow-hidden max-w-sm no-underline hover:opacity-90 transition-opacity"
      style={{ border: "1px solid var(--color-dc-bg-floating)", backgroundColor: "var(--color-dc-bg-secondary)", textDecoration: "none" }}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          className="w-24 h-auto object-cover flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="p-3 min-w-0">
        {preview.siteName && (
          <p className="text-xs mb-0.5 truncate" style={{ color: "var(--color-dc-brand)" }}>
            {preview.siteName}
          </p>
        )}
        {preview.title && (
          <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-dc-text-muted)" }}>
            {preview.description}
          </p>
        )}
      </div>
    </a>
  );
}

// ── YouTube embed ───────────────────────────────────────────────────────────

function YoutubeEmbed({ videoId }: { videoId: string }) {
  const [show, setShow] = useState(false);
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  if (!show) {
    return (
      <div
        className="relative mt-2 rounded-lg overflow-hidden cursor-pointer max-w-sm"
        style={{ aspectRatio: "16/9" }}
        onClick={() => setShow(true)}
      >
        <img src={thumb} alt="YouTube video" className="w-full h-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(255,0,0,0.9)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg overflow-hidden max-w-sm" style={{ aspectRatio: "16/9" }}>
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

// ── Inline image ────────────────────────────────────────────────────────────

function InlineImage({ url, images, onOpen }: { url: string; images: LightboxImage[]; onOpen: (index: number, target: HTMLElement) => void }) {
  const [broken, setBroken] = useState(false);
  const src = resolveMediaUrl(url);
  if (broken || !src) return null;
  return (
    <img
      src={src}
      alt="attachment"
      tabIndex={0}
      role="button"
      aria-label="View attachment"
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(images.findIndex(image => image.src === src), e.currentTarget); } }}
      className="mt-2 rounded-lg max-w-sm max-h-80 object-contain block cursor-pointer"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)", ...(isKlipyMediaUrl(url) ? { maxWidth: "min(300px, 100%)", height: "auto" } : {}) }}
      onError={() => setBroken(true)}
      onClick={(e) => onOpen(images.findIndex(image => image.src === src), e.currentTarget)}
    />
  );
}

// ── Text with @mention highlight + plain link rendering ─────────────────────

function TextWithMentions({ text, usernames }: { text: string; usernames: string[] }) {
  const parts = text.split(/(@\w+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^@\w+$/.test(part) && usernames.includes(part.slice(1)) ? (
          <span key={i} style={{ color: "var(--color-dc-brand)", fontWeight: 600 }}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

// ── Main MessageContent ─────────────────────────────────────────────────────

interface Props {
  content: string;
  attachments?: string[];
  mentionUsernames?: string[];
}

export function MessageContent({ content, attachments, mentionUsernames = [] }: Props) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  // KLIPY media paths do not document a reversible slug, so chat GIFs intentionally
  // omit the favorite star rather than saving an incorrect slug.
  const singleKlipyGif = isKlipyMediaUrl(content.trim());
  // Collect all URLs in the text
  const urlMatches = Array.from(new Set(content.match(URL_RE) ?? []));

  // Partition URLs by type
  const youtubeUrls = urlMatches.filter((u) => getYoutubeId(u) !== null);
  const imageUrls = urlMatches.filter((u) => isImageUrl(u) && !getYoutubeId(u));
  const linkUrls = urlMatches.filter((u) => !getYoutubeId(u) && !isImageUrl(u));

  // Turn URLs and bare domains (e.g. "youtube.com") in the text into clickable links
  const textParts = linkify(content).map((part, i) =>
    part.type === "text" ? (
      <TextWithMentions key={i} text={part.text} usernames={mentionUsernames} />
    ) : (
      <a
        key={i}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => openInApp(e, part.href)}
        style={{ color: "var(--color-dc-text-link, #00b0f4)" }}
        className="hover:underline"
      >
        {part.text}
      </a>
    )
  );

  const images: LightboxImage[] = [...(attachments ?? []), ...imageUrls].flatMap(url => { const src = resolveMediaUrl(url); return src ? [{ src, alt: "attachment" }] : []; });
  return (
    <div>
      {viewerIndex !== null && <ImageLightbox images={images} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(null)} returnFocus={returnFocus} />}
      {/* Text */}
      {!singleKlipyGif && <p className="m-0 text-[15px] leading-[22px] whitespace-pre-wrap break-words" style={{ color: "var(--color-dc-text-body)" }}>
        {textParts}
      </p>}

      {/* Uploaded attachments */}
      {(attachments ?? []).map((url) => (
        <InlineImage key={url} url={url} images={images} onOpen={(index, target) => { setReturnFocus(target); setViewerIndex(index); }} />
      ))}

      {/* Pasted image URLs */}
      {imageUrls.map((url) => (
        <InlineImage key={url} url={url} images={images} onOpen={(index, target) => { setReturnFocus(target); setViewerIndex(index); }} />
      ))}

      {/* YouTube embeds */}
      {youtubeUrls.map((url) => (
        <YoutubeEmbed key={url} videoId={getYoutubeId(url)!} />
      ))}

      {/* OG link previews — only for non-image, non-youtube links */}
      {linkUrls.map((url) => (
        <LinkPreview key={url} url={url} />
      ))}
    </div>
  );
}

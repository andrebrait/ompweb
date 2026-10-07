"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Maximize } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const ZOOM_MAX = 8;
/** Lowest zoom when the fitted size is larger; big images can go below it down to their fit. */
const ZOOM_FLOOR = 0.1;
const ZOOM_FACTOR = 1.25;

interface Size { width: number; height: number }

/** Scale that fits `image` inside `box`; never above 1, so small images keep their real size. */
export function fitZoom(image: Size, box: Size): number {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(1, box.width / image.width, box.height / image.height);
}

/** One zoom step in or out, clamped to [min(fit, 10%), 800%]. */
export function stepZoom(zoom: number, direction: 1 | -1, fit: number): number {
  const next = direction > 0 ? zoom * ZOOM_FACTOR : zoom / ZOOM_FACTOR;
  return Math.min(ZOOM_MAX, Math.max(Math.min(fit, ZOOM_FLOOR), next));
}

interface ClickableImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  /** Image source: string URL (data:, http(s):, blob:, /api/files/...) or Blob. */
  src: ImgHTMLAttributes<HTMLImageElement>["src"];
}

/**
 * Click-to-preview image: renders the thumbnail inline and opens a full-screen
 * lightbox with zoom controls on click. Accepts any img props (style, className,
 * width, ...) and forwards them to the thumbnail element.
 *
 * Blob sources (part of React 19's img-src union) render through a managed
 * object URL that is revoked when the source changes or the component unmounts
 * — the same mechanism React's experimental `enableSrcObject` will use natively.
 */
export function ClickableImage({ src, alt, ...imgProps }: ClickableImageProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof src === "string" || src === undefined) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(src);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [src]);

  const resolvedSrc = typeof src === "string" ? src : objectUrl ?? "";

  // Never render a broken clickable thumbnail for a missing source.
  if (!resolvedSrc) return null;

  return (
    <>
      <button
        type="button"
        className="image-clickable"
        onClick={(event) => {
          // Linked markdown images (`[![alt](img)](url)`) wrap this button in
          // an anchor; never let the click bubble and navigate away.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={alt ? t("imagePreview.openWithAlt", { alt }) : t("imagePreview.open")}
        title={alt ? t("imagePreview.openWithAlt", { alt }) : t("imagePreview.open")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolvedSrc} alt={alt ?? ""} loading="lazy" {...imgProps} />
      </button>
      {/*
        Portal to <body>: a linked markdown image (`[![alt](img)](url)`) would
        otherwise keep the dialog inside the anchor, so clicks on the viewer
        (zoom, close) would bubble into anchor navigation. The dialog only
        renders when `open`, which is strictly client-side — the short-circuit
        keeps `document.body` off the SSR path.
      */}
      {open && createPortal(<ImageLightbox src={resolvedSrc} alt={alt ?? ""} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: ClickableImageProps["src"]; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // "fit" follows the window as it resizes; a number is a zoom the user chose.
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [natural, setNatural] = useState<Size | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // contentRect excludes the viewport padding, so "fit" leaves the margin visible.
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const fit = natural && box ? fitZoom(natural, box) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const minZoom = Math.min(fit, ZOOM_FLOOR);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="image-lightbox-dialog"
      aria-label={t("imagePreview.viewerLabel")}
      onClick={(event) => {
        // createPortal moves the DOM to <body>, but React synthetic events
        // still bubble through the component tree: without this, clicks on
        // viewer controls would reach a wrapping anchor's onClick (mixed
        // markdown links like `[text ![img]](file)`) and open its target.
        event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // stopPropagation: the app's window-level Escape handler aborts a
        // running agent — closing the lightbox must not also stop it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="image-lightbox-layout">
        <div className="image-lightbox-toolbar">
          <span className="image-lightbox-title">{alt || t("imagePreview.imageTitle")}</span>
          <div className="image-lightbox-actions">
            <div className="image-lightbox-stepper">
              <button
                type="button"
                onClick={() => setZoom(stepZoom(scale, -1, fit))}
                disabled={!natural || scale <= minZoom}
                title={t("imagePreview.zoomOut")}
                aria-label={t("imagePreview.zoomOut")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <span className="image-lightbox-zoom-value">{natural ? `${Math.round(scale * 100)}%` : "…"}</span>
              <button
                type="button"
                onClick={() => setZoom(stepZoom(scale, 1, fit))}
                disabled={!natural || scale >= ZOOM_MAX}
                title={t("imagePreview.zoomIn")}
                aria-label={t("imagePreview.zoomIn")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="image-lightbox-icon-button"
              onClick={() => setZoom("fit")}
              aria-pressed={zoom === "fit"}
              title={t("imagePreview.fitToScreen")}
              aria-label={t("imagePreview.fitToScreen")}
            >
              <Maximize size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="image-lightbox-icon-button image-lightbox-actual-size"
              onClick={() => setZoom(1)}
              aria-pressed={zoom === 1}
              title={t("imagePreview.actualSize")}
              aria-label={t("imagePreview.actualSize")}
            >
              1:1
            </button>
            <button
              type="button"
              className="image-lightbox-icon-button"
              onClick={onClose}
              title={t("imagePreview.close")}
              aria-label={t("imagePreview.close")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className="image-lightbox-viewport"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="image-lightbox-img"
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            // Real layout size, not transform: scale, so a zoomed-in image
            // scrolls to every edge. Hidden until its size is known.
            style={natural
              ? { width: natural.width * scale, height: natural.height * scale }
              : { visibility: "hidden" }}
          />
        </div>
      </div>
    </dialog>
  );
}

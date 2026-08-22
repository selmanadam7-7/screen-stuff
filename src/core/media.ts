/**
 * Everything a tile might need pixels from, in one place.
 *
 * The pool is told the document and the current zoom on every frame; it opens
 * what is newly needed, closes what is gone, and re-tunes capture resolution so
 * a tile that is small on screen is not encoding 1440p it will never show.
 */

import type { FrameClient, StreamHandle } from "./frames";
import type { Drawable, MediaResolver } from "./render";
import type { BoardDoc, Tile } from "./types";

/** Never ask Rust for more pixels than this per tile, whatever the zoom. */
const MAX_TILE_WIDTH = 2560;
const MAX_TILE_HEIGHT = 1440;
/** Ask for a little more than we draw, so a small zoom-in stays sharp. */
const OVERSAMPLE = 1.25;

export interface MediaPoolOptions {
  /** Frame rate for source tiles. */
  fps: number;
  /** JPEG quality for source tiles. */
  quality: number;
  /** Called when new pixels land, so the host can redraw on demand. */
  onFrame?: () => void;
  /**
   * Whose machine this pool is running on. The host opens its own camera; a
   * guest must never do that — it would show the guest's face where the host's
   * belongs — so a guest reads the published feed instead.
   */
  role?: "host" | "guest";
}

interface CameraEntry {
  video: HTMLVideoElement;
  stream: MediaStream | null;
  error: string | null;
  users: number;
}

export class MediaPool implements MediaResolver {
  private streams = new Map<string, StreamHandle>();
  private streamUsers = new Map<string, number>();
  private images = new Map<string, { el: HTMLImageElement; ready: boolean; failed: boolean }>();
  private videos = new Map<string, HTMLVideoElement>();
  private cameras = new Map<string, CameraEntry>();
  private pdfs = new Map<string, { canvas: HTMLCanvasElement; page: number; rendering: boolean; pageCount: number }>();
  private options: MediaPoolOptions;

  constructor(private client: FrameClient, options: MediaPoolOptions) {
    this.options = options;
  }

  private get isGuest(): boolean {
    return this.options.role === "guest";
  }

  setOptions(options: Partial<MediaPoolOptions>) {
    this.options = { ...this.options, ...options };
  }

  /**
   * Reconcile against the document. `scale` is canvas pixels per board unit,
   * which is what decides how many pixels each tile actually deserves.
   */
  sync(doc: BoardDoc, scale: number) {
    const wanted = new Map<string, { width: number; height: number; fps: number; quality: number }>();

    for (const tile of doc.tiles) {
      if (tile.hidden) continue;
      const source = sourceOf(tile, this.options.role);
      if (!source) continue;

      const width = clampInt(tile.w * scale * OVERSAMPLE, 32, MAX_TILE_WIDTH);
      const height = clampInt(tile.h * scale * OVERSAMPLE, 32, MAX_TILE_HEIGHT);
      const fps = (tile as any).fps ?? this.options.fps ?? doc.fps;
      const quality = (tile as any).quality ?? this.options.quality ?? doc.quality;

      // Two tiles on the same source share one stream at the larger size.
      const existing = wanted.get(source);
      wanted.set(source, {
        width: Math.max(width, existing?.width ?? 0),
        height: Math.max(height, existing?.height ?? 0),
        fps: Math.max(fps, existing?.fps ?? 0),
        quality: Math.max(quality, existing?.quality ?? 0),
      });
    }

    for (const [source, spec] of wanted) {
      const existing = this.streams.get(source);
      if (existing) {
        existing.retune(spec);
      } else {
        this.streams.set(
          source,
          this.client.subscribe(source, spec, this.options.onFrame),
        );
      }
      this.streamUsers.set(source, (this.streamUsers.get(source) ?? 0) + 1);
    }

    for (const [source, handle] of [...this.streams]) {
      if (!wanted.has(source)) {
        handle.close();
        this.streams.delete(source);
        this.streamUsers.delete(source);
      }
    }

    this.syncCameras(doc);
    this.syncElementMedia(doc);
  }

  private syncCameras(doc: BoardDoc) {
    if (this.isGuest) {
      // Guests never open a camera; their camera tiles come in as feeds.
      for (const [key, entry] of [...this.cameras]) {
        entry.stream?.getTracks().forEach((track) => track.stop());
        this.cameras.delete(key);
      }
      return;
    }
    const wanted = new Set(
      doc.tiles.filter((t) => t.kind === "camera" && !t.hidden).map((t) => cameraKey(t)),
    );
    for (const key of wanted) {
      if (!this.cameras.has(key)) this.openCamera(key);
    }
    for (const [key, entry] of [...this.cameras]) {
      if (!wanted.has(key)) {
        entry.stream?.getTracks().forEach((track) => track.stop());
        this.cameras.delete(key);
      }
    }
  }

  private openCamera(key: string) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    const entry: CameraEntry = { video, stream: null, error: null, users: 1 };
    this.cameras.set(key, entry);

    const deviceId = key === "camera:default" ? undefined : key.slice("camera:".length);
    navigator.mediaDevices
      .getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1280, height: 720 },
        audio: false,
      })
      .then((stream) => {
        // The tile may have gone while we were waiting for permission.
        if (!this.cameras.has(key)) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        entry.stream = stream;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        this.options.onFrame?.();
      })
      .catch((err) => {
        entry.error = err instanceof Error ? err.message : "camera unavailable";
      });
  }

  private syncElementMedia(doc: BoardDoc) {
    const videoSrcs = new Set(
      doc.tiles.filter((t): t is Extract<Tile, { kind: "video" }> => t.kind === "video").map((t) => t.src),
    );
    for (const [src, el] of [...this.videos]) {
      if (!videoSrcs.has(src)) {
        el.pause();
        el.removeAttribute("src");
        el.load();
        this.videos.delete(src);
      }
    }

    const imageSrcs = new Set(
      doc.tiles.filter((t): t is Extract<Tile, { kind: "image" }> => t.kind === "image").map((t) => t.src),
    );
    for (const src of [...this.images.keys()]) {
      if (!imageSrcs.has(src)) this.images.delete(src);
    }

    for (const tile of doc.tiles) {
      if (tile.kind === "pdf") this.ensurePdfPage(tile);
    }
    const pdfKeys = new Set(
      doc.tiles.filter((t) => t.kind === "pdf").map((t) => (t as any).src as string),
    );
    for (const key of [...this.pdfs.keys()]) {
      if (!pdfKeys.has(key)) this.pdfs.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  resolve(tile: Tile): Drawable | null {
    switch (tile.kind) {
      case "source":
      case "web": {
        const source = sourceOf(tile);
        if (!source) return null;
        const handle = this.streams.get(source);
        if (!handle?.bitmap) return null;
        return { image: handle.bitmap, width: handle.bitmap.width, height: handle.bitmap.height };
      }
      case "camera": {
        if (this.isGuest) {
          const handle = tile.source ? this.streams.get(tile.source) : undefined;
          if (!handle?.bitmap) return null;
          return { image: handle.bitmap, width: handle.bitmap.width, height: handle.bitmap.height };
        }
        const entry = this.cameras.get(cameraKey(tile));
        if (!entry?.video.videoWidth) return null;
        return { image: entry.video, width: entry.video.videoWidth, height: entry.video.videoHeight };
      }
      case "image": {
        const entry = this.ensureImage(tile.src);
        if (!entry.ready) return null;
        return { image: entry.el, width: entry.el.naturalWidth, height: entry.el.naturalHeight };
      }
      case "video": {
        const el = this.ensureVideo(tile);
        if (!el.videoWidth) return null;
        return { image: el, width: el.videoWidth, height: el.videoHeight };
      }
      case "pdf": {
        const entry = this.pdfs.get(tile.src);
        if (!entry || entry.canvas.width === 0) return null;
        return { image: entry.canvas, width: entry.canvas.width, height: entry.canvas.height };
      }
      default:
        return null;
    }
  }

  statusFor(tile: Tile): string | null {
    switch (tile.kind) {
      case "source":
      case "web": {
        const source = sourceOf(tile);
        const handle = source ? this.streams.get(source) : undefined;
        if (!handle) return null;
        if (handle.status === "error") return handle.error ?? "capture failed";
        if (handle.status === "ended") return "that source has closed";
        if (handle.status === "connecting") return "connecting";
        return null;
      }
      case "camera": {
        if (this.isGuest) {
          const handle = tile.source ? this.streams.get(tile.source) : undefined;
          if (!handle) return "the host is not sharing a camera";
          return handle.status === "live" ? null : "waiting for the host's camera";
        }
        const entry = this.cameras.get(cameraKey(tile));
        if (entry?.error) return entry.error;
        if (!entry?.stream) return "asking for the camera";
        return null;
      }
      case "image": {
        const entry = this.images.get(tile.src);
        if (entry?.failed) return "that image would not load";
        return null;
      }
      default:
        return null;
    }
  }

  /** Native pixel size of a source tile once known — used to fix its aspect. */
  nativeSize(tile: Tile): { width: number; height: number } | null {
    const source = sourceOf(tile);
    if (!source) return null;
    const handle = this.streams.get(source);
    if (!handle) return null;
    if (handle.bitmap) return { width: handle.bitmap.width, height: handle.bitmap.height };
    if (handle.nativeWidth > 0) return { width: handle.nativeWidth, height: handle.nativeHeight };
    return null;
  }

  videoElement(src: string): HTMLVideoElement | undefined {
    return this.videos.get(src);
  }

  private ensureImage(src: string) {
    let entry = this.images.get(src);
    if (!entry) {
      const el = new Image();
      entry = { el, ready: false, failed: false };
      el.onload = () => {
        entry!.ready = true;
        this.options.onFrame?.();
      };
      el.onerror = () => {
        entry!.failed = true;
      };
      el.src = src;
      this.images.set(src, entry);
    }
    return entry;
  }

  private ensureVideo(tile: Extract<Tile, { kind: "video" }>): HTMLVideoElement {
    let el = this.videos.get(tile.src);
    if (!el) {
      el = document.createElement("video");
      el.src = tile.src;
      el.crossOrigin = "anonymous";
      el.playsInline = true;
      this.videos.set(tile.src, el);
    }
    el.loop = tile.loop;
    el.muted = tile.muted;
    if (tile.autoplay && el.paused) void el.play().catch(() => undefined);
    return el;
  }

  private ensurePdfPage(tile: Extract<Tile, { kind: "pdf" }>) {
    const existing = this.pdfs.get(tile.src);
    if (existing && existing.page === tile.page) return;
    if (existing?.rendering) return;

    const canvas = existing?.canvas ?? document.createElement("canvas");
    const entry = {
      canvas,
      page: tile.page,
      rendering: true,
      pageCount: existing?.pageCount ?? tile.pageCount,
    };
    this.pdfs.set(tile.src, entry);

    void renderPdfPage(tile.src, tile.page, canvas)
      .then((pageCount) => {
        entry.pageCount = pageCount;
        this.options.onFrame?.();
      })
      .catch(() => undefined)
      .finally(() => {
        entry.rendering = false;
      });
  }

  pdfPageCount(src: string): number {
    return this.pdfs.get(src)?.pageCount ?? 1;
  }

  destroy() {
    for (const handle of this.streams.values()) handle.close();
    this.streams.clear();
    for (const entry of this.cameras.values()) {
      entry.stream?.getTracks().forEach((track) => track.stop());
    }
    this.cameras.clear();
    for (const el of this.videos.values()) {
      el.pause();
      el.removeAttribute("src");
    }
    this.videos.clear();
    this.images.clear();
    this.pdfs.clear();
  }
}

/**
 * The capture source behind a tile, if it has one.
 *
 * A camera only counts as a source for a guest: the host reads its own camera
 * device directly and publishes that feed, so subscribing to it here would have
 * the host watching a round trip of itself.
 */
export function sourceOf(tile: Tile, role: "host" | "guest" = "host"): string | null {
  if (tile.kind === "source") return tile.source;
  if (tile.kind === "web") return tile.source ?? null;
  if (tile.kind === "camera" && role === "guest") return tile.source ?? null;
  return null;
}

function cameraKey(tile: Tile): string {
  const deviceId = (tile as any).deviceId as string | undefined;
  return deviceId ? `camera:${deviceId}` : "camera:default";
}

const clampInt = (v: number, lo: number, hi: number) =>
  Math.round(Math.min(hi, Math.max(lo, v)));

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

let pdfjs: any = null;
const pdfDocs = new Map<string, any>();

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjs = lib;
  return lib;
}

/** Renders one page into `canvas` and returns the document's page count. */
export async function renderPdfPage(
  src: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<number> {
  const lib = await loadPdfjs();
  let doc = pdfDocs.get(src);
  if (!doc) {
    doc = await lib.getDocument(src).promise;
    pdfDocs.set(src, doc);
  }
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  // 2x so the page stays crisp when the tile is zoomed into.
  const viewport = page.getViewport({ scale: 2 });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return doc.numPages;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return doc.numPages;
}

export function forgetPdf(src: string) {
  pdfDocs.delete(src);
}

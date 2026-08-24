/**
 * A guest putting their own screen or camera on the host's board.
 *
 * The same trick the host uses for its camera, pointed the other way: whatever
 * the browser gives us is drawn to a canvas, encoded as JPEG, and pushed into a
 * named feed on the host's machine. Everything downstream — the tile, the
 * renderer, the resolution ladder, the other guests watching it — treats it as
 * an ordinary source and never learns where it came from.
 *
 * The guest does not choose the feed name. It asks to share; the host's server
 * derives a name from the guest's id and replies with the slot to stamp on the
 * frames. A guest that could name its own feed could publish over the host's
 * camera, so that decision lives on the side that has something to lose.
 *
 * Nothing reaches an audience by itself. A share lands on the host's board
 * *off* the stage, and stays private until the host puts it in the shot — which
 * is the same rule everything else on the board follows.
 */

export type ShareKind = "screen" | "camera";

/**
 * Whether this browser will hand over a camera or a screen at all.
 *
 * `navigator.mediaDevices` only exists in a **secure context**: https, or
 * localhost. The LAN guest link is plain http on an IP address, so on that link
 * the API is not merely restricted — it is undefined, and every attempt fails
 * with a TypeError before any permission prompt appears.
 *
 * That is worth checking rather than catching, because the fix is the host's
 * and not the guest's: Share → **Anywhere** hands out an https address through
 * the tunnel, and sharing works on that one. A button that cannot work is worse
 * than no button, and a button that fails with "your camera could not be
 * opened" sends people to their browser settings to look for a problem that is
 * not there.
 */
export function canShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Why not, in words a guest can act on — which mostly means "ask the host". */
export const WHY_NOT_SHARING =
  "Sharing needs a secure link. Ask the host for their “Anywhere” link and this will work.";


/** Enough for a legible screen without spending a guest's uplink on it. */
const WIDTH = { screen: 1280, camera: 640 } as const;
const FPS = { screen: 12, camera: 15 } as const;
const QUALITY = { screen: 0.7, camera: 0.72 } as const;

interface Live {
  kind: ShareKind;
  stream: MediaStream;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  timer: number | null;
  slot: number | null;
  seq: number;
  stopped: boolean;
}

export interface ShareHooks {
  /** Ask the host to open a feed. The reply arrives as `sharing`. */
  request(kind: ShareKind): void;
  /** Tell the host it is over. */
  release(kind: ShareKind): void;
  /** Push one encoded frame. */
  send(slot: number, seq: number, width: number, height: number, bytes: ArrayBuffer): void;
  /** Something to say to the person, in their own words. */
  say(message: string): void;
  /** Whether anything is live, so the buttons can say so. */
  changed(): void;
}

export class GuestShares {
  private live = new Map<ShareKind, Live>();

  constructor(private hooks: ShareHooks) {}

  isSharing(kind: ShareKind): boolean {
    return this.live.has(kind);
  }

  get count(): number {
    return this.live.size;
  }

  /**
   * Ask for the picture first, then ask the host for a feed.
   *
   * That order matters: the browser's own permission dialog is where most
   * attempts end, and telling the host "a guest is sharing" before knowing
   * whether there is anything to share would put a dead tile on their board.
   */
  async start(kind: ShareKind): Promise<void> {
    if (this.live.has(kind)) return;
    let stream: MediaStream;
    try {
      stream =
        kind === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: FPS.screen },
              audio: false,
            })
          : await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 } },
              audio: false,
            });
    } catch (err) {
      // A refusal is the normal outcome, not an error worth a stack trace.
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      this.hooks.say(
        denied
          ? `you didn't allow your ${kind === "screen" ? "screen" : "camera"}`
          : `your ${kind === "screen" ? "screen" : "camera"} could not be opened`,
      );
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => {});

    const entry: Live = {
      kind,
      stream,
      video,
      canvas: document.createElement("canvas"),
      timer: null,
      slot: null,
      seq: 0,
      stopped: false,
    };
    this.live.set(kind, entry);

    // Stopping from the browser's own "Stop sharing" bar has to end it here
    // too, or the host is left looking at a frozen picture.
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => this.stop(kind));
    }

    this.hooks.request(kind);
    entry.timer = window.setInterval(() => this.pump(entry), 1000 / FPS[kind]);
    this.hooks.changed();
  }

  /** The host answered: here is the slot to stamp on the frames. */
  accepted(kind: ShareKind, slot: number) {
    const entry = this.live.get(kind);
    if (entry) entry.slot = slot;
  }

  /** The host said no, or took it away. Let the picture go. */
  refused(kind: ShareKind, why?: string) {
    if (why) this.hooks.say(why);
    this.stop(kind, { tell: false });
  }

  private pump(entry: Live) {
    if (entry.stopped || entry.slot === null) return;
    const { video, canvas } = entry;
    if (!video.videoWidth) return;

    const width = Math.min(WIDTH[entry.kind], video.videoWidth);
    // Even numbers: an odd dimension is legal in a JPEG and a nuisance
    // everywhere it is later scaled.
    const height = Math.round((width * video.videoHeight) / video.videoWidth) & ~1;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob || entry.stopped || entry.slot === null) return;
        void blob.arrayBuffer().then((bytes) => {
          if (entry.stopped || entry.slot === null) return;
          entry.seq = (entry.seq + 1) >>> 0;
          this.hooks.send(entry.slot, entry.seq, width, height, bytes);
        });
      },
      "image/jpeg",
      QUALITY[entry.kind],
    );
  }

  stop(kind: ShareKind, options: { tell?: boolean } = {}) {
    const entry = this.live.get(kind);
    if (!entry) return;
    entry.stopped = true;
    if (entry.timer !== null) window.clearInterval(entry.timer);
    for (const track of entry.stream.getTracks()) track.stop();
    entry.video.srcObject = null;
    this.live.delete(kind);
    if (options.tell !== false) this.hooks.release(kind);
    this.hooks.changed();
  }

  stopAll() {
    for (const kind of [...this.live.keys()]) this.stop(kind);
  }
}

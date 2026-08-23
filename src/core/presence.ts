/**
 * Everyone else in the room.
 *
 * A guest can already draw on the board, which is the heavyweight version of
 * pointing at something. Most of the time nobody wants to leave a mark — they
 * want to say "that line", or "yes", and have it be gone a moment later.
 *
 * So: a named cursor per guest, and a small set of reactions that float and
 * fade. Both are ephemeral by construction. Nothing here is ever written to the
 * document, which means none of it can end up in a saved board, in the undo
 * stack, or on the audience's screen by accident.
 */

/** The reactions a guest may send. Mirrors `REACTIONS` in guest.rs. */
export const REACTIONS = ["yes", "no", "wow", "clap", "think", "here"] as const;
export type ReactionKind = (typeof REACTIONS)[number];

export const REACTION_GLYPH: Record<ReactionKind, string> = {
  yes: "👍",
  no: "👎",
  wow: "😮",
  clap: "👏",
  think: "🤔",
  here: "👋",
};

export function isReaction(value: string): value is ReactionKind {
  return (REACTIONS as readonly string[]).includes(value);
}

/** How long a cursor survives without an update before it is assumed gone. */
export const CURSOR_TIMEOUT_MS = 4000;

/** How long a reaction floats. */
export const REACTION_MS = 2400;

export interface GuestCursor {
  id: number;
  name: string;
  x: number;
  y: number;
  at: number;
}

export interface GuestReaction {
  id: number;
  name: string;
  kind: ReactionKind;
  at: number;
}

/**
 * Eight colours, assigned by hashing the name.
 *
 * The same person is the same colour twice, on every machine, in every panel.
 * Random would be easier and would make it impossible to learn whose cursor is
 * whose over the course of a call.
 */
export const PRESENCE_COLOURS = [
  "#0562FE",
  "#14B18D",
  "#FD9F0A",
  "#846AFC",
  "#FA3928",
  "#0EA5B7",
  "#E8590C",
  "#7C3AED",
];

export function colourFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PRESENCE_COLOURS[hash % PRESENCE_COLOURS.length];
}

/**
 * Who is pointing where, and what they just said.
 *
 * Kept outside the document and outside React state: cursors move many times a
 * second, and neither of those is a place to put that.
 */
export class Presence {
  private cursors = new Map<number, GuestCursor>();
  private reactions: GuestReaction[] = [];

  pointer(id: number, name: string, x: number, y: number, now: number): void {
    this.cursors.set(id, { id, name, x, y, at: now });
  }

  react(id: number, name: string, kind: string, now: number): void {
    if (!isReaction(kind)) return;
    this.reactions.push({ id, name, kind, at: now });
    // A handful at a time. Past that they overlap into mush anyway.
    if (this.reactions.length > 10) this.reactions.shift();
  }

  /** A guest who has gone takes their cursor with them. */
  remove(id: number): void {
    this.cursors.delete(id);
  }

  clear(): void {
    this.cursors.clear();
    this.reactions = [];
  }

  /** Cursors seen recently enough to still mean something. */
  liveCursors(now: number): GuestCursor[] {
    const out: GuestCursor[] = [];
    for (const [id, cursor] of this.cursors) {
      if (now - cursor.at > CURSOR_TIMEOUT_MS) this.cursors.delete(id);
      else out.push(cursor);
    }
    return out;
  }

  /** Reactions still floating, oldest first. */
  liveReactions(now: number): GuestReaction[] {
    this.reactions = this.reactions.filter((r) => now - r.at < REACTION_MS);
    return this.reactions;
  }

  get anyone(): boolean {
    return this.cursors.size > 0 || this.reactions.length > 0;
  }
}

/** How far through its life a reaction is, 0 to 1. */
export function reactionProgress(reaction: GuestReaction, now: number): number {
  return Math.max(0, Math.min(1, (now - reaction.at) / REACTION_MS));
}

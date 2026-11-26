/**
 * SoundCheck Stage realtime protocol (v1).
 *
 * Transport: Supabase Realtime Broadcast on the private channel `session:<session_id>`.
 * Authorization: RLS on realtime.messages; only members/host of the session may send or receive.
 * Swift (SoundCheckKit) and Kotlin (:core) mirror these types exactly; the golden
 * fixtures in ../fixtures/realtime/ are the cross-language conformance tests.
 *
 * Time base: all `songPos`/`t` values are seconds into the track (song time), never wall
 * clock, so jitter and latency don't corrupt scoring. Wall-clock values are epoch ms.
 */

export const PROTOCOL_VERSION = 1;

export const channelName = (sessionId: string) => `session:${sessionId}`;

export type Platform = 'web' | 'tvos' | 'firetv' | 'ios' | 'android';

/** Host → everyone: playback state. Sent on every change and as a heartbeat every 2 s while playing. */
export interface TransportEvent {
  type: 'transport';
  v: typeof PROTOCOL_VERSION;
  state: 'idle' | 'countdown' | 'playing' | 'paused' | 'ended';
  trackId: string | null;
  queueItemId: string | null;
  /** Song position (s) at `hostClock`. */
  songPos: number;
  /** Host wall clock (epoch ms) when songPos was sampled. */
  hostClock: number;
  keyShift: number;
  /** Members assigned to sing this song. */
  singerMemberIds: string[];
}

/**
 * Phone → host: pitch frames. Batched: 10 frames (100 ms) per message keeps a 4-singer room at
 * ~40 msg/s, well inside Supabase Free (100 msg/s).
 */
export interface PitchEvent {
  type: 'pitch';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  /** Monotonic per member; lets the host detect gaps and reordering. */
  seq: number;
  /** Frames as a flat array, 4 numbers per frame: [t, f0Hz (0 = unvoiced), confidence 0-1, rmsDb]. */
  frames: number[];
}
export const FRAME_STRIDE = 4;
export const FRAMES_PER_MESSAGE = 10;
export const FRAME_HOP_S = 0.01;

/** Phone ↔ host clock sync (NTP-style). Phone sends ping; host answers pong immediately. */
export interface ClockPingEvent {
  type: 'clock_ping';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  id: number;
  /** Phone wall clock (epoch ms) when sent. */
  t0: number;
}
export interface ClockPongEvent {
  type: 'clock_pong';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  id: number;
  t0: number;
  /** Host wall clock when the ping arrived and when the pong was sent. */
  t1: number;
  t2: number;
}

/** Phone → host: mic state and calibration results (also mirrored in Presence). */
export interface MicStatusEvent {
  type: 'mic_status';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  state: 'off' | 'calibrating' | 'ready' | 'live' | 'muted' | 'error';
  noiseFloorDb: number | null;
  /** Estimated one-way latency phone→host song clock, ms. */
  latencyMs: number | null;
  error?: string;
}

/** Host → everyone: live per-singer feedback for phone HUDs. Sent at ~4 Hz. */
export interface LiveScoreEvent {
  type: 'live_score';
  v: typeof PROTOCOL_VERSION;
  scores: { memberId: string; hitRate: number; combo: number }[];
}

/** Host → everyone: final results once score-performance has run. */
export interface ResultsEvent {
  type: 'results';
  v: typeof PROTOCOL_VERSION;
  trackId: string;
  performances: {
    memberId: string;
    performanceId: string | null;
    score: number;
    grade: 'S' | 'A' | 'B' | 'C' | 'D';
    pitch: number;
    timing: number;
    rhythm: number;
    stability: number;
    /** SoundCheck Score v1.1+ */
    duration?: number;
    transitions?: number;
    feedback: string[];
  }[];
  /** Party songs with more than one singer: the average of everyone's score. */
  group?: { score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'; singers: number } | null;
}

/** Host → member: host actions (kick, mute, volume). */
export interface HostCommandEvent {
  type: 'host_command';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  command: 'mute' | 'unmute' | 'kick' | 'set_volume';
  value?: number;
}

/**
 * Anyone → everyone: the session's song queue (session_queue table) changed; re-read it with
 * session_queue_list. Carries no data, so RLS on the table stays the only gate on what members see.
 */
export interface QueueChangedEvent {
  type: 'queue_changed';
  v: typeof PROTOCOL_VERSION;
}

/** Host → everyone: whether singers' voices should be played through the host's speakers (WebRTC audio). */
export interface VoiceEvent {
  type: 'voice';
  v: typeof PROTOCOL_VERSION;
  enabled: boolean;
}

/**
 * WebRTC signalling for voice monitoring, phone ↔ host only. Media goes peer-to-peer (LAN when possible);
 * only these small offer/answer/ICE messages use the session channel.
 */
export interface RtcEvent {
  type: 'rtc';
  v: typeof PROTOCOL_VERSION;
  memberId: string;            // the phone this conversation is about
  from: 'host' | 'phone';
  sdp?: { type: 'offer' | 'answer'; sdp: string };
  candidate?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
}

/**
 * Host → everyone: the party's singing mode for the song starting. Duet: singers alternate lyric lines, `parts`
 * maps each singer to their half (0 = lines 1, 3, 5…; 1 = lines 2, 4, 6…). Battle: everyone sings it all, head to head.
 */
export interface DuetEvent {
  type: 'duet';
  v: typeof PROTOCOL_VERSION;
  mode: 'duet' | 'battle' | null;
  parts: Record<string, 0 | 1>;
}

/** Phone → host: how loud this singer wants their own voice through the host's speakers (0–2, 1 = as mixed). */
export interface VoiceGainEvent {
  type: 'voice_gain';
  v: typeof PROTOCOL_VERSION;
  memberId: string;
  gain: number;
}

export type SessionEvent =
  | TransportEvent
  | PitchEvent
  | ClockPingEvent
  | ClockPongEvent
  | MicStatusEvent
  | LiveScoreEvent
  | ResultsEvent
  | HostCommandEvent
  | QueueChangedEvent
  | VoiceEvent
  | RtcEvent
  | VoiceGainEvent
  | DuetEvent;

/** Presence payload each device tracks on the channel. */
export interface PresenceState {
  memberId: string;
  displayName: string;
  role: 'host' | 'singer' | 'viewer';
  platform: Platform;
  color: string;
  mic: MicStatusEvent['state'];
}

/** Clock offset (host − phone, ms) and round-trip time from a ping/pong exchange. */
export function clockOffset(p: ClockPongEvent, t3: number): { offsetMs: number; rttMs: number } {
  const rttMs = t3 - p.t0 - (p.t2 - p.t1);
  const offsetMs = (p.t1 - p.t0 + (p.t2 - t3)) / 2;
  return { offsetMs, rttMs };
}

/** Current song position as seen by a phone, given the latest transport event and clock offset. */
export function songPositionAt(ev: TransportEvent, phoneNowMs: number, offsetMs: number): number {
  if (ev.state !== 'playing') return ev.songPos;
  const hostNow = phoneNowMs + offsetMs;
  return ev.songPos + Math.max(0, hostNow - ev.hostClock) / 1000;
}

export function isSessionEvent(x: unknown): x is SessionEvent {
  return typeof x === 'object' && x !== null && 'type' in x && 'v' in x && (x as { v: unknown }).v === PROTOCOL_VERSION;
}

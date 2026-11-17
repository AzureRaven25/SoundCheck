'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FRAME_STRIDE, PROTOCOL_VERSION, type MicStatusEvent, type PresenceState, type ResultsEvent, type SessionEvent, type TransportEvent,
} from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { openSessionChannel, type SessionChannel } from './channel';

export interface Singer {
  memberId: string;
  name: string;
  color: string;
  mic: PresenceState['mic'];
  latencyMs: number | null;
  noiseFloorDb: number | null;
}

/**
 * Host side of SoundCheck Party (runs on the TV / big-screen device).
 * Creates the session, publishes the transport clock, collects each phone's pitch frames, answers
 * clock-sync pings, and broadcasts results. Frames are kept per member in song time.
 */
export function useHostSession(trackId: string, resumeSessionId?: string | null) {
  const [session, setSession] = useState<{ id: string; code: string } | null>(null);
  const [members, setMembers] = useState<PresenceState[]>([]);
  const [status, setStatus] = useState<Record<string, MicStatusEvent>>({});
  const [error, setError] = useState<string | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  const ch = useRef<SessionChannel | null>(null);
  const frames = useRef<Map<string, number[]>>(new Map());
  const lastSeq = useRef<Map<string, number>>(new Map());
  const transport = useRef<TransportEvent | null>(null);
  const rtcHandler = useRef<((e: Extract<SessionEvent, { type: 'rtc' }>) => void) | null>(null);
  const position = useRef<(() => number) | null>(null);

  const onEvent = useCallback((e: SessionEvent) => {
    if (e.type === 'pitch') {
      // drop duplicates / stale retransmits; frames are timestamped in song time, so order isn't critical
      const prev = lastSeq.current.get(e.memberId) ?? -1;
      if (e.seq <= prev) return;
      lastSeq.current.set(e.memberId, e.seq);
      if (e.frames.length % FRAME_STRIDE !== 0) return;
      const arr = frames.current.get(e.memberId) ?? [];
      arr.push(...e.frames);
      frames.current.set(e.memberId, arr);
    } else if (e.type === 'clock_ping') {
      const t1 = Date.now();
      void ch.current?.send({ type: 'clock_pong', v: PROTOCOL_VERSION, memberId: e.memberId, id: e.id, t0: e.t0, t1, t2: Date.now() });
    } else if (e.type === 'mic_status') {
      setStatus((s) => ({ ...s, [e.memberId]: e }));
    } else if (e.type === 'queue_changed') {
      setQueueVersion((v) => v + 1);
    } else if (e.type === 'rtc' && e.from === 'phone') {
      rtcHandler.current?.(e);
    }
  }, []);

  const open = useCallback(async () => {
    setError(null);
    try {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      const name = (user?.user_metadata?.display_name as string | undefined) ?? 'Host';
      let s: { id: string; code: string };
      const resumed = resumeSessionId
        ? (await sb.from('karaoke_sessions').select('id, pairing_code, host_id, status').eq('id', resumeSessionId).maybeSingle()).data
        : null;
      if (resumed && resumed.host_id === user!.id && resumed.status !== 'ended') {
        // next song in the same party: phones stay joined, they just get a transport for the new track
        s = { id: resumed.id, code: resumed.pairing_code };
      } else {
        const { data, error: err } = await sb.rpc('create_session', { p_platform: 'web', p_display_name: name });
        if (err || !data?.[0]) throw err ?? new Error('could not create a session');
        s = { id: data[0].session_id, code: data[0].pairing_code };
      }
      ch.current = await openSessionChannel(s.id, `host-${user!.id}`, onEvent, (ms) => setMembers(ms.filter((m) => m.role !== 'host')));
      await ch.current.track({ memberId: 'host', displayName: name, role: 'host', platform: 'web', color: '#ffffff', mic: 'off' });
      await sb.from('karaoke_sessions').update({ status: 'active', current_track_id: trackId }).eq('id', s.id);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onEvent, trackId, resumeSessionId]);

  // transport heartbeat every 2 s while playing (late joiners; re-anchored to the real playback
  // position so phones follow the audio clock, not the host's wall clock, which drift apart)
  useEffect(() => {
    const iv = setInterval(() => {
      const t = transport.current;
      if (!t || t.state !== 'playing') return;
      const pos = position.current?.();
      const ev = pos == null ? t : { ...t, songPos: pos, hostClock: Date.now() };
      transport.current = ev;
      void ch.current?.send(ev);
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => () => { void ch.current?.close(); }, []);

  const publishTransport = useCallback((state: TransportEvent['state'], songPos: number, keyShift: number, singerIds: string[]) => {
    const ev: TransportEvent = {
      type: 'transport', v: PROTOCOL_VERSION, state, trackId, queueItemId: null, songPos, hostClock: Date.now(), keyShift, singerMemberIds: singerIds,
    };
    transport.current = ev;
    void ch.current?.send(ev);
  }, [trackId]);

  const resetTake = useCallback(() => {
    frames.current = new Map();
    lastSeq.current = new Map();
  }, []);

  const singers = (): Singer[] => members.filter((m) => m.role === 'singer').map((m) => ({
    memberId: m.memberId, name: m.displayName, color: m.color, mic: status[m.memberId]?.state ?? m.mic,
    latencyMs: status[m.memberId]?.latencyMs ?? null, noiseFloorDb: status[m.memberId]?.noiseFloorDb ?? null,
  }));

  /** Where playback really is (seconds); used to re-anchor the heartbeat. */
  const setPositionSource = useCallback((fn: () => number) => { position.current = fn; }, []);
  const sendResults = useCallback((ev: ResultsEvent) => void ch.current?.send(ev), []);
  const send = useCallback((ev: SessionEvent) => void ch.current?.send(ev), []);

  return {
    session, members, singers, error, open, queueVersion,
    setRtcHandler: (fn: ((e: Extract<SessionEvent, { type: 'rtc' }>) => void) | null) => { rtcHandler.current = fn; }, bumpQueue: () => setQueueVersion((v) => v + 1), publishTransport, resetTake, sendResults, send, setPositionSource,
    framesOf: (memberId: string) => frames.current.get(memberId) ?? [],
    allFrames: () => frames.current,
  };
}

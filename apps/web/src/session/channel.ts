'use client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { channelName, isSessionEvent, type PresenceState, type SessionEvent } from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface SessionChannel {
  channel: RealtimeChannel;
  send: (e: SessionEvent) => Promise<void>;
  track: (p: PresenceState) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Join the private Realtime channel `session:<id>` (RLS on realtime.messages admits only the session's
 * host and members). Events follow packages/contracts realtime.ts; anything else is ignored.
 */
export async function openSessionChannel(
  sessionId: string,
  presenceKey: string,
  onEvent: (e: SessionEvent) => void,
  onPresence?: (members: PresenceState[]) => void,
): Promise<SessionChannel> {
  const sb = supabaseBrowser();
  await sb.realtime.setAuth(); // use the signed-in (or anonymous) user's JWT for private-channel authorization
  const channel = sb.channel(channelName(sessionId), {
    config: { private: true, broadcast: { self: false, ack: false }, presence: { key: presenceKey } },
  });
  channel.on('broadcast', { event: 'sc' }, ({ payload }) => {
    if (isSessionEvent(payload)) onEvent(payload);
  });
  if (onPresence) {
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceState>();
      onPresence(Object.values(state).flatMap((metas) => metas.map(({ presence_ref: _ref, ...m }) => m as PresenceState)));
    });
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime connection timed out')), 15000);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(err ?? new Error(status)); }
    });
  });
  return {
    channel,
    send: async (e) => { await channel.send({ type: 'broadcast', event: 'sc', payload: e }); },
    track: async (p) => { await channel.track(p); },
    close: async () => { await sb.removeChannel(channel); },
  };
}

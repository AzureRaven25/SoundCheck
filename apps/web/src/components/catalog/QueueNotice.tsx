'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Status { online: boolean; workers: number; queued: number; running: number; ahead: number | null }

/**
 * Honest wait information for karaoke processing: how many songs are ahead, or that the processing worker is
 * offline right now (jobs wait safely in the queue until it's back).
 */
export function QueueNotice({ jobId, queuedOnly = true }: { jobId?: string | null; queuedOnly?: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void supabaseBrowser().rpc('processing_status', { p_job_id: jobId ?? undefined })
      .then(({ data }) => { if (live && data?.[0]) setS(data[0] as Status); });
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [jobId]);
  if (!s) return null;
  const online = s.online || s.running > 0;
  if (!online) {
    return (
      <p className="mt-2 text-xs text-gold-400" data-testid="queue-notice">
        Karaoke processing is offline right now. Your song is saved in the queue and will be processed automatically when it’s back.
      </p>
    );
  }
  if (queuedOnly && s.ahead != null && s.ahead > 0) {
    return <p className="mt-2 text-xs text-ink-300" data-testid="queue-notice">{s.ahead} song{s.ahead === 1 ? '' : 's'} ahead of yours.</p>;
  }
  return null;
}

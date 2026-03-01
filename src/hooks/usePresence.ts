import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Hook that tracks online presence of users via Supabase Realtime Presence.
 * Returns a Set of user IDs that are currently online.
 */
export const usePresence = (trackSelf = true) => {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let isMounted = true;

    const setup = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isMounted) return;

      const channel = supabase.channel('online-users', {
        config: { presence: { key: user.id } },
      });

      const syncPresence = () => {
        if (!isMounted) return;
        const state = channel.presenceState();
        const ids = new Set<string>(Object.keys(state));
        setOnlineUsers(ids);
      };

      channel
        .on('presence', { event: 'sync' }, syncPresence)
        .on('presence', { event: 'join' }, syncPresence)
        .on('presence', { event: 'leave' }, syncPresence)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && trackSelf) {
            await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
            syncPresence();
          }
        });

      channelRef.current = channel;
    };

    setup();

    return () => {
      isMounted = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [trackSelf]);

  return onlineUsers;
};

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Channel, Message } from '@/types/app';
import { toast } from 'sonner';

export function useChatPersistence() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tenant_id
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setTenantId(data.tenant_id); });
  }, [user]);

  // Load channels and messages
  useEffect(() => {
    if (!tenantId) return;

    const load = async () => {
      const [chRes, msgRes] = await Promise.all([
        supabase.from('chat_channels').select('*').eq('tenant_id', tenantId).order('created_at'),
        supabase.from('chat_messages').select('*, profiles:user_id(name, avatar_url)').eq('tenant_id', tenantId).order('created_at'),
      ]);

      if (chRes.data) {
        setChannels(chRes.data.map(ch => ({
          id: ch.id,
          name: ch.name,
          type: ch.type as 'channel' | 'direct',
          unread: 0,
        })));
      }

      if (msgRes.data) {
        setMessages(msgRes.data.map((m: any) => ({
          id: m.id,
          channelId: m.channel_id,
          userId: m.user_id,
          userName: m.profiles?.name || 'Usuario',
          userAvatar: m.profiles?.avatar_url || '',
          content: m.content,
          timestamp: new Date(m.created_at),
          isOwn: m.user_id === user?.id,
        })));
      }

      // Create default "General" channel if none exist
      if (!chRes.data || chRes.data.length === 0) {
        const { data: newCh } = await supabase.from('chat_channels').insert({
          tenant_id: tenantId,
          name: 'General',
          type: 'channel',
          created_by: user?.id,
        }).select().single();

        if (newCh) {
          setChannels([{ id: newCh.id, name: newCh.name, type: 'channel', unread: 0 }]);
        }
      }

      setLoading(false);
    };

    load();
  }, [tenantId, user?.id]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel('chat-messages-rt')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `tenant_id=eq.${tenantId}`,
      }, async (payload) => {
        const m = payload.new as any;
        if (m.user_id === user?.id) return; // already added optimistically

        const { data: profile } = await supabase
          .from('profiles')
          .select('name, avatar_url')
          .eq('user_id', m.user_id)
          .maybeSingle();

        setMessages(prev => [...prev, {
          id: m.id,
          channelId: m.channel_id,
          userId: m.user_id,
          userName: profile?.name || 'Usuario',
          userAvatar: profile?.avatar_url || '',
          content: m.content,
          timestamp: new Date(m.created_at),
          isOwn: false,
        }]);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_channels',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        const ch = payload.new as any;
        setChannels(prev => {
          if (prev.some(c => c.id === ch.id)) return prev;
          return [...prev, { id: ch.id, name: ch.name, type: ch.type, unread: 0 }];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId, user?.id]);

  const sendMessage = useCallback(async (channelId: string, content: string) => {
    if (!user || !tenantId) return;

    // Get user profile for display
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, avatar_url')
      .eq('user_id', user.id)
      .maybeSingle();

    const tempId = crypto.randomUUID();
    const newMsg: Message = {
      id: tempId,
      channelId,
      userId: user.id,
      userName: profile?.name || 'Tú',
      userAvatar: profile?.avatar_url || '',
      content,
      timestamp: new Date(),
      isOwn: true,
    };

    // Optimistic update
    setMessages(prev => [...prev, newMsg]);

    const { data, error } = await supabase.from('chat_messages').insert({
      tenant_id: tenantId,
      channel_id: channelId,
      user_id: user.id,
      content,
    }).select().single();

    if (error) {
      console.error('Error sending message:', error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast.error('Error al enviar mensaje');
      return null;
    }

    // Replace temp id with real id
    if (data) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: data.id } : m));
    }

    return data;
  }, [user, tenantId]);

  const createChannel = useCallback(async (name: string): Promise<Channel | null> => {
    if (!user || !tenantId) return null;

    const exists = channels.some(c => c.name.toLowerCase() === name.toLowerCase() && c.type === 'channel');
    if (exists) {
      toast.error(`El canal #${name} ya existe`);
      return null;
    }

    const { data, error } = await supabase.from('chat_channels').insert({
      tenant_id: tenantId,
      name,
      type: 'channel',
      created_by: user.id,
    }).select().single();

    if (error) {
      toast.error('Error al crear canal');
      return null;
    }

    const newChannel: Channel = { id: data.id, name: data.name, type: 'channel', unread: 0 };
    setChannels(prev => [...prev, newChannel]);
    toast.success(`Canal #${name} creado`);
    return newChannel;
  }, [user, tenantId, channels]);

  const createDM = useCallback(async (memberName: string, memberId: string): Promise<Channel | null> => {
    if (!user || !tenantId) return null;

    const existing = channels.find(c => c.type === 'direct' && c.name === memberName);
    if (existing) return existing;

    const { data, error } = await supabase.from('chat_channels').insert({
      tenant_id: tenantId,
      name: memberName,
      type: 'direct',
      created_by: user.id,
    }).select().single();

    if (error) {
      toast.error('Error al crear chat directo');
      return null;
    }

    const newDM: Channel = { id: data.id, name: data.name, type: 'direct', unread: 0 };
    setChannels(prev => [...prev, newDM]);
    toast.success(`Chat con ${memberName} creado`);
    return newDM;
  }, [user, tenantId, channels]);

  return { channels, messages, loading, sendMessage, createChannel, createDM };
}

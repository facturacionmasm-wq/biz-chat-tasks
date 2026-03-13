import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Channel, Message } from '@/types/app';
import { toast } from 'sonner';

const resolveTenantId = async (userId: string) => {
  const { data, error } = await supabase.rpc('get_user_tenant_id', { _user_id: userId });
  if (error) {
    console.error('Error resolving tenant for chat:', error);
    return null;
  }
  return data as string | null;
};

export function useChatPersistence() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const ensureTenant = useCallback(async () => {
    if (tenantId) return tenantId;
    if (!user) return null;
    const id = await resolveTenantId(user.id);
    if (id) setTenantId(id);
    return id;
  }, [tenantId, user]);

  useEffect(() => {
    let cancelled = false;

    const loadTenant = async () => {
      if (!user) {
        if (!cancelled) {
          setTenantId(null);
          setChannels([]);
          setMessages([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const id = await resolveTenantId(user.id);

      if (!cancelled) {
        setTenantId(id);
        if (!id) {
          setLoading(false);
          toast.error('No se pudo identificar tu empresa para cargar el chat');
        }
      }
    };

    loadTenant();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tenantId) return;

      const [chRes, msgRes] = await Promise.all([
        supabase.from('chat_channels').select('*').eq('tenant_id', tenantId).order('created_at'),
        supabase.from('chat_messages').select('*, profiles:user_id(name, avatar_url)').eq('tenant_id', tenantId).order('created_at'),
      ]);

      if (chRes.error || msgRes.error) {
        console.error('Error loading chat data:', chRes.error || msgRes.error);
        if (!cancelled) {
          setLoading(false);
          toast.error('No se pudo cargar el chat interno');
        }
        return;
      }

      if (!cancelled) {
        setChannels((chRes.data || []).map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type as 'channel' | 'direct',
          unread: 0,
        })));

        setMessages((msgRes.data || []).map((m: any) => ({
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

      if ((chRes.data || []).length === 0) {
        const { data: newCh, error: channelError } = await supabase
          .from('chat_channels')
          .insert({ tenant_id: tenantId, name: 'General', type: 'channel', created_by: user?.id })
          .select()
          .single();

        if (!channelError && newCh && !cancelled) {
          setChannels([{ id: newCh.id, name: newCh.name, type: 'channel', unread: 0 }]);
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, user?.id]);

  useEffect(() => {
    if (!tenantId) return;

    const realtimeChannel = supabase
      .channel(`chat-messages-rt-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `tenant_id=eq.${tenantId}`,
        },
        async (payload) => {
          const m = payload.new as any;
          if (m.user_id === user?.id) return;

          const { data: profile } = await supabase
            .from('profiles')
            .select('name, avatar_url')
            .eq('user_id', m.user_id)
            .maybeSingle();

          setMessages((prev) => [
            ...prev,
            {
              id: m.id,
              channelId: m.channel_id,
              userId: m.user_id,
              userName: profile?.name || 'Usuario',
              userAvatar: profile?.avatar_url || '',
              content: m.content,
              timestamp: new Date(m.created_at),
              isOwn: false,
            },
          ]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_channels',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const ch = payload.new as any;
          setChannels((prev) => {
            if (prev.some((c) => c.id === ch.id)) return prev;
            return [...prev, { id: ch.id, name: ch.name, type: ch.type, unread: 0 }];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [tenantId, user?.id]);

  const sendMessage = useCallback(async (channelId: string, content: string) => {
    const activeTenantId = await ensureTenant();
    if (!user || !activeTenantId) {
      toast.error('No hay sesión activa para enviar mensajes');
      return null;
    }

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

    setMessages((prev) => [...prev, newMsg]);

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        tenant_id: activeTenantId,
        channel_id: channelId,
        user_id: user.id,
        content,
      })
      .select()
      .single();

    if (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error('Error al enviar mensaje');
      return null;
    }

    if (data) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: data.id } : m)));
    }

    return data;
  }, [ensureTenant, user]);

  const createChannel = useCallback(async (name: string): Promise<Channel | null> => {
    const activeTenantId = await ensureTenant();
    if (!user || !activeTenantId) {
      toast.error('No hay sesión activa para crear canales');
      return null;
    }

    const exists = channels.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.type === 'channel');
    if (exists) {
      toast.error(`El canal #${name} ya existe`);
      return null;
    }

    const { data, error } = await supabase
      .from('chat_channels')
      .insert({ tenant_id: activeTenantId, name, type: 'channel', created_by: user.id })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating channel:', error);
      toast.error('Error al crear canal');
      return null;
    }

    const newChannel: Channel = { id: data.id, name: data.name, type: 'channel', unread: 0 };
    setChannels((prev) => [...prev, newChannel]);
    toast.success(`Canal #${name} creado`);
    return newChannel;
  }, [channels, ensureTenant, user]);

  const createDM = useCallback(async (memberName: string, memberId: string): Promise<Channel | null> => {
    const activeTenantId = await ensureTenant();
    if (!user || !activeTenantId) {
      toast.error('No hay sesión activa para crear chats directos');
      return null;
    }

    const existing = channels.find((c) => c.type === 'direct' && c.name === memberName);
    if (existing) return existing;

    const { data, error } = await supabase
      .from('chat_channels')
      .insert({ tenant_id: activeTenantId, name: memberName, type: 'direct', created_by: user.id })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating direct message channel:', error, memberId);
      toast.error('Error al crear chat directo');
      return null;
    }

    const newDM: Channel = { id: data.id, name: data.name, type: 'direct', unread: 0 };
    setChannels((prev) => [...prev, newDM]);
    toast.success(`Chat con ${memberName} creado`);
    return newDM;
  }, [channels, ensureTenant, user]);

  return { channels, messages, loading, sendMessage, createChannel, createDM };
}

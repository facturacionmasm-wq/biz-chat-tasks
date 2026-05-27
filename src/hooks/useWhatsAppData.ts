import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface DBConversation {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  assigned_user_id: string | null;
  status: string;
  tags: string[] | null;
  notes: string | null;
  last_message_at: string | null;
  tenant_id: string;
  created_at: string;
}

export interface DBMessage {
  id: string;
  conversation_id: string;
  direction: string;
  body: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
  tenant_id: string;
}

export function useWhatsAppData() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<DBConversation[]>([]);
  const [messages, setMessages] = useState<DBMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);

  // Resolve tenant once
  useEffect(() => {
    if (!user) { setTenantId(null); return; }
    let cancelled = false;
    supabase
      .rpc('get_user_tenant_id', { _user_id: user.id })
      .then(({ data }) => {
        if (!cancelled) setTenantId(data);
      })
      .catch(err => console.error('[WA] tenant resolve error:', err));
    return () => { cancelled = true; };
  }, [user]);

  const fetchConversations = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('last_message_at', { ascending: false });
      if (error) throw error;
      if (data) setConversations(data as DBConversation[]);
    } catch (err: any) {
      console.error('[WA] fetchConversations error:', err);
    }
  }, [tenantId]);

  const fetchMessages = useCallback(async (conversationId: string) => {
    activeConvIdRef.current = conversationId;
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (data) setMessages(data as DBMessage[]);
    } catch (err: any) {
      console.error('[WA] fetchMessages error:', err);
      toast.error('Error al cargar mensajes');
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    fetchConversations().finally(() => setLoading(false));
  }, [tenantId, fetchConversations]);

  // Realtime subscriptions — SINGLE channel with proper cleanup
  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`whatsapp-realtime-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_conversations',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
        },
        (payload) => {
          const newMsg = payload.new as DBMessage;

          // Only add if it belongs to the conversation we're currently viewing
          if (newMsg.conversation_id === activeConvIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }

          // Always refresh conversation list to update last_message_at
          fetchConversations();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[WA] Realtime channel error — will retry');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, fetchConversations]);

  // Send a WhatsApp message via Edge Function
  const sendMessage = useCallback(async (
    conversationId: string,
    contactPhone: string,
    body: string,
  ): Promise<boolean> => {
    if (!tenantId) return false;
    try {
      const { error } = await supabase.functions.invoke('twilio-send', {
        body: {
          to: contactPhone,
          body,
          conversation_id: conversationId,
          tenant_id: tenantId,
        },
      });
      if (error) throw error;
      return true;
    } catch (err: any) {
      console.error('[WA] sendMessage error:', err);
      toast.error('Error al enviar mensaje');
      return false;
    }
  }, [tenantId]);

  return {
    conversations,
    messages,
    loading,
    tenantId,
    fetchConversations,
    fetchMessages,
    sendMessage,
    setMessages,
    setConversations,
  };
}

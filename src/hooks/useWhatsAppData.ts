import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [conversations, setConversations] = useState<DBConversation[]>([]);
  const [messages, setMessages] = useState<DBMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const activeConvIdRef = useRef<string | null>(null);


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

  const PAGE_SIZE = 50;
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const fetchMessages = useCallback(async (conversationId: string) => {
    activeConvIdRef.current = conversationId;
    try {
      // Fetch the most recent PAGE_SIZE messages using the (conversation_id, created_at DESC) index,
      // then reverse client-side so the UI keeps the ascending order it expects.
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      const rows = (data || []) as DBMessage[];
      setHasMoreMessages(rows.length === PAGE_SIZE);
      setMessages(rows.slice().reverse());
    } catch (err: any) {
      console.error('[WA] fetchMessages error:', err);
      toast.error('Error al cargar mensajes');
    }
  }, []);

  const loadOlderMessages = useCallback(async (conversationId: string) => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      // Snapshot oldest currently-loaded message for this conversation.
      let oldestCreatedAt: string | null = null;
      setMessages(prev => {
        const forConv = prev.filter(m => m.conversation_id === conversationId);
        oldestCreatedAt = forConv.length > 0 ? forConv[0].created_at : null;
        return prev;
      });
      if (!oldestCreatedAt) { setLoadingOlder(false); return; }

      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('created_at', oldestCreatedAt)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      const older = (data || []) as DBMessage[];
      setHasMoreMessages(older.length === PAGE_SIZE);
      if (older.length > 0) {
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          const merged = [...older.slice().reverse().filter(m => !seen.has(m.id)), ...prev];
          return merged;
        });
      }
    } catch (err: any) {
      console.error('[WA] loadOlderMessages error:', err);
      toast.error('Error al cargar mensajes anteriores');
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder]);

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
          // Invalidate dashboards that count open conversations
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats', tenantId] });
          queryClient.invalidateQueries({ queryKey: ['analytics', tenantId] });
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
          // Invalidate analytics (message counts)
          queryClient.invalidateQueries({ queryKey: ['analytics', tenantId] });
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
  }, [tenantId, fetchConversations, queryClient]);

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
    loadOlderMessages,
    hasMoreMessages,
    loadingOlder,
    sendMessage,
    setMessages,
    setConversations,
  };
}

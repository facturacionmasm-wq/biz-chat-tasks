import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

const DEMO_TENANT = '00000000-0000-0000-0000-000000000001';

export function useWhatsAppData() {
  const [conversations, setConversations] = useState<DBConversation[]>([]);
  const [messages, setMessages] = useState<DBMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .order('last_message_at', { ascending: false });
    if (data) setConversations(data as DBConversation[]);
  }, []);

  const fetchMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as DBMessage[]);
  }, []);

  // Initial load
  useEffect(() => {
    fetchConversations().finally(() => setLoading(false));
  }, [fetchConversations]);

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('whatsapp-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, () => {
        fetchConversations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        const newMsg = payload.new as DBMessage;
        setMessages(prev => {
          // Only add if it belongs to a conversation we're viewing
          if (prev.length > 0 && prev[0].conversation_id === newMsg.conversation_id) {
            // Avoid duplicates
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          }
          // If no messages loaded or different conversation, add anyway for fresh fetch
          return [...prev, newMsg];
        });
        // Also refresh conversations to update last_message_at
        fetchConversations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchConversations]);

  return { conversations, messages, loading, fetchConversations, fetchMessages, setMessages, setConversations, DEMO_TENANT };
}

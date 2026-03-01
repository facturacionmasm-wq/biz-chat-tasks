import { useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
};

const ASSISTANT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;

export function useAIAssistant() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const location = useLocation();
  const { userRole } = useAuth();

  const getPageLabel = () => {
    const path = location.pathname;
    const labels: Record<string, string> = {
      '/': 'Dashboard',
      '/calls': 'Llamadas',
      '/whatsapp': 'WhatsApp Inbox',
      '/appointments': 'Agenda',
      '/chat': 'Chat Interno',
      '/calendar': 'Calendario',
      '/projects': 'Proyectos',
      '/knowledge': 'Knowledge Hub',
      '/okrs': 'OKRs',
      '/ai-training': 'Entrenamiento IA',
      '/expenses': 'Gastos',
      '/credentials': 'Credenciales',
      '/integrations': 'Integraciones',
      '/audit': 'Auditoría',
      '/settings': 'Configuración',
    };
    return labels[path] || path;
  };

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('assistant_conversations' as any)
      .select('id, title, created_at')
      .order('updated_at', { ascending: false })
      .limit(20);
    if (data) setConversations(data as any);
  }, []);

  const loadConversation = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('assistant_messages' as any)
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages((data as any[]).map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at),
      })));
      setActiveConversationId(convId);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setActiveConversationId(null);
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    if (!input.trim() || isLoading) return;

    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    let conversationId = activeConversationId;

    try {
      // Create conversation if needed
      if (!conversationId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
          .maybeSingle();

        if (!profile) throw new Error('Perfil no encontrado');

        const { data: conv, error } = await supabase
          .from('assistant_conversations' as any)
          .insert({
            user_id: (await supabase.auth.getUser()).data.user!.id,
            tenant_id: profile.tenant_id,
            title: input.trim().substring(0, 60),
          })
          .select('id')
          .single();
        if (error) throw error;
        conversationId = (conv as any).id;
        setActiveConversationId(conversationId);
      }

      // Save user message to DB
      await supabase.from('assistant_messages' as any).insert({
        conversation_id: conversationId,
        role: 'user',
        content: input.trim(),
      });

      // Build message history for AI
      const aiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('No autenticado');

      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(ASSISTANT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: aiMessages,
          currentPage: getPageLabel(),
          userRole,
          conversationId,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(errData.error || `Error ${resp.status}`);
      }

      if (!resp.body) throw new Error('No response body');

      // Stream response
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let assistantContent = '';
      let streamDone = false;

      const assistantId = crypto.randomUUID();

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && last.id === assistantId) {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { id: assistantId, role: 'assistant', content: assistantContent, timestamp: new Date() }];
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m));
            }
          } catch { /* ignore */ }
        }
      }

      // Save assistant message to DB
      if (assistantContent && conversationId) {
        await supabase.from('assistant_messages' as any).insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: assistantContent,
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('AI Assistant error:', err);
      toast.error(err.message || 'Error al comunicarse con el asistente');
      // Remove the user message if failed
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages, activeConversationId, isLoading, userRole, location.pathname]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const deleteConversation = useCallback(async (convId: string) => {
    await supabase.from('assistant_conversations' as any).delete().eq('id', convId);
    if (activeConversationId === convId) {
      startNewConversation();
    }
    setConversations(prev => prev.filter(c => c.id !== convId));
  }, [activeConversationId, startNewConversation]);

  return {
    messages,
    isLoading,
    conversations,
    activeConversationId,
    sendMessage,
    stopGeneration,
    loadConversations,
    loadConversation,
    startNewConversation,
    deleteConversation,
  };
}

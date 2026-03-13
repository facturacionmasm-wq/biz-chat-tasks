import { useState, useCallback, useEffect, useMemo } from 'react';
import ChatSidebar from '@/components/ChatSidebar';
import ChatArea from '@/components/ChatArea';
import { Channel, TeamMember } from '@/types/app';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePresenceContext } from '@/contexts/PresenceContext';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useChatPersistence } from '@/hooks/useChatPersistence';

type MemberDirectoryItem = Omit<TeamMember, 'status'>;

const ChatPage = () => {
  const { channels: allChannels, messages: allMessages, loading, sendMessage, createChannel, createDM } = useChatPersistence();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [memberDirectory, setMemberDirectory] = useState<MemberDirectoryItem[]>([]);
  const isMobile = useIsMobile();
  const { onlineUsers } = usePresenceContext();
  const { user } = useAuth();

  // Set default active channel when channels load
  useEffect(() => {
    if (!activeChannelId && allChannels.length > 0) {
      setActiveChannelId(allChannels[0].id);
    }
  }, [allChannels, activeChannelId]);

  const teamMembers = useMemo<TeamMember[]>(() => {
    return memberDirectory.map(member => ({
      ...member,
      status: onlineUsers.has(member.id) ? 'online' : 'offline',
    }));
  }, [memberDirectory, onlineUsers]);

  // Fetch real employees from profiles table
  useEffect(() => {
    const fetchProfiles = async () => {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase.from('profiles').select('user_id, name, avatar_url, status, email, phone, whatsapp_number').eq('status', 'active'),
        supabase.from('user_roles').select('user_id, role'),
      ]);

      if (profilesRes.error) { console.error('Error fetching profiles:', profilesRes.error); return; }

      const roleMap: Record<string, string> = {};
      if (rolesRes.data) {
        rolesRes.data.forEach(r => {
          const label = r.role === 'super_admin' ? 'Super Admin' : r.role === 'owner' ? 'Owner' : r.role === 'admin' ? 'Admin' : 'Member';
          roleMap[r.user_id] = label;
        });
      }

      if (profilesRes.data && profilesRes.data.length > 0) {
        const members: MemberDirectoryItem[] = profilesRes.data.map(p => ({
          id: p.user_id, name: p.name, avatar: p.avatar_url || '', role: roleMap[p.user_id] || 'Member',
          email: p.email || undefined, phone: p.phone || undefined, whatsappNumber: p.whatsapp_number || undefined,
        }));
        setMemberDirectory(members);
      }
    };
    fetchProfiles();
  }, []);

  // Track channel members
  const [channelMembers, setChannelMembers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (memberDirectory.length > 0) {
      setChannelMembers(prev => {
        const map: Record<string, string[]> = { ...prev };
        allChannels.forEach(ch => {
          if (ch.type === 'channel' && !map[ch.id]) {
            map[ch.id] = memberDirectory.map(m => m.id);
          }
        });
        return map;
      });
    }
  }, [memberDirectory, allChannels]);

  const activeChannel = allChannels.find(c => c.id === activeChannelId) || allChannels[0];
  const channelMessages = allMessages.filter(m => m.channelId === activeChannelId);

  const notifyOfflineRecipient = useCallback(async (recipient: TeamMember, content: string) => {
    const to = recipient.whatsappNumber || recipient.phone;
    if (!to) return false;
    const message = `🔔 Nuevo mensaje en Chat Interno\n\n${content}\n\nAbre la app para responder.`;
    const { data, error } = await supabase.functions.invoke('twilio-send', { body: { to, body: message } });
    if (error || !data?.ok) return false;
    return true;
  }, []);

  const resolveDirectRecipient = useCallback((channel: Channel) => {
    if (channel.type !== 'direct') return null;
    const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rawId = channel.id.startsWith('dm-') ? channel.id.replace('dm-', '') : '';
    return (
      teamMembers.find(m => m.id === rawId) ||
      teamMembers.find(m => m.name === channel.name) ||
      teamMembers.find(m => { if (!rawId) return false; const n = normalize(m.name).replace(/\s+/g, '-'); return n.includes(normalize(rawId)); }) ||
      null
    );
  }, [teamMembers]);

  const handleSendMessage = async (content: string) => {
    if (!activeChannelId) return;
    await sendMessage(activeChannelId, content);

    // DM offline notification
    if (activeChannel?.type === 'direct') {
      const recipient = resolveDirectRecipient(activeChannel);
      if (recipient && recipient.status !== 'online') {
        const sent = await notifyOfflineRecipient(recipient, content);
        if (sent) toast.info(`Se notificó por WhatsApp a ${recipient.name}`);
      }
      return;
    }

    // Channel offline notification
    if (activeChannel?.type === 'channel') {
      const memberIds = channelMembers[activeChannelId] || [];
      const offlineRecipients = teamMembers.filter(m => memberIds.includes(m.id) && m.id !== user?.id && m.status !== 'online');
      if (offlineRecipients.length > 0) {
        const results = await Promise.all(offlineRecipients.map(r => notifyOfflineRecipient(r, content)));
        const notified = results.filter(Boolean).length;
        if (notified > 0) toast.info(`Notificación enviada a ${notified} usuario(s) offline por WhatsApp`);
      }
    }
  };

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id);
    if (isMobile) setShowChat(true);
  };

  const handleCreateChannel = useCallback(async (name: string) => {
    const ch = await createChannel(name);
    if (ch) {
      setActiveChannelId(ch.id);
      if (isMobile) setShowChat(true);
    }
  }, [createChannel, isMobile]);

  const handleCreateDM = useCallback(async (memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    if (!member) return;
    const ch = await createDM(member.name, memberId);
    if (ch) {
      setActiveChannelId(ch.id);
      if (isMobile) setShowChat(true);
    }
  }, [teamMembers, createDM, isMobile]);

  const handleAddMember = useCallback((memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    setChannelMembers(prev => ({
      ...prev,
      [activeChannelId!]: Array.from(new Set([...(prev[activeChannelId!] || []), memberId])),
    }));
    toast.success(`${member?.name || 'Miembro'} agregado al canal`);
  }, [activeChannelId, teamMembers]);

  const handleRemoveMember = useCallback((memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    setChannelMembers(prev => ({
      ...prev,
      [activeChannelId!]: (prev[activeChannelId!] || []).filter(id => id !== memberId),
    }));
    toast.info(`${member?.name || 'Miembro'} removido del canal`);
  }, [activeChannelId, teamMembers]);

  if (loading || !activeChannel) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Cargando chat...</div>;
  }

  if (isMobile) {
    if (showChat) {
      return (
        <div className="flex flex-col h-full">
          <div className="shrink-0 h-10 flex items-center px-3 border-b border-border bg-card">
            <button onClick={() => setShowChat(false)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft size={16} /> Canales
            </button>
            <span className="ml-2 text-sm font-medium text-foreground">#{activeChannel.name}</span>
          </div>
          <div className="flex-1 min-w-0">
            <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} teamMembers={teamMembers}
              channelMembers={channelMembers[activeChannelId!] || []} onAddMember={handleAddMember} onRemoveMember={handleRemoveMember} />
          </div>
        </div>
      );
    }
    return (
      <div className="h-full">
        <ChatSidebar channels={allChannels} activeChannelId={activeChannelId || ''} onSelectChannel={handleSelectChannel}
          teamMembers={teamMembers} onCreateChannel={handleCreateChannel} onCreateDM={handleCreateDM} />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ChatSidebar channels={allChannels} activeChannelId={activeChannelId || ''} onSelectChannel={handleSelectChannel}
        teamMembers={teamMembers} onCreateChannel={handleCreateChannel} onCreateDM={handleCreateDM} />
      <div className="flex-1 min-w-0">
        <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} teamMembers={teamMembers}
          channelMembers={channelMembers[activeChannelId!] || []} onAddMember={handleAddMember} onRemoveMember={handleRemoveMember} />
      </div>
    </div>
  );
};

export default ChatPage;

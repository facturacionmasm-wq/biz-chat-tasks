import { useState, useCallback, useEffect } from 'react';
import ChatSidebar from '@/components/ChatSidebar';
import ChatArea from '@/components/ChatArea';
import { channels as initialChannels, messages as initialMessages } from '@/data/mockData';
import { Channel, Message, TeamMember } from '@/types/app';
import { useIsMobile } from '@/hooks/use-mobile';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ChatPage = () => {
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [allMessages, setAllMessages] = useState<Message[]>(initialMessages);
  const [allChannels, setAllChannels] = useState<Channel[]>(initialChannels);
  const [showChat, setShowChat] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const isMobile = useIsMobile();

  // Fetch real employees from profiles table
  useEffect(() => {
    const fetchProfiles = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      const [profilesRes, rolesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, name, avatar_url, status, email')
          .eq('status', 'active'),
        supabase
          .from('user_roles')
          .select('user_id, role'),
      ]);

      if (profilesRes.error) {
        console.error('Error fetching profiles:', profilesRes.error);
        return;
      }

      const roleMap: Record<string, string> = {};
      if (rolesRes.data) {
        rolesRes.data.forEach(r => {
          const label = r.role === 'super_admin' ? 'Super Admin'
            : r.role === 'owner' ? 'Owner'
            : r.role === 'admin' ? 'Admin'
            : 'Member';
          roleMap[r.user_id] = label;
        });
      }

      if (profilesRes.data && profilesRes.data.length > 0) {
        const members: TeamMember[] = profilesRes.data.map(p => ({
          id: p.user_id,
          name: p.name,
          avatar: p.avatar_url || '',
          role: roleMap[p.user_id] || 'Member',
          status: (currentUser && p.user_id === currentUser.id ? 'online' : 'offline') as 'online' | 'away' | 'offline',
          email: p.email || undefined,
        }));
        setTeamMembers(members);
      }
    };

    fetchProfiles();
  }, []);

  // Track channel members: channelId -> array of member IDs
  const [channelMembers, setChannelMembers] = useState<Record<string, string[]>>({});

  // Initialize channel members when teamMembers load
  useEffect(() => {
    if (teamMembers.length > 0) {
      setChannelMembers(prev => {
        const map: Record<string, string[]> = { ...prev };
        allChannels.forEach(ch => {
          if (ch.type === 'channel' && !map[ch.id]) {
            map[ch.id] = teamMembers.map(m => m.id);
          }
        });
        return map;
      });
    }
  }, [teamMembers]);

  const activeChannel = allChannels.find(c => c.id === activeChannelId) || allChannels[0];
  const channelMessages = allMessages.filter(m => m.channelId === activeChannelId);

  const handleSendMessage = (content: string) => {
    const newMsg: Message = {
      id: Date.now().toString(), channelId: activeChannelId, userId: '0', userName: 'Tú', userAvatar: '', content, timestamp: new Date(), isOwn: true,
    };
    setAllMessages(prev => [...prev, newMsg]);
  };

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id);
    if (isMobile) setShowChat(true);
  };

  const handleCreateChannel = useCallback((name: string) => {
    const exists = allChannels.some(c => c.name === name && c.type === 'channel');
    if (exists) {
      toast.error(`El canal #${name} ya existe`);
      return;
    }
    const newChannel: Channel = {
      id: `ch-${Date.now()}`,
      name,
      type: 'channel',
      unread: 0,
    };
    setAllChannels(prev => [...prev, newChannel]);
    setChannelMembers(prev => ({ ...prev, [newChannel.id]: teamMembers.map(m => m.id) }));
    setActiveChannelId(newChannel.id);
    if (isMobile) setShowChat(true);
    toast.success(`Canal #${name} creado`);
  }, [allChannels, isMobile]);

  const handleCreateDM = useCallback((memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    if (!member) return;
    const existing = allChannels.find(c => c.type === 'direct' && c.name === member.name);
    if (existing) {
      setActiveChannelId(existing.id);
      if (isMobile) setShowChat(true);
      return;
    }
    const newDM: Channel = {
      id: `dm-${memberId}`,
      name: member.name,
      type: 'direct',
      unread: 0,
    };
    setAllChannels(prev => [...prev, newDM]);
    setActiveChannelId(newDM.id);
    if (isMobile) setShowChat(true);
    toast.success(`Chat con ${member.name} creado`);
  }, [allChannels, isMobile]);

  const handleAddMember = useCallback((memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    setChannelMembers(prev => ({
      ...prev,
      [activeChannelId]: [...(prev[activeChannelId] || []), memberId],
    }));
    toast.success(`${member?.name || 'Miembro'} agregado al canal`);
  }, [activeChannelId]);

  const handleRemoveMember = useCallback((memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    setChannelMembers(prev => ({
      ...prev,
      [activeChannelId]: (prev[activeChannelId] || []).filter(id => id !== memberId),
    }));
    toast.info(`${member?.name || 'Miembro'} removido del canal`);
  }, [activeChannelId]);

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
            <ChatArea
              channel={activeChannel}
              messages={channelMessages}
              onSendMessage={handleSendMessage}
              teamMembers={teamMembers}
              channelMembers={channelMembers[activeChannelId] || []}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="h-full">
        <ChatSidebar
          channels={allChannels}
          activeChannelId={activeChannelId}
          onSelectChannel={handleSelectChannel}
          teamMembers={teamMembers}
          onCreateChannel={handleCreateChannel}
          onCreateDM={handleCreateDM}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ChatSidebar
        channels={allChannels}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        teamMembers={teamMembers}
        onCreateChannel={handleCreateChannel}
        onCreateDM={handleCreateDM}
      />
      <div className="flex-1 min-w-0">
        <ChatArea
          channel={activeChannel}
          messages={channelMessages}
          onSendMessage={handleSendMessage}
          teamMembers={teamMembers}
          channelMembers={channelMembers[activeChannelId] || []}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
        />
      </div>
    </div>
  );
};

export default ChatPage;

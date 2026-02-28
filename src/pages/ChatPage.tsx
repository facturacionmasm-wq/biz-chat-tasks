import { useState } from 'react';
import AppSidebar from '@/components/ChatSidebar';
import ChatArea from '@/components/ChatArea';
import { channels as initialChannels, messages as initialMessages, teamMembers } from '@/data/mockData';
import { Message } from '@/types/app';
import { useIsMobile } from '@/hooks/use-mobile';
import { ArrowLeft } from 'lucide-react';

const ChatPage = () => {
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [allMessages, setAllMessages] = useState<Message[]>(initialMessages);
  const [showChat, setShowChat] = useState(false);
  const isMobile = useIsMobile();

  const activeChannel = initialChannels.find(c => c.id === activeChannelId) || initialChannels[0];
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
            <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} />
          </div>
        </div>
      );
    }
    return (
      <div className="h-full">
        <AppSidebar channels={initialChannels} activeChannelId={activeChannelId} onSelectChannel={handleSelectChannel} teamMembers={teamMembers} />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <AppSidebar channels={initialChannels} activeChannelId={activeChannelId} onSelectChannel={handleSelectChannel} teamMembers={teamMembers} />
      <div className="flex-1 min-w-0">
        <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} />
      </div>
    </div>
  );
};

export default ChatPage;

import { useState } from 'react';
import AppSidebar from '@/components/ChatSidebar';
import ChatArea from '@/components/ChatArea';
import { channels as initialChannels, messages as initialMessages, teamMembers } from '@/data/mockData';
import { Message } from '@/types/app';

const ChatPage = () => {
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [allMessages, setAllMessages] = useState<Message[]>(initialMessages);

  const activeChannel = initialChannels.find(c => c.id === activeChannelId) || initialChannels[0];
  const channelMessages = allMessages.filter(m => m.channelId === activeChannelId);

  const handleSendMessage = (content: string) => {
    const newMsg: Message = {
      id: Date.now().toString(),
      channelId: activeChannelId,
      userId: '0',
      userName: 'Tú',
      userAvatar: '',
      content,
      timestamp: new Date(),
      isOwn: true,
    };
    setAllMessages(prev => [...prev, newMsg]);
  };

  return (
    <div className="flex h-full">
      <AppSidebar
        channels={initialChannels}
        activeChannelId={activeChannelId}
        onSelectChannel={setActiveChannelId}
        teamMembers={teamMembers}
      />
      <div className="flex-1 min-w-0">
        <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} />
      </div>
    </div>
  );
};

export default ChatPage;

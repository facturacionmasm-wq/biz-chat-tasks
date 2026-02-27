import { useState } from 'react';
import { MessageSquare, LayoutGrid } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import ChatArea from '@/components/ChatArea';
import TaskBoard from '@/components/TaskBoard';
import { channels as initialChannels, messages as initialMessages, tasks as initialTasks, teamMembers } from '@/data/mockData';
import { Message, Task } from '@/types/app';

const Index = () => {
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [activeView, setActiveView] = useState<'chat' | 'tasks'>('chat');
  const [allMessages, setAllMessages] = useState<Message[]>(initialMessages);
  const [allTasks, setAllTasks] = useState<Task[]>(initialTasks);

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

  const handleUpdateTask = (id: string, status: Task['status']) => {
    setAllTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar
        channels={initialChannels}
        activeChannelId={activeChannelId}
        onSelectChannel={setActiveChannelId}
        teamMembers={teamMembers}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View Toggle */}
        <div className="h-10 shrink-0 bg-card border-b border-border flex items-center px-2 gap-1">
          <button
            onClick={() => setActiveView('chat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeView === 'chat'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <MessageSquare size={15} />
            Chat
          </button>
          <button
            onClick={() => setActiveView('tasks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeView === 'tasks'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <LayoutGrid size={15} />
            Tareas
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {activeView === 'chat' ? (
            <ChatArea channel={activeChannel} messages={channelMessages} onSendMessage={handleSendMessage} />
          ) : (
            <TaskBoard tasks={allTasks} onUpdateTask={handleUpdateTask} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;

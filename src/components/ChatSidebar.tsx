import { Hash, MessageCircle, ChevronDown, Plus, Search } from 'lucide-react';
import { Channel, TeamMember } from '@/types/app';

interface ChatSidebarProps {
  channels: Channel[];
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  teamMembers: TeamMember[];
}

const statusColor: Record<string, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  offline: 'bg-muted-foreground/40',
};

const ChatSidebar = ({ channels, activeChannelId, onSelectChannel, teamMembers }: ChatSidebarProps) => {
  const channelList = channels.filter(c => c.type === 'channel');
  const directList = channels.filter(c => c.type === 'direct');

  return (
    <aside className="w-56 shrink-0 bg-card border-r border-border flex flex-col h-full">
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-secondary rounded-md px-3 py-1.5 text-muted-foreground text-sm">
          <Search size={14} />
          <span>Buscar mensajes...</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Canales
            </span>
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {channelList.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                activeChannelId === ch.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Hash size={14} className="shrink-0 opacity-60" />
              <span className="truncate">{ch.name}</span>
              {ch.unread > 0 && (
                <span className="ml-auto bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Directos
            </span>
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {directList.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                activeChannelId === ch.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <MessageCircle size={14} className="shrink-0 opacity-60" />
              <span className="truncate">{ch.name}</span>
              {ch.unread > 0 && (
                <span className="ml-auto bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-2 flex items-center gap-1 mb-1">
            <ChevronDown size={12} /> En línea
          </span>
          {teamMembers.filter(m => m.status === 'online').map(member => (
            <div key={member.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-medium text-secondary-foreground">
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${statusColor[member.status]}`} />
              </div>
              <span className="truncate text-xs">{member.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default ChatSidebar;

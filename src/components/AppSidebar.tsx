import { Hash, MessageCircle, ChevronDown, Plus, Search, Settings } from 'lucide-react';
import { Channel } from '@/types/app';
import { TeamMember } from '@/types/app';

interface AppSidebarProps {
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

const AppSidebar = ({ channels, activeChannelId, onSelectChannel, teamMembers }: AppSidebarProps) => {
  const channelList = channels.filter(c => c.type === 'channel');
  const directList = channels.filter(c => c.type === 'direct');

  return (
    <aside className="w-64 shrink-0 bg-sidebar-custom-bg flex flex-col h-full">
      {/* Header */}
      <div className="px-4 h-14 flex items-center justify-between border-b border-sidebar-custom-border">
        <h1 className="text-sidebar-custom-fg-bright font-bold text-lg tracking-tight">TeamFlow</h1>
        <button className="text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright transition-colors">
          <Settings size={18} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-sidebar-custom-hover rounded-md px-3 py-1.5 text-sidebar-custom-muted text-sm">
          <Search size={14} />
          <span>Buscar...</span>
        </div>
      </div>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-sidebar-custom-muted font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Canales
            </span>
            <button className="text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {channelList.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                activeChannelId === ch.id
                  ? 'bg-sidebar-custom-active/20 text-sidebar-custom-fg-bright'
                  : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
              }`}
            >
              <Hash size={15} className="shrink-0 opacity-60" />
              <span className="truncate">{ch.name}</span>
              {ch.unread > 0 && (
                <span className="ml-auto bg-sidebar-custom-active text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Direct Messages */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-sidebar-custom-muted font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Mensajes Directos
            </span>
            <button className="text-sidebar-custom-muted hover:text-sidebar-custom-fg-bright transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {directList.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                activeChannelId === ch.id
                  ? 'bg-sidebar-custom-active/20 text-sidebar-custom-fg-bright'
                  : 'text-sidebar-custom-fg hover:bg-sidebar-custom-hover hover:text-sidebar-custom-fg-bright'
              }`}
            >
              <MessageCircle size={15} className="shrink-0 opacity-60" />
              <span className="truncate">{ch.name}</span>
              {ch.unread > 0 && (
                <span className="ml-auto bg-sidebar-custom-active text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Team Members */}
        <div>
          <span className="text-xs uppercase tracking-wider text-sidebar-custom-muted font-semibold px-2 flex items-center gap-1 mb-1">
            <ChevronDown size={12} /> Equipo
          </span>
          {teamMembers.map(member => (
            <div
              key={member.id}
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-sidebar-custom-fg"
            >
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-sidebar-custom-hover flex items-center justify-center text-xs font-medium text-sidebar-custom-fg-bright">
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-sidebar-custom-bg ${statusColor[member.status]}`} />
              </div>
              <span className="truncate">{member.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;

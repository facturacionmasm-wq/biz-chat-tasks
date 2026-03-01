import { useState } from 'react';
import { Hash, MessageCircle, ChevronDown, Plus, Search, X, Users } from 'lucide-react';
import { Channel, TeamMember } from '@/types/app';

interface ChatSidebarProps {
  channels: Channel[];
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  teamMembers: TeamMember[];
  onCreateChannel?: (name: string) => void;
  onCreateDM?: (memberId: string) => void;
}

const statusColor: Record<string, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  offline: 'bg-muted-foreground/40',
};

const ChatSidebar = ({ channels, activeChannelId, onSelectChannel, teamMembers, onCreateChannel, onCreateDM }: ChatSidebarProps) => {
  const channelList = channels.filter(c => c.type === 'channel');
  const directList = channels.filter(c => c.type === 'direct');

  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleCreateChannel = () => {
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!name) return;
    onCreateChannel?.(name);
    setNewChannelName('');
    setShowNewChannel(false);
  };

  const handleSelectDM = (member: TeamMember) => {
    // Check if DM already exists
    const existing = directList.find(c => c.name === member.name);
    if (existing) {
      onSelectChannel(existing.id);
    } else {
      onCreateDM?.(member.id);
    }
    setShowNewDM(false);
  };

  const filteredMembers = teamMembers.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-full sm:w-56 shrink-0 bg-card border-r border-border flex flex-col h-full">
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-secondary rounded-md px-3 py-1.5 text-muted-foreground text-sm">
          <Search size={14} />
          <span>Buscar mensajes...</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
        {/* Channels */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Canales
            </span>
            <button
              onClick={() => setShowNewChannel(!showNewChannel)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Crear canal"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* New channel input */}
          {showNewChannel && (
            <div className="mx-2 mb-2 bg-secondary rounded-lg p-2 animate-in slide-in-from-top-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Nuevo canal</p>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-sm">#</span>
                <input
                  autoFocus
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateChannel()}
                  placeholder="nombre-canal"
                  className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="flex justify-end gap-1.5 mt-2">
                <button onClick={() => setShowNewChannel(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
                  Cancelar
                </button>
                <button
                  onClick={handleCreateChannel}
                  disabled={!newChannelName.trim()}
                  className="text-xs bg-primary text-primary-foreground rounded px-2.5 py-1 font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Crear
                </button>
              </div>
            </div>
          )}

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

        {/* Direct Messages */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <ChevronDown size={12} /> Directos
            </span>
            <button
              onClick={() => { setShowNewDM(!showNewDM); setSearchQuery(''); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Nuevo mensaje directo"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* New DM picker */}
          {showNewDM && (
            <div className="mx-2 mb-2 bg-secondary rounded-lg p-2 animate-in slide-in-from-top-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Nuevo mensaje directo</p>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar miembro..."
                className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary mb-1.5"
              />
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {filteredMembers.map(member => (
                  <button
                    key={member.id}
                    onClick={() => handleSelectDM(member)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-card transition-colors"
                  >
                    <div className="relative">
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-secondary ${statusColor[member.status]}`} />
                    </div>
                    <span className="truncate">{member.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{member.role}</span>
                  </button>
                ))}
                {filteredMembers.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-2">Sin resultados</p>
                )}
              </div>
              <button onClick={() => setShowNewDM(false)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-1.5 py-1">
                Cancelar
              </button>
            </div>
          )}

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

        {/* Online members */}
        <div>
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-2 flex items-center gap-1 mb-1">
            <ChevronDown size={12} /> En línea
          </span>
          {teamMembers.filter(m => m.status === 'online').map(member => (
            <button
              key={member.id}
              onClick={() => handleSelectDM(member)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary rounded-md transition-colors"
            >
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-medium text-secondary-foreground">
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${statusColor[member.status]}`} />
              </div>
              <span className="truncate text-xs">{member.name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default ChatSidebar;

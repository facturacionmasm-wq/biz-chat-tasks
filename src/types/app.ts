export interface Channel {
  id: string;
  name: string;
  type: 'channel' | 'direct';
  unread: number;
  icon?: string;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  assigneeAvatar: string;
  dueDate?: Date;
  channelId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  status: 'online' | 'away' | 'offline';
}

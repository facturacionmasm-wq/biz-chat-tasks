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
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  assigneeAvatar: string;
  dueDate?: Date;
  channelId?: string;
  projectId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  status: 'online' | 'away' | 'offline';
  email?: string;
}

export interface Milestone {
  id: string;
  name: string;
  date: Date;
  completed: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'active' | 'completed' | 'on_hold';
  progress: number;
  teamIds: string[];
  startDate: Date;
  endDate: Date;
  milestones: Milestone[];
}

export interface KeyResult {
  id: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  progress: number;
}

export interface OKR {
  id: string;
  title: string;
  owner: string;
  period: string;
  priority: 'low' | 'medium' | 'high';
  progress: number;
  projectId?: string;
  keyResults: KeyResult[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  endDate?: Date;
  type: 'meeting' | 'deadline' | 'milestone' | 'event' | 'presentation';
  projectId?: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  createdAt: Date;
  updatedAt: Date;
  isPublic: boolean;
}

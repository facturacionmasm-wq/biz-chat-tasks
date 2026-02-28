export interface CallRecord {
  id: string;
  externalCallId: string;
  fromNumber: string;
  toNumber: string;
  startedAt: Date;
  endedAt: Date;
  duration: number;
  status: 'completed' | 'in_progress' | 'missed' | 'busy' | 'voicemail' | 'failed' | 'pending' | 'initiated' | 'ringing' | 'no_answer' | 'canceled';
  channel: string;
  tags: string[];
  agentName: string;
  transcript: string;
  summarySystem: string;
  summaryHuman: string | null;
  extractedData: {
    contactName?: string;
    reason?: string;
    intent?: string;
    budget?: string;
    location?: string;
    urgency?: string;
    sentiment?: string;
    suggestedTags?: string[];
    objections?: string[];
    agreements?: string[];
    followUp?: string;
  };
  audioUrl: string | null;
}

export interface CallEvent {
  id: string;
  callRecordId: string;
  tenantId: string;
  eventType: string;
  eventData: Record<string, any>;
  twilioCallSid: string | null;
  createdAt: Date;
}

export interface Appointment {
  id: string;
  contactName: string;
  contactPhone: string;
  serviceType: string;
  startAt: Date;
  endAt: Date;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  source: 'call' | 'whatsapp' | 'app';
  notes: string;
  agentName: string;
}

export interface WhatsAppConversation {
  id: string;
  contactPhone: string;
  contactName: string;
  assignedTo: string;
  status: 'open' | 'pending' | 'closed';
  tags: string[];
  notes: string;
  lastMessageAt: Date;
  unreadCount: number;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  body: string;
  mediaUrl: string | null;
  status: 'received' | 'sent' | 'delivered' | 'read';
  createdAt: Date;
}

export const mockCallRecords: CallRecord[] = [];
export const mockAppointments: Appointment[] = [];
export const mockWAConversations: WhatsAppConversation[] = [];
export const mockWAMessages: WhatsAppMessage[] = [];

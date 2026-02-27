export interface CallRecord {
  id: string;
  externalCallId: string;
  fromNumber: string;
  toNumber: string;
  startedAt: Date;
  endedAt: Date;
  duration: number;
  status: 'completed' | 'missed' | 'busy' | 'voicemail';
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
    objections?: string[];
    agreements?: string[];
    followUp?: string;
  };
  audioUrl: string | null;
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

export const mockCallRecords: CallRecord[] = [
  {
    id: 'call-1',
    externalCallId: 'ext-001',
    fromNumber: '+52 55 1234 5678',
    toNumber: '+52 55 8765 4321',
    startedAt: new Date(2026, 1, 27, 9, 15),
    endedAt: new Date(2026, 1, 27, 9, 28),
    duration: 780,
    status: 'completed',
    channel: 'phone',
    tags: ['venta', 'seguimiento'],
    agentName: 'Ana García',
    transcript: `Ana: Buenos días, ¿en qué puedo ayudarle?\nCliente: Hola, estoy interesado en el plan Pro para mi empresa.\nAna: Excelente, el plan Pro incluye 25 usuarios, proyectos ilimitados y WhatsApp integrado. ¿Cuántos usuarios necesitaría?\nCliente: Somos un equipo de 15 personas. ¿Hay algún descuento por pago anual?\nAna: Sí, el pago anual tiene un 20% de descuento. Quedaría en $63/mes por usuario.\nCliente: Interesante. Necesitaría una demo antes de decidir. ¿Podemos agendarla para esta semana?\nAna: Por supuesto, le tengo disponibilidad el jueves a las 11am o viernes a las 3pm.\nCliente: El jueves a las 11am me funciona perfecto.\nAna: Perfecto, queda agendada la demo para el jueves 5 de marzo a las 11am. Le envío confirmación por WhatsApp.\nCliente: Muchas gracias, Ana.\nAna: ¡Con gusto! Hasta el jueves.`,
    summarySystem: `**Resumen:** Llamada de venta con cliente interesado en Plan Pro para equipo de 15 personas. Se agendó demo para jueves 5 de marzo a las 11am.\n\n**Puntos clave:**\n- Cliente necesita 15 licencias Plan Pro\n- Interesado en descuento anual (20%)\n- Demo agendada: jueves 5 marzo, 11:00 AM\n\n**Acciones sugeridas:**\n- Enviar confirmación por WhatsApp\n- Preparar demo personalizada\n- Enviar propuesta con precios anuales\n\n**Seguimiento:** Jueves 5 de marzo - Demo del producto`,
    summaryHuman: null,
    extractedData: {
      contactName: 'Roberto Méndez',
      reason: 'Interés en Plan Pro',
      intent: 'compra',
      budget: '$63/mes por usuario (anual)',
      urgency: 'media',
      agreements: ['Demo agendada para jueves 5 marzo 11am', 'Enviar confirmación por WhatsApp'],
      followUp: '2026-03-05T11:00:00',
    },
    audioUrl: null,
  },
  {
    id: 'call-2',
    externalCallId: 'ext-002',
    fromNumber: '+52 33 9876 5432',
    toNumber: '+52 55 8765 4321',
    startedAt: new Date(2026, 1, 27, 10, 30),
    endedAt: new Date(2026, 1, 27, 10, 35),
    duration: 300,
    status: 'completed',
    channel: 'phone',
    tags: ['soporte', 'facturación'],
    agentName: 'Carlos López',
    transcript: `Carlos: OfficeHub, buenos días.\nCliente: Hola, tengo un problema con mi factura del mes pasado.\nCarlos: Claro, ¿me puede dar su nombre o email de cuenta?\nCliente: Patricia Vega, patricia@techsolutions.mx\nCarlos: Ya la ubico. Veo que la factura de enero tiene un cargo adicional por 2 usuarios extra.\nCliente: Ah sí, pero esos usuarios los dimos de baja a mitad de mes.\nCarlos: Entiendo, le genero un crédito proporcional. El ajuste aparecerá en su próxima factura.\nCliente: Perfecto, gracias Carlos.`,
    summarySystem: `**Resumen:** Soporte de facturación. Cliente Patricia Vega reporta cargo extra por usuarios dados de baja a mitad de mes.\n\n**Puntos clave:**\n- Cargo por 2 usuarios extra en factura de enero\n- Usuarios dados de baja a mitad de mes\n- Se genera crédito proporcional\n\n**Acciones sugeridas:**\n- Generar nota de crédito en sistema\n- Confirmar ajuste por email`,
    summaryHuman: null,
    extractedData: {
      contactName: 'Patricia Vega',
      reason: 'Problema con facturación',
      intent: 'soporte',
      agreements: ['Generar crédito proporcional', 'Ajuste en próxima factura'],
    },
    audioUrl: null,
  },
  {
    id: 'call-3',
    externalCallId: 'ext-003',
    fromNumber: '+52 81 5555 1234',
    toNumber: '+52 55 8765 4321',
    startedAt: new Date(2026, 1, 27, 11, 0),
    endedAt: new Date(2026, 1, 27, 11, 0),
    duration: 0,
    status: 'missed',
    channel: 'phone',
    tags: [],
    agentName: 'Sin asignar',
    transcript: '',
    summarySystem: 'Llamada perdida. No se pudo atender.',
    summaryHuman: null,
    extractedData: {},
    audioUrl: null,
  },
  {
    id: 'call-4',
    externalCallId: 'ext-004',
    fromNumber: '+52 55 8765 4321',
    toNumber: '+52 55 4444 3333',
    startedAt: new Date(2026, 1, 26, 16, 0),
    endedAt: new Date(2026, 1, 26, 16, 22),
    duration: 1320,
    status: 'completed',
    channel: 'phone',
    tags: ['negociación', 'enterprise'],
    agentName: 'Laura Sánchez',
    transcript: 'Laura: Buenas tardes...\n[Transcripción completa de negociación con cliente enterprise sobre implementación personalizada, SLA y precios especiales]',
    summarySystem: `**Resumen:** Negociación con cliente enterprise para implementación personalizada. Interesados en SLA dedicado y SSO.\n\n**Puntos clave:**\n- Empresa: GlobalTech (200+ empleados)\n- Necesitan SSO con Azure AD\n- Requieren SLA 99.9%\n- Presupuesto: $5,000-8,000 USD/mes\n\n**Acciones sugeridas:**\n- Preparar propuesta enterprise personalizada\n- Coordinar con equipo técnico para SSO\n- Agendar reunión de seguimiento\n\n**Seguimiento:** Semana del 2 de marzo`,
    summaryHuman: 'Ajustado: el presupuesto real es $6,000-10,000 USD/mes. Prioridad alta.',
    extractedData: {
      contactName: 'Director TI - GlobalTech',
      reason: 'Implementación enterprise',
      intent: 'compra_enterprise',
      budget: '$6,000-10,000 USD/mes',
      urgency: 'alta',
      objections: ['Necesitan SSO obligatorio', 'SLA mínimo 99.9%'],
      agreements: ['Enviar propuesta en 48h', 'Reunión de seguimiento semana del 2 marzo'],
      followUp: '2026-03-02',
    },
    audioUrl: null,
  },
];

export const mockAppointments: Appointment[] = [
  {
    id: 'apt-1',
    contactName: 'Roberto Méndez',
    contactPhone: '+52 55 1234 5678',
    serviceType: 'Demo producto',
    startAt: new Date(2026, 2, 5, 11, 0),
    endAt: new Date(2026, 2, 5, 12, 0),
    status: 'scheduled',
    source: 'call',
    notes: 'Interesado en Plan Pro, 15 usuarios',
    agentName: 'Ana García',
  },
  {
    id: 'apt-2',
    contactName: 'Sofía Hernández',
    contactPhone: '+52 33 2222 3333',
    serviceType: 'Consultoría inicial',
    startAt: new Date(2026, 2, 3, 14, 0),
    endAt: new Date(2026, 2, 3, 15, 0),
    status: 'confirmed',
    source: 'whatsapp',
    notes: 'Referida por cliente actual',
    agentName: 'Carlos López',
  },
  {
    id: 'apt-3',
    contactName: 'Miguel Torres',
    contactPhone: '+52 81 4444 5555',
    serviceType: 'Seguimiento',
    startAt: new Date(2026, 1, 27, 15, 0),
    endAt: new Date(2026, 1, 27, 15, 30),
    status: 'completed',
    source: 'app',
    notes: 'Revisión de implementación',
    agentName: 'Laura Sánchez',
  },
];

export const mockWAConversations: WhatsAppConversation[] = [
  {
    id: 'wa-conv-1',
    contactPhone: '+52 55 1234 5678',
    contactName: 'Roberto Méndez',
    assignedTo: 'Ana García',
    status: 'open',
    tags: ['lead', 'demo'],
    notes: 'Lead calificado, demo agendada',
    lastMessageAt: new Date(2026, 1, 27, 9, 45),
    unreadCount: 2,
  },
  {
    id: 'wa-conv-2',
    contactPhone: '+52 33 9876 5432',
    contactName: 'Patricia Vega',
    assignedTo: 'Carlos López',
    status: 'open',
    tags: ['soporte', 'facturación'],
    notes: 'Ticket de facturación pendiente',
    lastMessageAt: new Date(2026, 1, 27, 10, 50),
    unreadCount: 0,
  },
  {
    id: 'wa-conv-3',
    contactPhone: '+52 81 5555 1234',
    contactName: 'Número desconocido',
    assignedTo: 'Sin asignar',
    status: 'pending',
    tags: [],
    notes: '',
    lastMessageAt: new Date(2026, 1, 27, 11, 5),
    unreadCount: 1,
  },
  {
    id: 'wa-conv-4',
    contactPhone: '+52 55 7777 8888',
    contactName: 'Alejandro Ruiz',
    assignedTo: 'Laura Sánchez',
    status: 'closed',
    tags: ['cliente', 'renovación'],
    notes: 'Renovación completada',
    lastMessageAt: new Date(2026, 1, 26, 18, 30),
    unreadCount: 0,
  },
];

export const mockWAMessages: WhatsAppMessage[] = [
  // Conversation 1
  { id: 'wam-1', conversationId: 'wa-conv-1', direction: 'in', body: 'Hola, hablé hace rato con Ana sobre el Plan Pro', mediaUrl: null, status: 'read', createdAt: new Date(2026, 1, 27, 9, 35) },
  { id: 'wam-2', conversationId: 'wa-conv-1', direction: 'out', body: '¡Hola Roberto! Sí, ya tengo agendada tu demo para el jueves 5 de marzo a las 11am. ¿Te envío la liga de Zoom?', mediaUrl: null, status: 'delivered', createdAt: new Date(2026, 1, 27, 9, 38) },
  { id: 'wam-3', conversationId: 'wa-conv-1', direction: 'in', body: 'Sí por favor. Y si pueden enviarme un resumen de los planes antes', mediaUrl: null, status: 'received', createdAt: new Date(2026, 1, 27, 9, 40) },
  { id: 'wam-4', conversationId: 'wa-conv-1', direction: 'in', body: '¿Tienen integración con Slack?', mediaUrl: null, status: 'received', createdAt: new Date(2026, 1, 27, 9, 45) },
  // Conversation 2
  { id: 'wam-5', conversationId: 'wa-conv-2', direction: 'in', body: 'Carlos, ¿ya se aplicó el crédito?', mediaUrl: null, status: 'read', createdAt: new Date(2026, 1, 27, 10, 45) },
  { id: 'wam-6', conversationId: 'wa-conv-2', direction: 'out', body: 'Hola Patricia, sí, el crédito ya fue aplicado. Lo verás reflejado en tu próxima factura del 1 de marzo.', mediaUrl: null, status: 'read', createdAt: new Date(2026, 1, 27, 10, 50) },
  // Conversation 3
  { id: 'wam-7', conversationId: 'wa-conv-3', direction: 'in', body: 'Buenas, quiero información sobre sus servicios', mediaUrl: null, status: 'received', createdAt: new Date(2026, 1, 27, 11, 5) },
];

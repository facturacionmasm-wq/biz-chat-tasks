import { Channel, Message, Task, TeamMember, Project, OKR, KeyResult, CalendarEvent, KnowledgeArticle } from '@/types/app';

export const teamMembers: TeamMember[] = [
  { id: '1', name: 'Ana García', avatar: '', role: 'Owner', status: 'online', email: 'ana@officehub.com' },
  { id: '2', name: 'Carlos López', avatar: '', role: 'Admin', status: 'online', email: 'carlos@officehub.com' },
  { id: '3', name: 'María Rodríguez', avatar: '', role: 'Member', status: 'away', email: 'maria@officehub.com' },
  { id: '4', name: 'Juan Martínez', avatar: '', role: 'Member', status: 'offline', email: 'juan@officehub.com' },
  { id: '5', name: 'Laura Sánchez', avatar: '', role: 'Member', status: 'online', email: 'laura@officehub.com' },
  { id: '6', name: 'Pedro Ramírez', avatar: '', role: 'Guest', status: 'offline', email: 'pedro@ext.com' },
];

export const channels: Channel[] = [
  { id: 'general', name: 'General', type: 'channel', unread: 3 },
  { id: 'proyectos', name: 'Proyectos', type: 'channel', unread: 0 },
  { id: 'marketing', name: 'Marketing', type: 'channel', unread: 1 },
  { id: 'ventas', name: 'Ventas', type: 'channel', unread: 0 },
  { id: 'dm-carlos', name: 'Carlos López', type: 'direct', unread: 2 },
  { id: 'dm-maria', name: 'María Rodríguez', type: 'direct', unread: 0 },
];

export const messages: Message[] = [
  {
    id: '1', channelId: 'general', userId: '1', userName: 'Ana García', userAvatar: '',
    content: '¡Buenos días equipo! Hoy tenemos la reunión de planificación a las 10am.',
    timestamp: new Date(2026, 1, 27, 8, 30), isOwn: false,
  },
  {
    id: '2', channelId: 'general', userId: '2', userName: 'Carlos López', userAvatar: '',
    content: 'Buenos días Ana, ya tengo listos los mockups del nuevo proyecto.',
    timestamp: new Date(2026, 1, 27, 8, 35), isOwn: false,
  },
  {
    id: '3', channelId: 'general', userId: '0', userName: 'Tú', userAvatar: '',
    content: 'Perfecto, nos vemos en la reunión. Voy a preparar la agenda.',
    timestamp: new Date(2026, 1, 27, 8, 40), isOwn: true,
  },
  {
    id: '4', channelId: 'general', userId: '3', userName: 'María Rodríguez', userAvatar: '',
    content: 'He terminado el backend del módulo de pagos. Listo para revisión. 🚀',
    timestamp: new Date(2026, 1, 27, 9, 0), isOwn: false,
  },
  {
    id: '5', channelId: 'general', userId: '5', userName: 'Laura Sánchez', userAvatar: '',
    content: 'Tenemos 3 nuevos leads esta semana. Actualizo el tablero de tareas.',
    timestamp: new Date(2026, 1, 27, 9, 15), isOwn: false,
  },
];

export const tasks: Task[] = [
  {
    id: '1', title: 'Diseñar landing page', description: 'Crear diseño responsive para la nueva landing',
    status: 'in_progress', priority: 'high', assignee: 'Carlos López', assigneeAvatar: '',
    dueDate: new Date(2026, 1, 28), projectId: 'p1',
  },
  {
    id: '2', title: 'Revisar módulo de pagos', description: 'Code review del backend de pagos',
    status: 'todo', priority: 'high', assignee: 'Ana García', assigneeAvatar: '',
    dueDate: new Date(2026, 1, 27), projectId: 'p1',
  },
  {
    id: '3', title: 'Campaña email marketing', description: 'Preparar campaña para el lanzamiento',
    status: 'todo', priority: 'medium', assignee: 'Juan Martínez', assigneeAvatar: '',
    dueDate: new Date(2026, 2, 1), projectId: 'p2',
  },
  {
    id: '4', title: 'Seguimiento de leads', description: 'Contactar los 3 nuevos leads',
    status: 'in_progress', priority: 'medium', assignee: 'Laura Sánchez', assigneeAvatar: '',
    dueDate: new Date(2026, 1, 28), projectId: 'p2',
  },
  {
    id: '5', title: 'Optimizar rendimiento', description: 'Mejorar tiempos de carga de la app',
    status: 'done', priority: 'low', assignee: 'María Rodríguez', assigneeAvatar: '',
    projectId: 'p1',
  },
  {
    id: '6', title: 'Actualizar documentación', description: 'Documentar las nuevas APIs',
    status: 'done', priority: 'low', assignee: 'María Rodríguez', assigneeAvatar: '',
    projectId: 'p1',
  },
  {
    id: '7', title: 'Diseño sistema de notificaciones', description: 'Wireframes para el módulo de notificaciones',
    status: 'todo', priority: 'medium', assignee: 'Carlos López', assigneeAvatar: '',
    dueDate: new Date(2026, 2, 5), projectId: 'p3',
  },
  {
    id: '8', title: 'Integrar pasarela de pago', description: 'Conectar Stripe para suscripciones',
    status: 'blocked', priority: 'high', assignee: 'María Rodríguez', assigneeAvatar: '',
    dueDate: new Date(2026, 2, 3), projectId: 'p1',
  },
];

export const projects: Project[] = [
  {
    id: 'p1', name: 'OfficeHub v2.0', description: 'Rediseño completo de la plataforma con nuevas funcionalidades',
    status: 'active', progress: 45, teamIds: ['1', '2', '3'],
    startDate: new Date(2026, 0, 15), endDate: new Date(2026, 5, 30),
    milestones: [
      { id: 'm1', name: 'MVP Backend', date: new Date(2026, 1, 28), completed: true },
      { id: 'm2', name: 'UI/UX Completo', date: new Date(2026, 2, 15), completed: false },
      { id: 'm3', name: 'Beta Launch', date: new Date(2026, 3, 1), completed: false },
      { id: 'm4', name: 'Release v2.0', date: new Date(2026, 5, 30), completed: false },
    ],
  },
  {
    id: 'p2', name: 'Campaña Q1 Marketing', description: 'Estrategia de marketing para el primer trimestre',
    status: 'active', progress: 60, teamIds: ['4', '5'],
    startDate: new Date(2026, 0, 1), endDate: new Date(2026, 2, 31),
    milestones: [
      { id: 'm5', name: 'Estrategia definida', date: new Date(2026, 0, 15), completed: true },
      { id: 'm6', name: 'Ejecución campañas', date: new Date(2026, 1, 28), completed: true },
      { id: 'm7', name: 'Análisis resultados', date: new Date(2026, 2, 31), completed: false },
    ],
  },
  {
    id: 'p3', name: 'App Móvil', description: 'Desarrollo de la aplicación móvil multiplataforma',
    status: 'planning', progress: 10, teamIds: ['2', '3'],
    startDate: new Date(2026, 2, 1), endDate: new Date(2026, 8, 30),
    milestones: [
      { id: 'm8', name: 'Wireframes', date: new Date(2026, 2, 15), completed: false },
      { id: 'm9', name: 'Prototipo', date: new Date(2026, 4, 1), completed: false },
    ],
  },
  {
    id: 'p4', name: 'Migración Cloud', description: 'Migración de infraestructura a la nube',
    status: 'completed', progress: 100, teamIds: ['3'],
    startDate: new Date(2025, 10, 1), endDate: new Date(2026, 0, 31),
    milestones: [],
  },
];

export const okrs: OKR[] = [
  {
    id: 'okr1', title: 'Incrementar adquisición de usuarios', owner: 'Ana García',
    period: 'Q1 2026', priority: 'high', progress: 55, projectId: 'p2',
    keyResults: [
      { id: 'kr1', title: 'Alcanzar 1,000 usuarios registrados', target: 1000, current: 620, unit: 'usuarios', progress: 62 },
      { id: 'kr2', title: 'Tasa de conversión landing > 5%', target: 5, current: 3.8, unit: '%', progress: 76 },
      { id: 'kr3', title: 'Reducir CAC a $15', target: 15, current: 22, unit: 'USD', progress: 30 },
    ],
  },
  {
    id: 'okr2', title: 'Lanzar producto v2.0', owner: 'María Rodríguez',
    period: 'Q1 2026', priority: 'high', progress: 40, projectId: 'p1',
    keyResults: [
      { id: 'kr4', title: 'Completar 100% de features del MVP', target: 100, current: 45, unit: '%', progress: 45 },
      { id: 'kr5', title: 'Cobertura de tests > 80%', target: 80, current: 35, unit: '%', progress: 44 },
      { id: 'kr6', title: '0 bugs críticos en staging', target: 0, current: 3, unit: 'bugs', progress: 25 },
    ],
  },
  {
    id: 'okr3', title: 'Mejorar satisfacción del equipo', owner: 'Ana García',
    period: 'Q1 2026', priority: 'medium', progress: 70,
    keyResults: [
      { id: 'kr7', title: 'NPS interno > 8', target: 8, current: 7.2, unit: 'puntos', progress: 90 },
      { id: 'kr8', title: 'Reuniones 1:1 semanales al 100%', target: 100, current: 85, unit: '%', progress: 85 },
      { id: 'kr9', title: 'Reducir rotación < 5%', target: 5, current: 3, unit: '%', progress: 100 },
    ],
  },
];

export const calendarEvents: CalendarEvent[] = [
  { id: 'e1', title: 'Standup diario', date: new Date(2026, 1, 27, 9, 0), endDate: new Date(2026, 1, 27, 9, 15), type: 'meeting', projectId: 'p1' },
  { id: 'e2', title: 'Revisión de Sprint', date: new Date(2026, 1, 27, 14, 0), endDate: new Date(2026, 1, 27, 15, 0), type: 'meeting', projectId: 'p1' },
  { id: 'e3', title: 'Deadline: Mockups UI', date: new Date(2026, 1, 28), type: 'deadline', projectId: 'p1' },
  { id: 'e4', title: 'Reunión con cliente', date: new Date(2026, 2, 1, 11, 0), endDate: new Date(2026, 2, 1, 12, 0), type: 'meeting' },
  { id: 'e5', title: 'Demo producto', date: new Date(2026, 2, 3, 16, 0), endDate: new Date(2026, 2, 3, 17, 0), type: 'presentation', projectId: 'p1' },
  { id: 'e6', title: 'Team building', date: new Date(2026, 2, 5, 18, 0), endDate: new Date(2026, 2, 5, 21, 0), type: 'event' },
  { id: 'e7', title: 'Hito: Beta Launch', date: new Date(2026, 3, 1), type: 'milestone', projectId: 'p1' },
  { id: 'e8', title: 'Entrega campaña email', date: new Date(2026, 2, 10), type: 'deadline', projectId: 'p2' },
];

export const knowledgeArticles: KnowledgeArticle[] = [
  {
    id: 'kb1', title: 'Guía de onboarding para nuevos miembros',
    content: 'Pasos para configurar tu cuenta, acceder a los canales y familiarizarte con las herramientas...',
    category: 'Procesos', tags: ['onboarding', 'equipo', 'guía'],
    author: 'Ana García', createdAt: new Date(2026, 0, 10), updatedAt: new Date(2026, 1, 5),
    isPublic: true,
  },
  {
    id: 'kb2', title: 'Estándares de código y Git Flow',
    content: 'Convenciones de nombrado, estructura de ramas, proceso de pull requests...',
    category: 'Desarrollo', tags: ['código', 'git', 'estándares'],
    author: 'María Rodríguez', createdAt: new Date(2026, 0, 15), updatedAt: new Date(2026, 1, 20),
    isPublic: true,
  },
  {
    id: 'kb3', title: 'Proceso de ventas B2B',
    content: 'Pipeline de ventas, scripts de llamadas, manejo de objeciones...',
    category: 'Ventas', tags: ['ventas', 'B2B', 'pipeline'],
    author: 'Laura Sánchez', createdAt: new Date(2026, 1, 1), updatedAt: new Date(2026, 1, 25),
    isPublic: false,
  },
  {
    id: 'kb4', title: 'Políticas de seguridad y privacidad',
    content: 'Manejo de datos sensibles, contraseñas, acceso a producción...',
    category: 'Seguridad', tags: ['seguridad', 'privacidad', 'compliance'],
    author: 'Ana García', createdAt: new Date(2025, 11, 20), updatedAt: new Date(2026, 1, 10),
    isPublic: true,
  },
  {
    id: 'kb5', title: 'Plantilla de retrospectiva',
    content: 'Formato para las retrospectivas de sprint con secciones de qué salió bien, qué mejorar...',
    category: 'Procesos', tags: ['agile', 'retrospectiva', 'sprint'],
    author: 'Carlos López', createdAt: new Date(2026, 1, 15), updatedAt: new Date(2026, 1, 15),
    isPublic: true,
  },
];

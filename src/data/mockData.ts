import { Channel, Message, Task, TeamMember } from '@/types/app';

export const teamMembers: TeamMember[] = [
  { id: '1', name: 'Ana García', avatar: '', role: 'Gerente', status: 'online' },
  { id: '2', name: 'Carlos López', avatar: '', role: 'Diseñador', status: 'online' },
  { id: '3', name: 'María Rodríguez', avatar: '', role: 'Desarrollador', status: 'away' },
  { id: '4', name: 'Juan Martínez', avatar: '', role: 'Marketing', status: 'offline' },
  { id: '5', name: 'Laura Sánchez', avatar: '', role: 'Ventas', status: 'online' },
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
    dueDate: new Date(2026, 1, 28),
  },
  {
    id: '2', title: 'Revisar módulo de pagos', description: 'Code review del backend de pagos',
    status: 'todo', priority: 'high', assignee: 'Ana García', assigneeAvatar: '',
    dueDate: new Date(2026, 1, 27),
  },
  {
    id: '3', title: 'Campaña email marketing', description: 'Preparar campaña para el lanzamiento',
    status: 'todo', priority: 'medium', assignee: 'Juan Martínez', assigneeAvatar: '',
    dueDate: new Date(2026, 2, 1),
  },
  {
    id: '4', title: 'Seguimiento de leads', description: 'Contactar los 3 nuevos leads',
    status: 'in_progress', priority: 'medium', assignee: 'Laura Sánchez', assigneeAvatar: '',
    dueDate: new Date(2026, 1, 28),
  },
  {
    id: '5', title: 'Optimizar rendimiento', description: 'Mejorar tiempos de carga de la app',
    status: 'done', priority: 'low', assignee: 'María Rodríguez', assigneeAvatar: '',
  },
  {
    id: '6', title: 'Actualizar documentación', description: 'Documentar las nuevas APIs',
    status: 'done', priority: 'low', assignee: 'María Rodríguez', assigneeAvatar: '',
  },
];

// Bring-Your-Own-Number (BYON) options catalog
// Copy, timings and country coverage for each path to reuse the tenant's own number.
import { MessageSquare, Phone, Repeat, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ByonOptionId =
  | 'meta_whatsapp'
  | 'verified_caller_id'
  | 'hosted_sms'
  | 'port_in';

export interface ByonOption {
  id: ByonOptionId;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  automated: boolean;
  countries: string[];
  timing: string;
  cost: string;
  receives: string;
  sends: string;
  requirements: string[];
  goodFor: string[];
  notGoodFor: string[];
  ctaLabel: string;
}

export const BYON_OPTIONS: ByonOption[] = [
  {
    id: 'meta_whatsapp',
    title: 'WhatsApp Business con mi celular',
    short: 'Meta Cloud API',
    description:
      'Vincula tu número celular a la nube de WhatsApp de Meta y deja que Aria conteste mensajes por ti. Es la ruta más rápida y no involucra Twilio.',
    icon: MessageSquare,
    accent: 'emerald',
    automated: true,
    countries: ['MX', 'US', 'CA', 'Global'],
    timing: '5 a 10 minutos (automático)',
    cost: 'Gratis (según plan de Meta)',
    receives: 'Sí — mensajes WhatsApp',
    sends: 'Sí — mensajes WhatsApp',
    requirements: [
      'Tu celular debe poder recibir el código OTP de WhatsApp',
      'Al vincularlo con Meta, WhatsApp deja de funcionar en la app del celular',
      'Necesitas cuenta de Meta Business (gratuita)',
    ],
    goodFor: [
      'Recibir y responder mensajes de WhatsApp con Aria',
      'Automatizar respuestas y flujos con IA',
      'Empresas que usan WhatsApp como canal principal',
    ],
    notGoodFor: ['Llamadas de voz', 'SMS tradicionales'],
    ctaLabel: 'Vincular con Meta',
  },
  {
    id: 'verified_caller_id',
    title: 'Verified Caller ID (Twilio)',
    short: 'Solo envío saliente',
    description:
      'Verifica tu número personal en Twilio y úsalo como remitente en SMS o llamadas salientes desde la app. El número NO recibe respuestas por Twilio — las respuestas llegan a tu carrier normal.',
    icon: ShieldCheck,
    accent: 'brand',
    automated: true,
    countries: ['MX', 'US', 'CA', 'Global'],
    timing: '2 a 5 minutos (automático con código OTP)',
    cost: 'Gratis',
    receives: 'No — respuestas van a tu operadora normal',
    sends: 'Sí — SMS y llamadas salientes desde la app',
    requirements: [
      'Tu celular debe poder recibir un SMS o llamada con un código de 6 dígitos',
      'Tu Twilio Account SID y Auth Token deben estar configurados (ya lo están si compraste un número)',
    ],
    goodFor: [
      'Enviar recordatorios/notificaciones desde tu número personal',
      'Que tus clientes vean tu número familiar en llamadas salientes',
      'Uso ocasional sin cambiar de operadora',
    ],
    notGoodFor: [
      'Recibir llamadas o SMS desde Twilio',
      'Agente de Voz IA entrante',
      'Aria en WhatsApp',
    ],
    ctaLabel: 'Verificar mi número',
  },
  {
    id: 'hosted_sms',
    title: 'Hosted SMS (Twilio)',
    short: 'Recibir SMS sin portar',
    description:
      'Conservas tu operadora actual para voz, y Twilio queda como el hospedador de SMS del número. Permite recibir y enviar SMS en Twilio sin portar completamente el número.',
    icon: Repeat,
    accent: 'amber',
    automated: false,
    countries: ['US', 'CA'],
    timing: '5 a 15 días hábiles',
    cost: 'Setup Twilio + tarifa mensual',
    receives: 'Sí — SMS',
    sends: 'Sí — SMS',
    requirements: [
      'Solo disponible en US y Canadá',
      'Carta de autorización (LOA) firmada por el titular',
      'Copia de factura reciente del carrier (últimos 30 días)',
      'Identificación oficial del titular',
      'Aprobación manual por parte del equipo de soporte',
    ],
    goodFor: [
      'Recibir SMS de clientes en un número US/CA existente',
      'Mantener tu servicio de voz con la operadora actual',
    ],
    notGoodFor: [
      'Números celulares en México (no soportado por Twilio)',
      'Uso inmediato — requiere trámite',
    ],
    ctaLabel: 'Solicitar Hosted SMS',
  },
  {
    id: 'port_in',
    title: 'Portabilidad total (Port-in)',
    short: 'Migrar número completo',
    description:
      'Tu número deja tu operadora actual y pasa a Twilio por completo. Habilita SMS, voz y agente IA entrante con tu mismo número, pero el celular pierde el servicio de esa operadora.',
    icon: Phone,
    accent: 'rose',
    automated: false,
    countries: ['US', 'CA', 'MX (caso a caso)'],
    timing: '2 a 4 semanas',
    cost: 'Setup + tarifa mensual del número Twilio',
    requirements: [
      'Carta de autorización (LOA) firmada por el titular',
      'Copia de factura reciente del carrier',
      'Identificación oficial del titular',
      'El número deja de funcionar en la operadora actual al completar la portabilidad',
      'MX: sujeto a disponibilidad y validación caso a caso',
    ],
    receives: 'Sí — todo',
    sends: 'Sí — todo',
    goodFor: [
      'Consolidar tu número principal en Twilio',
      'Agente de Voz IA entrante con tu mismo número',
      'Aria en WhatsApp con tu mismo número (vía Twilio)',
    ],
    notGoodFor: [
      'Uso urgente (toma semanas)',
      'Si necesitas seguir usando el número en tu celular',
    ],
    ctaLabel: 'Solicitar portabilidad',
  },
];

export const getByonOption = (id: ByonOptionId): ByonOption | undefined =>
  BYON_OPTIONS.find((o) => o.id === id);

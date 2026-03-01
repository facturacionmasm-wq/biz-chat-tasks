// Tool definitions for AI function calling
export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'schedule_appointment',
      description: 'Agendar una cita/appointment para un cliente o empleado. Usa esto cuando alguien quiera agendar, programar, o reservar una cita.',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string', description: 'Nombre del cliente o contacto' },
          contact_phone: { type: 'string', description: 'Teléfono del contacto (si se tiene)' },
          contact_email: { type: 'string', description: 'Email del contacto (si se tiene)' },
          date: { type: 'string', description: 'Fecha de la cita en formato YYYY-MM-DD' },
          time: { type: 'string', description: 'Hora de la cita en formato HH:MM (24h)' },
          service_type: { type: 'string', description: 'Tipo de servicio o motivo de la cita' },
          employee_name: { type: 'string', description: 'Nombre del empleado con quien se quiere la cita (opcional)' },
          notes: { type: 'string', description: 'Notas adicionales' },
        },
        required: ['contact_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Verificar disponibilidad de horarios para una fecha específica. Usa esto cuando pregunten por horarios disponibles.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha a consultar en formato YYYY-MM-DD' },
          employee_name: { type: 'string', description: 'Nombre del empleado (opcional)' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Crear un recordatorio para el usuario. Usa esto cuando pidan "recuérdame", "avísame", "no me dejes olvidar", etc.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Mensaje del recordatorio - qué debe recordar' },
          remind_at: { type: 'string', description: 'Fecha y hora del recordatorio en formato ISO 8601 (YYYY-MM-DDTHH:MM:SS). Si solo dicen hora, usar la fecha de hoy.' },
        },
        required: ['message', 'remind_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_agenda',
      description: 'Obtener la agenda/citas del día de hoy para el usuario. Usa cuando pregunten por su agenda, citas, o qué tienen hoy.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_expenses',
      description: 'Obtener gastos pendientes de aprobación del usuario.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_bot_instruction',
      description: 'Guardar una corrección, instrucción o regla nueva para modificar el comportamiento del bot. Usa cuando un humano diga cosas como: "cuando te pregunten X responde Y", "no digas X", "aprende esto", "corrige esto", "de ahora en adelante haz X", "tu respuesta sobre X estuvo mal, la correcta es Y". Esta herramienta reprograma el comportamiento futuro del bot.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título corto y descriptivo de la instrucción/corrección (ej: "Respuesta correcta sobre precios", "No mencionar competencia")' },
          instruction: { type: 'string', description: 'La instrucción completa, corrección o nueva regla de comportamiento. Incluye el contexto de qué pregunta/situación aplica y cuál debe ser la respuesta o comportamiento correcto.' },
          correction_type: { type: 'string', enum: ['correction', 'new_rule', 'knowledge', 'personality'], description: 'Tipo: correction=corregir respuesta incorrecta, new_rule=nueva regla de comportamiento, knowledge=nuevo conocimiento/dato, personality=ajuste de personalidad/tono' },
        },
        required: ['title', 'instruction', 'correction_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_bot_instructions',
      description: 'Listar las instrucciones/correcciones activas del bot. Usa cuando pregunten "qué reglas tienes", "qué has aprendido", "muéstrame tus correcciones".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_bot_instruction',
      description: 'Eliminar/desactivar una instrucción o corrección del bot. Usa cuando digan "olvida la regla de X", "elimina la corrección sobre Y", "ya no apliques eso".',
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'Término de búsqueda para encontrar la instrucción a eliminar (busca en título y contenido)' },
        },
        required: ['search_term'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancelar una cita existente. Usa cuando alguien diga "cancela mi cita", "ya no voy a ir", "quita la cita de X". Busca la cita por nombre del contacto y/o fecha.',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string', description: 'Nombre del contacto o cliente de la cita a cancelar' },
          date: { type: 'string', description: 'Fecha de la cita a cancelar en formato YYYY-MM-DD (opcional si solo hay una cita con ese contacto)' },
        },
        required: ['contact_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: 'Reprogramar/cambiar la fecha u hora de una cita existente. Usa cuando alguien diga "cambia mi cita", "mueve la cita de X", "reprograma", "cámbiala para el jueves". Busca la cita por nombre del contacto y/o fecha original.',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string', description: 'Nombre del contacto o cliente de la cita a reprogramar' },
          current_date: { type: 'string', description: 'Fecha actual de la cita en formato YYYY-MM-DD (opcional si solo hay una cita con ese contacto)' },
          new_date: { type: 'string', description: 'Nueva fecha para la cita en formato YYYY-MM-DD' },
          new_time: { type: 'string', description: 'Nueva hora para la cita en formato HH:MM (24h)' },
        },
        required: ['contact_name', 'new_date', 'new_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp_message',
      description: 'Enviar un mensaje de WhatsApp a una persona específica. Usa cuando un empleado diga "mándale un mensaje a X", "envíale a X que Y", "dile a X por WhatsApp que Y", "escríbele a X". Solo empleados autenticados pueden usar esta herramienta.',
      parameters: {
        type: 'object',
        properties: {
          recipient_name: { type: 'string', description: 'Nombre de la persona a quien enviar el mensaje. Puede ser un contacto existente o un empleado del equipo.' },
          recipient_phone: { type: 'string', description: 'Número de teléfono del destinatario (opcional si se puede buscar por nombre). Formato: +521234567890' },
          message: { type: 'string', description: 'El mensaje a enviar al destinatario.' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Buscar información en internet o responder preguntas de conocimiento general. Usa cuando pregunten sobre: direcciones, cómo llegar a un lugar, clima, precios de algo, información general, cultura, ciencia, recetas, consejos, definiciones, noticias, o cualquier cosa que NO esté en la base de conocimientos del negocio. También usa cuando digan "busca", "investiga", "dime sobre", "qué es", "cómo llego a", "cuánto cuesta".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'La pregunta o consulta a buscar. Reformúlala de forma clara y específica.' },
          model_preference: { type: 'string', enum: ['gemini', 'gpt'], description: 'Modelo preferido: "gemini" para consultas rápidas/generales, "gpt" para razonamiento complejo. Default: gemini.' },
        },
        required: ['query'],
      },
    },
  },
];

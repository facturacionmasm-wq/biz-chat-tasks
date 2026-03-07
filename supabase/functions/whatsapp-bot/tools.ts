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
      description: 'Obtener la agenda/citas para una fecha específica. Usa cuando pregunten por su agenda, citas de hoy, de mañana, de una fecha en particular, o si quieren verificar que una cita se registró correctamente. También usa cuando digan "checa mi calendario", "verifica la cita".',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha a consultar en formato YYYY-MM-DD. Si no se especifica, usa la fecha de hoy. Para "mañana" calcula el día siguiente.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_expenses',
      description: 'Obtener gastos pendientes del usuario. Incluye gastos pagados recientes y presupuestos en cualquier estado.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'pending', 'approved_no_receipt', 'budgets'], description: 'Filtro: all=todos recientes, pending=pendientes de aprobación, approved_no_receipt=aprobados sin comprobante, budgets=solo presupuestos' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_approvals',
      description: 'Obtener presupuestos pendientes de aprobación asignados al usuario actual. Usa cuando pregunten "qué tengo por aprobar", "presupuestos pendientes", "solicitudes de aprobación".',
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
      description: 'Cancelar una o varias citas existentes. Usa cuando alguien diga "cancela mi cita", "ya no voy a ir", "quita la cita de X", "elimina todas mis citas de mañana", "cancela las citas del viernes". Puede buscar por nombre del contacto Y/O por fecha.',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string', description: 'Nombre del contacto o cliente de la cita a cancelar (opcional si se quiere cancelar por fecha)' },
          date: { type: 'string', description: 'Fecha de la(s) cita(s) a cancelar en formato YYYY-MM-DD. Para "mañana" calcula el día siguiente.' },
          cancel_all: { type: 'boolean', description: 'Si es true, cancela TODAS las citas que coincidan con los filtros. Usa cuando digan "elimina todas", "cancela todas".' },
        },
        required: [],
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

  // ──────────────── GOOGLE CALENDAR TOOLS ────────────────
  {
    type: 'function',
    function: {
      name: 'gcal_list_events',
      description: 'Listar eventos del Google Calendar del usuario. Usa cuando pidan "mis eventos de Google", "qué tengo en el calendario de Google", "eventos de la semana". Diferente de get_today_agenda que muestra citas internas.',
      parameters: {
        type: 'object',
        properties: {
          time_min: { type: 'string', description: 'Fecha/hora mínima ISO 8601 (ej: 2026-03-07T00:00:00-06:00). Default: ahora.' },
          time_max: { type: 'string', description: 'Fecha/hora máxima ISO 8601. Opcional.' },
          max_results: { type: 'number', description: 'Máximo eventos (1-50). Default: 10.' },
          query: { type: 'string', description: 'Texto para buscar en eventos. Opcional.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gcal_create_event',
      description: 'Crear un evento en Google Calendar. Usa cuando pidan "ponme un evento en Google Calendar", "agrega a mi calendario de Google". Para citas de negocio usa schedule_appointment.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Título del evento' },
          start_datetime: { type: 'string', description: 'Fecha/hora inicio ISO 8601' },
          end_datetime: { type: 'string', description: 'Fecha/hora fin ISO 8601' },
          description: { type: 'string', description: 'Descripción. Opcional.' },
          location: { type: 'string', description: 'Ubicación. Opcional.' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Emails de asistentes. Opcional.' },
        },
        required: ['summary', 'start_datetime', 'end_datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gcal_update_event',
      description: 'Modificar un evento existente en Google Calendar. Primero busca con gcal_list_events para obtener el event_id.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID del evento a modificar' },
          summary: { type: 'string', description: 'Nuevo título. Opcional.' },
          start_datetime: { type: 'string', description: 'Nueva hora inicio. Opcional.' },
          end_datetime: { type: 'string', description: 'Nueva hora fin. Opcional.' },
          description: { type: 'string', description: 'Nueva descripción. Opcional.' },
          location: { type: 'string', description: 'Nueva ubicación. Opcional.' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gcal_delete_event',
      description: 'Eliminar un evento de Google Calendar. SIEMPRE pide confirmación antes. Primero busca con gcal_list_events.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID del evento a eliminar' },
        },
        required: ['event_id'],
      },
    },
  },

  // ──────────────── PLATFORM DATA TOOLS ────────────────
  {
    type: 'function',
    function: {
      name: 'manage_contacts',
      description: 'Gestionar contactos de la plataforma: listar, buscar, crear, actualizar o eliminar. Usa cuando pidan "mis contactos", "busca al contacto X", "agrega un contacto", "actualiza el teléfono de X", "elimina el contacto X".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'search', 'create', 'update', 'delete'], description: 'Acción a realizar' },
          search_term: { type: 'string', description: 'Texto para buscar (nombre, teléfono, email). Para list/search.' },
          name: { type: 'string', description: 'Nombre del contacto. Para create/update.' },
          phone: { type: 'string', description: 'Teléfono. Para create/update.' },
          email: { type: 'string', description: 'Email. Para create/update.' },
          company: { type: 'string', description: 'Empresa. Para create/update.' },
          notes: { type: 'string', description: 'Notas. Para create/update.' },
          contact_id: { type: 'string', description: 'ID del contacto. Para update/delete.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_knowledge',
      description: 'Gestionar la base de conocimientos: listar artículos, buscar, crear nuevos o eliminar. Usa cuando pidan "qué hay en el knowledge hub", "busca información sobre X", "agrega este conocimiento", "elimina el artículo sobre X".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'search', 'create', 'delete'], description: 'Acción' },
          search_term: { type: 'string', description: 'Texto para buscar. Para search.' },
          title: { type: 'string', description: 'Título del artículo. Para create.' },
          content: { type: 'string', description: 'Contenido del artículo. Para create.' },
          category: { type: 'string', description: 'Categoría. Para create.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags. Para create.' },
          item_id: { type: 'string', description: 'ID del artículo. Para delete.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_expenses',
      description: 'Gestionar gastos: crear, aprobar, rechazar o marcar como pagado. Usa cuando pidan "crea un gasto de X", "aprueba el gasto X", "rechaza el presupuesto X", "marca como pagado".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'approve', 'reject', 'mark_paid'], description: 'Acción' },
          expense_id: { type: 'string', description: 'ID del gasto. Para approve/reject/mark_paid.' },
          amount: { type: 'number', description: 'Monto. Para create.' },
          description: { type: 'string', description: 'Descripción. Para create.' },
          category: { type: 'string', description: 'Categoría. Para create.' },
          vendor_name: { type: 'string', description: 'Proveedor. Para create.' },
          type: { type: 'string', enum: ['expense', 'budget'], description: 'Tipo: expense=gasto pagado, budget=presupuesto. Default: expense.' },
          rejection_reason: { type: 'string', description: 'Razón de rechazo. Para reject.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_members',
      description: 'Listar miembros del equipo con sus roles, estado y datos de contacto. Usa cuando pregunten "quiénes están en el equipo", "lista de empleados", "quién es el admin".',
      parameters: {
        type: 'object',
        properties: {
          search_name: { type: 'string', description: 'Buscar por nombre. Opcional.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_metrics',
      description: 'Obtener métricas del dashboard: total de llamadas, citas, gastos, tareas pendientes. Usa cuando pregunten "cómo vamos", "dame un resumen", "métricas del negocio", "estadísticas".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ──────────────── DOCUMENT & DRIVE TOOLS ────────────────
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: 'Buscar documentos almacenados en el sistema. Usa cuando pregunten "mis documentos", "busca el contrato de X", "documentos del cliente Y", "qué documentos tengo", "busca facturas".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto de búsqueda (nombre, contenido, tipo)' },
          document_type: { type: 'string', enum: ['contrato', 'factura', 'identificacion', 'cotizacion', 'comprobante', 'estado_de_cuenta', 'expediente_legal', 'reporte', 'other'], description: 'Filtrar por tipo de documento' },
          contact_phone: { type: 'string', description: 'Filtrar por teléfono del contacto que lo envió' },
          date_from: { type: 'string', description: 'Fecha inicio ISO (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'Fecha fin ISO (YYYY-MM-DD)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_detail',
      description: 'Obtener detalle completo de un documento: resumen, entidades, montos, fechas, riesgos. Usa después de search_documents para ver detalles de un documento específico.',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: 'ID del documento' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_drive_folders',
      description: 'Gestionar carpetas en Google Drive: crear, listar, buscar carpetas. Usa cuando pidan "crea una carpeta para X", "muéstrame las carpetas", "organiza en Drive".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'search'], description: 'Acción: create=crear carpeta, list=listar subcarpetas, search=buscar carpeta' },
          folder_name: { type: 'string', description: 'Nombre de la carpeta. Para create/search.' },
          parent_folder_name: { type: 'string', description: 'Nombre de la carpeta padre (opcional). Para create.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_alerts',
      description: 'Obtener alertas de documentos: vencimientos próximos, riesgos detectados, documentos incompletos. Usa cuando pregunten "hay alertas", "documentos con riesgo", "qué vence pronto".',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Filtrar por severidad' },
          resolved: { type: 'boolean', description: 'Incluir alertas resueltas. Default: false' },
        },
        required: [],
      },
    },
  },
];

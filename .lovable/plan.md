## Objetivo

Eliminar la duplicación de citas de voz (una creada por `voice-scheduling.book_appointment` desde el agente y otra creada por el webhook de Cal.com cuando ElevenLabs reserva ahí vía su tool nativa) **sin tocar** la configuración, tools ni prompt de ElevenLabs, y **sin tocar** las funciones protegidas.

## Archivos a modificar

- `supabase/functions/calcom-webhook/index.ts` — único archivo con cambios de código.

## Archivos que se dejan intactos (confirmado)

- `supabase/functions/voice-scheduling/index.ts` — el `book_appointment` sigue insertando con `source='call'`, `calendar_sync_status='PENDING_SYNC'`, `call_record_id`, y **sin** empujar a Cal.com. El `INSERT` queda tal cual está hoy.
- Configuración ElevenLabs (agent, tools, prompt, webhooks) — sin cambios.
- Funciones protegidas: `call-transfer`, `call-transfer-twiml`, `elevenlabs-actions-webhook` — sin cambios.
- `whatsapp-bot/*` y su flujo → Cal.com — sin cambios.
- `calendar-sync`, `calendar-tools`, `google-calendar-auth` (Google Calendar) — sin cambios.
- `calcom-sync` (pull periódico) — sin cambios.
- UI (`IntegrationsPage.tsx`, wizards, etc.) — sin cambios.
- Migraciones/DB — no se requieren cambios de esquema; `appointments` ya tiene `calendar_event_id`, `calendar_sync_status`, `contact_phone`, `contact_name`, `start_at`, `source`, `tenant_id`, `notes`.

## Cambios en `calcom-webhook/index.ts`

El handler actual, tras validar firma y parsear el payload de `BOOKING_CREATED`:
1. Calcula `eventId = 'calcom:' + bookingUid`.
2. Busca `appointments` por `(tenant_id, calendar_event_id = eventId)` → si existe, UPDATE; si no, INSERT nuevo con `source='calcom'`.

Se inserta una **fase de merge** entre el paso 1 y el paso 2, ejecutada solo para eventos de creación (no cancel).

### Nuevo flujo dentro del handler (solo para BOOKING_CREATED / BOOKING_RESCHEDULED, no cancel)

```text
1. Calcular eventId = 'calcom:' + bookingUid
2. Idempotencia: SELECT id FROM appointments
     WHERE tenant_id = X AND calendar_event_id = eventId
   → si existe, UPDATE campos y responder (comportamiento actual, sin cambios)

3. MERGE por metadata (nuevo):
   a. Extraer candidateAppointmentId de payload en este orden:
        - payload.metadata?.appointment_id
        - payload.payload?.metadata?.appointment_id
        - p.responses?.appointment_id?.value
      Si es un UUID válido:
        SELECT id, calendar_event_id FROM appointments
          WHERE id = candidateAppointmentId
            AND tenant_id = X
            AND deleted_at IS NULL
        Si encontrado Y calendar_event_id IS NULL (o ya = eventId):
          → mergeTargetId = ese id, saltar al paso 5.

   b. Fallback difuso (solo si no hubo match por metadata):
        Ventana temporal: startAt ± 15 min.
        SELECT id, contact_name, contact_phone, start_at
          FROM appointments
         WHERE tenant_id = X
           AND deleted_at IS NULL
           AND calendar_event_id IS NULL
           AND source IN ('call','voice')     -- creadas por voice-scheduling
           AND status <> 'cancelled'
           AND start_at BETWEEN (startAt - 15min) AND (startAt + 15min)
           AND created_at >= now() - interval '6 hours'
         ORDER BY abs(extract(epoch from (start_at - :startAt))) ASC
         LIMIT 5

        Scoring en código sobre los candidatos:
          - +3 si contact_phone normalizado (E.164) coincide con el del payload
            (p.responses?.phone?.value / p.smsReminderNumber / attendee.phone)
          - +2 si contact_name normalizado (lower/trim/sin acentos) es igual
          - +1 si similitud de nombre >= 0.6 (Jaccard sobre tokens) y no hay teléfono
          - +1 si delta |start_at - payload.start| <= 5 min
        Elegir mergeTargetId = candidato con score >= 2 y mayor score.
        Si empate, el más cercano en tiempo.

4. Sin match → INSERT como hoy con source='calcom' (comportamiento actual intacto).

5. Con match (mergeTargetId):
   UPDATE appointments
      SET calendar_event_id     = eventId,       -- 'calcom:<uid>'
          calendar_sync_status  = 'SYNCED',
          contact_email         = COALESCE(contact_email, :email),
          contact_phone         = COALESCE(contact_phone, :phone),
          service_type          = COALESCE(NULLIF(service_type,''), :title),
          start_at              = :startAt,      -- Cal.com es autoridad final
          end_at                = :endAt,
          status                = 'scheduled',
          notes                 = COALESCE(notes, :additionalNotes),
          updated_at            = now(),
          sync_attempts         = COALESCE(sync_attempts,0)
      WHERE id = mergeTargetId
        AND tenant_id = X
        AND (calendar_event_id IS NULL OR calendar_event_id = eventId);
   -- El AND final evita pisar una cita ya sincronizada con otro booking.

   Si el UPDATE afectó 0 filas (carrera), reintentar el paso 2 y, si tampoco, caer a INSERT como hoy.

6. Registrar en webhook_logs event_type='calcom_booking_merged' con
   { uid, mergeTargetId, matched_by: 'metadata'|'fuzzy', score } para trazabilidad.
```

### Reglas de idempotencia y seguridad

- El SELECT del paso 2 sigue siendo la primera línea de defensa: reintentos de Cal.com sobre el mismo `bookingUid` nunca duplican.
- El merge del paso 3 solo se aplica a filas con `calendar_event_id IS NULL`, así que un segundo webhook con otro `uid` no puede robar una cita ya sincronizada.
- El fallback difuso exige `source IN ('call','voice')` y ventana temporal + score mínimo para no absorber accidentalmente citas de otro canal (WhatsApp, manual).
- `BOOKING_RESCHEDULED` y `BOOKING_CANCELLED` mantienen exactamente su lógica actual (buscan por `calendar_event_id`); el merge solo aplica en creación.

### Helper interno (dentro del mismo archivo, no exportado)

- `extractAppointmentIdFromPayload(payload): string | null` — chequea las tres rutas de metadata.
- `normalizeName(s): string` y `normalizePhoneE164(s): string | null` — para el scoring.
- `pickFuzzyMatch(candidates, payload): { id, score } | null`.

Todo va dentro de `calcom-webhook/index.ts` para no crear módulos nuevos.

## Validación posterior a la implementación

1. Logs de `calcom-webhook`: buscar `calcom_booking_merged` tras una llamada de voz que reserve en Cal.com → debe aparecer con `matched_by`.
2. Query: `SELECT count(*) FROM appointments WHERE source='call' AND created_at > now() - interval '1 day' AND calendar_event_id IS NOT NULL` → debe crecer 1 por llamada agendada (antes crecía 0 y aparecía un duplicado `source='calcom'`).
3. Query: `SELECT count(*) FROM appointments WHERE source='calcom' AND created_at > now() - interval '1 day'` → solo debe contar reservas hechas directamente en Cal.com por humanos, no las originadas por voz.
4. Reenviar manualmente el mismo webhook (mismo `uid`) → no debe crear ni mergear otra vez (idempotencia por `calendar_event_id`).
5. Reserva directa desde Cal.com sin llamada previa → sigue insertando con `source='calcom'` (fallback intacto).

## Confirmaciones

- ElevenLabs (agente, tool nativa de Cal.com, prompt, webhooks): **sin cambios**.
- `call-transfer`, `call-transfer-twiml`, `elevenlabs-actions-webhook`: **sin cambios**.
- `voice-scheduling.book_appointment`: **sin cambios** — sigue insertando con `source='call'`, sin empujar a Cal.com.
- Flujo WhatsApp → Cal.com, Google Calendar sync, UI de Integraciones: **sin cambios**.
- Único archivo tocado: `supabase/functions/calcom-webhook/index.ts`.

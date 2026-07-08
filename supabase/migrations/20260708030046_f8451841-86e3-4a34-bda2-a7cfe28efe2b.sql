
CREATE OR REPLACE FUNCTION public.schedule_appointment_reminders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tz text := 'America/Mexico_City';
  _tenant_name text;
  _tenant_settings jsonb;
  _location text;
  _date_display text;
  _time_display text;
  _reminder_24h timestamptz;
  _reminder_1h timestamptz;
  _msg_24h text;
  _msg_24h_wa text;
  _msg_1h text;
  _has_phone boolean;
  _has_email boolean;
  _is_cancelled boolean;
  _prev_cancelled boolean;
BEGIN
  _is_cancelled := (NEW.status = 'cancelled' OR NEW.deleted_at IS NOT NULL);

  IF TG_OP = 'UPDATE' THEN
    _prev_cancelled := (OLD.status = 'cancelled' OR OLD.deleted_at IS NOT NULL);
    IF _is_cancelled THEN
      UPDATE public.appointment_notifications
        SET status = 'cancelled'
        WHERE appointment_id = NEW.id
          AND status IN ('pending','failed')
          AND notification_type IN ('reminder_24h','reminder_1h','reminder_whatsapp');
      RETURN NEW;
    END IF;

    IF NEW.start_at IS NOT DISTINCT FROM OLD.start_at AND NOT _prev_cancelled THEN
      RETURN NEW;
    END IF;

    UPDATE public.appointment_notifications
      SET status = 'cancelled'
      WHERE appointment_id = NEW.id
        AND status IN ('pending','failed')
        AND notification_type IN ('reminder_24h','reminder_1h','reminder_whatsapp')
        AND target_user_id IS NULL;
  ELSE
    IF _is_cancelled THEN
      RETURN NEW;
    END IF;
  END IF;

  _has_phone := (NEW.contact_phone IS NOT NULL AND length(trim(NEW.contact_phone)) > 0);
  _has_email := (NEW.contact_email IS NOT NULL AND length(trim(NEW.contact_email)) > 0);

  IF NOT _has_phone AND NOT _has_email THEN
    RETURN NEW;
  END IF;

  SELECT name, settings_json INTO _tenant_name, _tenant_settings
  FROM public.tenants WHERE id = NEW.tenant_id;
  _tenant_name := COALESCE(_tenant_name, 'Nuestro negocio');
  _location := COALESCE(NULLIF(_tenant_settings->>'location',''), NULLIF(_tenant_settings->>'address',''), '');

  _date_display := to_char(NEW.start_at AT TIME ZONE _tz, 'TMDay DD "de" TMMonth');
  _time_display := to_char(NEW.start_at AT TIME ZONE _tz, 'HH24:MI');

  _reminder_24h := NEW.start_at - interval '24 hours';
  _reminder_1h  := NEW.start_at - interval '1 hour';

  _msg_24h := format(E'Hola %s,\n\nTe recordamos tu cita programada con %s para mañana:\n\n📆 %s\n⏰ %s%s%s%s\n\nSi necesitas reprogramar o cancelar, responde a este correo o llámanos.\n\n¡Te esperamos!',
    NEW.contact_name,
    _tenant_name,
    _date_display,
    _time_display,
    CASE WHEN NEW.service_type IS NOT NULL THEN E'\n📋 ' || NEW.service_type ELSE '' END,
    CASE WHEN _location <> '' THEN E'\n📍 ' || _location ELSE '' END,
    CASE WHEN NEW.notes IS NOT NULL THEN E'\n📝 ' || NEW.notes ELSE '' END
  );

  _msg_24h_wa := format(E'Hola %s 👋\n\nTe recordamos tu cita con *%s* para mañana:\n\n📆 %s\n⏰ %s%s%s\n\nSi necesitas reprogramar o cancelar, responde a este mensaje.',
    NEW.contact_name,
    _tenant_name,
    _date_display,
    _time_display,
    CASE WHEN NEW.service_type IS NOT NULL THEN E'\n📋 ' || NEW.service_type ELSE '' END,
    CASE WHEN _location <> '' THEN E'\n📍 ' || _location ELSE '' END
  );

  _msg_1h := format('Llamada de confirmación: cita de %s hoy %s con %s',
    NEW.contact_name, _time_display, _tenant_name);

  -- 24h email (requires email)
  IF _reminder_24h > now() AND _has_email THEN
    INSERT INTO public.appointment_notifications
      (appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body)
    VALUES
      (NEW.id, NEW.tenant_id, NULL, NEW.contact_email,
       'reminder_24h', 'pending', _reminder_24h, _msg_24h);
  END IF;

  -- 24h WhatsApp (requires phone) — SAME 24h scheduled_at
  IF _reminder_24h > now() AND _has_phone THEN
    INSERT INTO public.appointment_notifications
      (appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body)
    VALUES
      (NEW.id, NEW.tenant_id, NEW.contact_phone, NULL,
       'reminder_whatsapp', 'pending', _reminder_24h, _msg_24h_wa);
  END IF;

  -- 1h voice call (requires phone)
  IF _reminder_1h > now() AND _has_phone THEN
    INSERT INTO public.appointment_notifications
      (appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body)
    VALUES
      (NEW.id, NEW.tenant_id, NEW.contact_phone, NEW.contact_email,
       'reminder_1h', 'pending', _reminder_1h, _msg_1h);
  END IF;

  RETURN NEW;
END;
$function$;

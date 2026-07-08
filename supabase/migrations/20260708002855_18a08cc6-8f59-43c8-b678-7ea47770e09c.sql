
-- 1) reminders: add channel + contact fields
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reminders_channel_check'
  ) THEN
    ALTER TABLE public.reminders
      ADD CONSTRAINT reminders_channel_check
      CHECK (channel IN ('whatsapp','email'));
  END IF;
END $$;

-- 2) appointment_notifications: add target_email
ALTER TABLE public.appointment_notifications
  ADD COLUMN IF NOT EXISTS target_email text;

-- 3) Trigger function to auto-schedule client reminders (24h + 1h) on appointment insert/update
CREATE OR REPLACE FUNCTION public.schedule_appointment_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  _msg_1h text;
  _has_phone boolean;
  _has_email boolean;
  _is_cancelled boolean;
  _prev_cancelled boolean;
BEGIN
  _is_cancelled := (NEW.status = 'cancelled' OR NEW.deleted_at IS NOT NULL);

  -- On UPDATE: if cancelled/deleted, cancel any pending client reminders and exit
  IF TG_OP = 'UPDATE' THEN
    _prev_cancelled := (OLD.status = 'cancelled' OR OLD.deleted_at IS NOT NULL);
    IF _is_cancelled THEN
      UPDATE public.appointment_notifications
        SET status = 'cancelled'
        WHERE appointment_id = NEW.id
          AND status IN ('pending','failed')
          AND notification_type IN ('reminder_24h','reminder_1h');
      RETURN NEW;
    END IF;

    -- If start_at unchanged and it was already active, nothing to do
    IF NEW.start_at IS NOT DISTINCT FROM OLD.start_at AND NOT _prev_cancelled THEN
      RETURN NEW;
    END IF;

    -- Otherwise (start_at changed or reactivated): clear existing pending client reminders and reprogram below
    UPDATE public.appointment_notifications
      SET status = 'cancelled'
      WHERE appointment_id = NEW.id
        AND status IN ('pending','failed')
        AND notification_type IN ('reminder_24h','reminder_1h')
        AND target_user_id IS NULL;
  ELSE
    -- INSERT: if arriving already cancelled, do nothing
    IF _is_cancelled THEN
      RETURN NEW;
    END IF;
  END IF;

  _has_phone := (NEW.contact_phone IS NOT NULL AND length(trim(NEW.contact_phone)) > 0);
  _has_email := (NEW.contact_email IS NOT NULL AND length(trim(NEW.contact_email)) > 0);

  -- Need at least one channel of contact
  IF NOT _has_phone AND NOT _has_email THEN
    RETURN NEW;
  END IF;

  -- Tenant info
  SELECT name, settings_json INTO _tenant_name, _tenant_settings
  FROM public.tenants WHERE id = NEW.tenant_id;
  _tenant_name := COALESCE(_tenant_name, 'Nuestro negocio');
  _location := COALESCE(NULLIF(_tenant_settings->>'location',''), NULLIF(_tenant_settings->>'address',''), '');

  _date_display := to_char(NEW.start_at AT TIME ZONE _tz, 'TMDay DD "de" TMMonth');
  _time_display := to_char(NEW.start_at AT TIME ZONE _tz, 'HH24:MI');

  _reminder_24h := NEW.start_at - interval '24 hours';
  _reminder_1h  := NEW.start_at - interval '1 hour';

  _msg_24h := format(E'⏰ *Recordatorio de tu cita — %s*\n\nHola *%s*, te recordamos tu cita mañana:\n\n📆 %s\n⏰ %s%s%s%s\n\n¡Te esperamos! 😊',
    _tenant_name,
    NEW.contact_name,
    _date_display,
    _time_display,
    CASE WHEN NEW.service_type IS NOT NULL THEN E'\n📋 ' || NEW.service_type ELSE '' END,
    CASE WHEN _location <> '' THEN E'\n📍 ' || _location ELSE '' END,
    CASE WHEN NEW.notes IS NOT NULL THEN E'\n📝 ' || NEW.notes ELSE '' END
  );

  _msg_1h := format(E'⏰ *Tu cita es en 1 hora — %s*\n\nHola *%s*, tu cita es hoy a las %s.%s%s\n\n¡Te esperamos! 🙌',
    _tenant_name,
    NEW.contact_name,
    _time_display,
    CASE WHEN NEW.service_type IS NOT NULL THEN E'\n📋 ' || NEW.service_type ELSE '' END,
    CASE WHEN _location <> '' THEN E'\n📍 ' || _location ELSE '' END
  );

  -- Insert reminder_24h if in the future
  IF _reminder_24h > now() THEN
    INSERT INTO public.appointment_notifications
      (appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body)
    VALUES
      (NEW.id, NEW.tenant_id,
       CASE WHEN _has_phone THEN NEW.contact_phone ELSE NULL END,
       CASE WHEN _has_email THEN NEW.contact_email ELSE NULL END,
       'reminder_24h', 'pending', _reminder_24h, _msg_24h);
  END IF;

  -- Insert reminder_1h if in the future
  IF _reminder_1h > now() THEN
    INSERT INTO public.appointment_notifications
      (appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body)
    VALUES
      (NEW.id, NEW.tenant_id,
       CASE WHEN _has_phone THEN NEW.contact_phone ELSE NULL END,
       CASE WHEN _has_email THEN NEW.contact_email ELSE NULL END,
       'reminder_1h', 'pending', _reminder_1h, _msg_1h);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_appointment_reminders_ins ON public.appointments;
CREATE TRIGGER trg_schedule_appointment_reminders_ins
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.schedule_appointment_reminders();

DROP TRIGGER IF EXISTS trg_schedule_appointment_reminders_upd ON public.appointments;
CREATE TRIGGER trg_schedule_appointment_reminders_upd
  AFTER UPDATE OF start_at, status, deleted_at ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.schedule_appointment_reminders();

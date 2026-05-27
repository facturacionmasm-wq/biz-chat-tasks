import { useState, useCallback, useEffect } from 'react';
import { CalendarPlus, Phone, MessageSquare, Monitor, User, Clock, CheckCircle2, XCircle, AlertCircle, Plus, ChevronLeft, ChevronRight, RefreshCw, Users, Pencil, Trash2, MoreHorizontal, X } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

interface Appointment {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  serviceType: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  source: string | null;
  notes: string | null;
  userId: string | null;
  employeeName?: string;
  calendarSyncStatus?: string;
  calendarEventId?: string | null;
}

interface Employee {
  userId: string;
  name: string;
}

interface AvailabilityRule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  userId: string | null;
  active: boolean;
}

interface AppointmentForm {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  serviceType: string;
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
  notes: string;
  status: string;
}

const emptyForm: AppointmentForm = {
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  serviceType: '',
  date: '',
  startTime: '',
  endTime: '',
  userId: '',
  notes: '',
  status: 'scheduled',
};

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
  scheduled: { label: 'Agendada', className: 'bg-primary/10 text-[var(--rx-brand)]', icon: Clock },
  confirmed: { label: 'Confirmada', className: 'bg-green-500/10 text-green-600', icon: CheckCircle2 },
  completed: { label: 'Completada', className: 'bg-[var(--rx-s2)] text-[var(--rx-t2)]', icon: CheckCircle2 },
  cancelled: { label: 'Cancelada', className: 'bg-destructive/10 text-[var(--rx-rose)]', icon: XCircle },
  no_show: { label: 'No asistió', className: 'bg-orange-500/10 text-orange-600', icon: AlertCircle },
};

const sourceIcons: Record<string, { icon: any; label: string }> = {
  call: { icon: Phone, label: 'Llamada' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp' },
  app: { icon: Monitor, label: 'App' },
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

const AppointmentsPage = () => {
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [availRules, setAvailRules] = useState<AvailabilityRule[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [form, setForm] = useState<AppointmentForm>({ ...emptyForm });

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aptsRes, profilesRes, rulesRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*')
          .is('deleted_at', null)
          .gte('start_at', weekStart.toISOString())
          .lte('start_at', weekEnd.toISOString())
          .order('start_at', { ascending: true }),
        supabase.from('profiles_safe' as any).select('user_id, name').eq('status', 'active') as unknown as Promise<{ data: any[] | null; error: any }>,
        supabase.from('availability_rules').select('*').eq('active', true),
      ]);

      if (profilesRes.data) {
        setEmployees(profilesRes.data.map(p => ({ userId: p.user_id, name: p.name })));
      }

      if (rulesRes.data) {
        setAvailRules(rulesRes.data.map(r => ({
          dayOfWeek: r.day_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          userId: r.user_id,
          active: r.active ?? true,
        })));
      }

      if (aptsRes.data) {
        const profileMap = new Map((profilesRes.data || []).map(p => [p.user_id, p.name]));
        setAppointments(aptsRes.data.map(a => ({
          id: a.id,
          contactName: a.contact_name,
          contactPhone: a.contact_phone,
          contactEmail: a.contact_email,
          serviceType: a.service_type,
          startAt: new Date(a.start_at),
          endAt: new Date(a.end_at),
          status: a.status,
          source: a.source,
          notes: a.notes,
          userId: a.user_id,
          employeeName: a.user_id ? profileMap.get(a.user_id) || 'Desconocido' : 'Sin asignar',
          calendarSyncStatus: a.calendar_sync_status,
          calendarEventId: a.calendar_event_id,
        })));
      }
    } catch (err) {
      console.error('Error loading appointments:', err);
      toast.error('Error al cargar citas');
    } finally {
      setLoading(false);
    }
  }, [weekStart.toISOString(), weekEnd.toISOString()]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('appointments_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // ─── CREATE ───
  const handleCreate = async () => {
    if (!form.contactName || !form.date || !form.startTime) {
      toast.error('Nombre, fecha y hora de inicio son requeridos');
      return;
    }
    setSaving(true);
    try {
      const startAt = new Date(`${form.date}T${form.startTime}:00`);
      const endAt = form.endTime
        ? new Date(`${form.date}T${form.endTime}:00`)
        : new Date(startAt.getTime() + 30 * 60000);

      if (endAt <= startAt) {
        toast.error('La hora de fin debe ser posterior a la hora de inicio');
        setSaving(false);
        return;
      }

      const { data: apt, error } = await supabase
        .from('appointments')
        .insert({
          contact_name: form.contactName,
          contact_phone: form.contactPhone || null,
          contact_email: form.contactEmail || null,
          service_type: form.serviceType || null,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          user_id: form.userId || null,
          notes: form.notes || null,
          source: 'app',
          status: form.status || 'scheduled',
          calendar_sync_status: 'PENDING_SYNC',
          tenant_id: (await supabase.rpc('get_user_tenant_id', { _user_id: (await supabase.auth.getUser()).data.user?.id })).data,
        })
        .select('id, user_id')
        .single();

      if (error) throw error;

      // Trigger calendar sync
      if (apt?.user_id) {
        triggerCalendarSync(apt.id, 'sync_appointment');
      }

      // Send WhatsApp confirmation to the contact
      if (form.contactPhone) {
        const assignedEmployee = employees.find(e => e.userId === form.userId);
        const dateStr = format(startAt, "EEEE d 'de' MMMM", { locale: es });
        const timeStr = `${form.startTime} - ${form.endTime || format(endAt, 'HH:mm')}`;
        const confirmMsg = `📅 *Nueva Cita Agendada*\n\nHola ${form.contactName}, se ha agendado una cita para ti:\n\n📆 ${dateStr}\n⏰ ${timeStr}${form.serviceType ? `\n🏷️ ${form.serviceType}` : ''}${assignedEmployee ? `\n👤 Con: ${assignedEmployee.name}` : ''}\n\nResponde *CONFIRMO* para confirmar tu asistencia o *CANCELO* para cancelar.`;
        
        supabase.functions.invoke('twilio-send', {
          body: { to: form.contactPhone, body: confirmMsg },
        }).then(({ error: sendErr }) => {
          if (sendErr) {
            console.error('Error sending WhatsApp confirmation to contact:', sendErr);
          } else {
            toast.info(`Confirmación enviada por WhatsApp a ${form.contactName}`);
          }
        });
      }

      toast.success('Cita creada exitosamente');
      setShowCreateDialog(false);
      setForm({ ...emptyForm });
    } catch (err: any) {
      console.error('Create appointment error:', err);
      toast.error(err.message || 'Error al crear la cita');
    } finally {
      setSaving(false);
    }
  };

  // ─── EDIT ───
  const handleEdit = async () => {
    if (!selectedAppointment || !form.contactName || !form.date || !form.startTime) {
      toast.error('Nombre, fecha y hora de inicio son requeridos');
      return;
    }
    setSaving(true);
    try {
      const startAt = new Date(`${form.date}T${form.startTime}:00`);
      const endAt = form.endTime
        ? new Date(`${form.date}T${form.endTime}:00`)
        : new Date(startAt.getTime() + 30 * 60000);

      if (endAt <= startAt) {
        toast.error('La hora de fin debe ser posterior a la hora de inicio');
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from('appointments')
        .update({
          contact_name: form.contactName,
          contact_phone: form.contactPhone || null,
          contact_email: form.contactEmail || null,
          service_type: form.serviceType || null,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          user_id: form.userId || null,
          notes: form.notes || null,
          status: form.status,
        })
        .eq('id', selectedAppointment.id);

      if (error) throw error;

      // Trigger calendar update/sync
      if (selectedAppointment.calendarEventId) {
        triggerCalendarSync(selectedAppointment.id, 'update_event');
      } else if (form.userId) {
        triggerCalendarSync(selectedAppointment.id, 'sync_appointment');
      }

      toast.success('Cita actualizada exitosamente');
      setShowEditDialog(false);
      setSelectedAppointment(null);
    } catch (err: any) {
      console.error('Edit appointment error:', err);
      toast.error(err.message || 'Error al actualizar la cita');
    } finally {
      setSaving(false);
    }
  };

  // ─── CANCEL/DELETE ───
  const handleCancel = async () => {
    if (!selectedAppointment) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', selectedAppointment.id);

      if (error) throw error;

      // Delete from Google Calendar
      if (selectedAppointment.calendarEventId) {
        triggerCalendarSync(selectedAppointment.id, 'cancel_event');
      }

      toast.success('Cita cancelada exitosamente');
      setShowDeleteDialog(false);
      setSelectedAppointment(null);
    } catch (err: any) {
      console.error('Cancel appointment error:', err);
      toast.error(err.message || 'Error al cancelar la cita');
    } finally {
      setSaving(false);
    }
  };

  // ─── STATUS CHANGE ───
  const handleStatusChange = async (apt: Appointment, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ status: newStatus })
        .eq('id', apt.id);

      if (error) throw error;

      if (newStatus === 'cancelled' && apt.calendarEventId) {
        triggerCalendarSync(apt.id, 'cancel_event');
      }

      toast.success(`Estado cambiado a: ${statusConfig[newStatus]?.label || newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Error al cambiar estado');
    }
  };

  // ─── CALENDAR SYNC HELPER ───
  const triggerCalendarSync = async (appointmentId: string, action: string) => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      if (!projectId) return;
      await supabase.functions.invoke('calendar-sync', {
        body: { action, appointment_id: appointmentId },
      });
    } catch (err) {
      console.error('Calendar sync trigger error:', err);
    }
  };

  // ─── OPEN EDIT DIALOG ───
  const openEditDialog = (apt: Appointment) => {
    setSelectedAppointment(apt);
    setForm({
      contactName: apt.contactName,
      contactPhone: apt.contactPhone || '',
      contactEmail: apt.contactEmail || '',
      serviceType: apt.serviceType || '',
      date: format(apt.startAt, 'yyyy-MM-dd'),
      startTime: format(apt.startAt, 'HH:mm'),
      endTime: format(apt.endAt, 'HH:mm'),
      userId: apt.userId || '',
      notes: apt.notes || '',
      status: apt.status,
    });
    setShowEditDialog(true);
  };

  // ─── OPEN CREATE DIALOG ───
  const openCreateDialog = (date?: Date, hour?: number) => {
    const d = date || new Date();
    const h = hour ?? 9;
    setForm({
      ...emptyForm,
      date: format(d, 'yyyy-MM-dd'),
      startTime: `${h.toString().padStart(2, '0')}:00`,
      endTime: `${h.toString().padStart(2, '0')}:30`,
    });
    setShowCreateDialog(true);
  };

  const filteredAppointments = selectedEmployee
    ? appointments.filter(a => a.userId === selectedEmployee)
    : appointments;

  const getAptsForDayHour = (day: Date, hour: number) =>
    filteredAppointments.filter(a => isSameDay(a.startAt, day) && a.startAt.getHours() === hour);

  const stats = {
    total: appointments.length,
    scheduled: appointments.filter(a => a.status === 'scheduled').length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    cancelled: appointments.filter(a => a.status === 'cancelled').length,
  };

  // ─── FORM FIELDS (shared between create/edit) ───
  const renderFormFields = () => (
    <div className="grid gap-4 py-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="contactName">Nombre del cliente *</Label>
          <Input id="contactName" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Nombre completo" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactPhone">Teléfono</Label>
          <Input id="contactPhone" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+52..." />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="contactEmail">Email</Label>
          <Input id="contactEmail" type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="correo@ejemplo.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="serviceType">Tipo de servicio</Label>
          <Input id="serviceType" value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))} placeholder="Ej: Consulta, Corte, etc." />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">Fecha *</Label>
          <Input id="date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startTime">Hora inicio *</Label>
          <Input id="startTime" type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">Hora fin</Label>
          <Input id="endTime" type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Empleado asignado</Label>
          <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v === '__none__' ? '' : v }))}>
            <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin asignar</SelectItem>
              {employees.map(emp => (
                <SelectItem key={emp.userId} value={emp.userId}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Estado</Label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Agendada</SelectItem>
              <SelectItem value="confirmed">Confirmada</SelectItem>
              <SelectItem value="completed">Completada</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
              <SelectItem value="no_show">No asistió</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas adicionales..." rows={2} />
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 h-full flex flex-col max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CalendarPlus size={20} className="text-[var(--rx-brand)]" /> Agenda de Citas
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">
            Semana del {format(weekStart, "d MMM", { locale: es })} al {format(weekEnd, "d MMM yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => openCreateDialog()} className="gap-1">
            <Plus size={14} /> Nueva Cita
          </Button>
          <button onClick={() => setView('calendar')} className={`text-xs px-3 py-1.5 rounded-md ${view === 'calendar' ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground' : 'text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]'}`}>Calendario</button>
          <button onClick={() => setView('list')} className={`text-xs px-3 py-1.5 rounded-md ${view === 'list' ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground' : 'text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]'}`}>Lista</button>
          <button onClick={loadData} className="p-1.5 rounded-lg bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/80 text-[var(--rx-t2)]"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4 shrink-0">
        {[
          { label: 'Total', value: stats.total, cls: 'text-foreground' },
          { label: 'Agendadas', value: stats.scheduled, cls: 'text-[var(--rx-brand)]' },
          { label: 'Confirmadas', value: stats.confirmed, cls: 'text-green-600' },
          { label: 'Canceladas', value: stats.cancelled, cls: 'text-[var(--rx-rose)]' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-[var(--rx-b1)] rounded-lg p-2 sm:p-3 text-center">
            <p className={`text-lg sm:text-xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-[10px] sm:text-xs text-[var(--rx-t2)]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Employee filter + Week navigation */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Users size={14} className="text-[var(--rx-t2)] shrink-0" />
          <select
            value={selectedEmployee || ''}
            onChange={e => setSelectedEmployee(e.target.value || null)}
            className="bg-card border border-[var(--rx-b1)] rounded-lg text-sm px-2 py-1.5 outline-none text-foreground flex-1 min-w-0"
          >
            <option value="">Todos los empleados</option>
            {employees.map(emp => (
              <option key={emp.userId} value={emp.userId}>{emp.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 justify-center">
          <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-1.5 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]"><ChevronLeft size={16} /></button>
          <button onClick={() => setCurrentWeek(new Date())} className="text-xs px-3 py-1.5 rounded-md bg-[var(--rx-s2)] text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]/80">Hoy</button>
          <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-1.5 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Calendar View */}
      {view === 'calendar' && (
        <div className="flex-1 border border-[var(--rx-b1)] rounded-xl bg-card overflow-auto min-h-0">
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-[var(--rx-b1)] sticky top-0 bg-card z-10">
            <div className="border-r border-[var(--rx-b1)]" />
            {weekDays.map(day => {
              const isToday = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className={`text-center py-2 border-r border-[var(--rx-b1)] last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                  <p className="text-[10px] sm:text-xs text-[var(--rx-t2)] uppercase">{format(day, 'EEE', { locale: es })}</p>
                  <p className={`text-sm font-bold ${isToday ? 'text-[var(--rx-brand)]' : 'text-foreground'}`}>{format(day, 'd')}</p>
                </div>
              );
            })}
          </div>

          {HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-[var(--rx-b1)] last:border-b-0 min-h-[60px]">
              <div className="border-r border-[var(--rx-b1)] flex items-start justify-end pr-2 pt-1">
                <span className="text-[10px] text-[var(--rx-t2)]">{`${hour}:00`}</span>
              </div>
              {weekDays.map(day => {
                const dayApts = getAptsForDayHour(day, hour);
                const isToday = isSameDay(day, new Date());
                const dayOfWeek = day.getDay();
                const hasAvailability = availRules.some(r =>
                  r.dayOfWeek === dayOfWeek &&
                  (!selectedEmployee || r.userId === selectedEmployee) &&
                  parseInt(r.startTime.split(':')[0]) <= hour &&
                  parseInt(r.endTime.split(':')[0]) > hour
                );

                return (
                  <div
                    key={day.toISOString()}
                    className={`border-r border-[var(--rx-b1)] last:border-r-0 p-0.5 cursor-pointer hover:bg-primary/5 transition-colors ${
                      isToday ? 'bg-primary/5' : hasAvailability ? '' : 'bg-[var(--rx-s2)]/20'
                    }`}
                    onClick={() => openCreateDialog(day, hour)}
                  >
                    {dayApts.map(apt => {
                      const sc = statusConfig[apt.status] || statusConfig.scheduled;
                      return (
                        <div
                          key={apt.id}
                          className={`text-[10px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer ${sc.className} hover:opacity-80`}
                          title={`${apt.contactName} - ${apt.serviceType || 'General'}`}
                          onClick={(e) => { e.stopPropagation(); openEditDialog(apt); }}
                        >
                          <span className="font-medium">{format(apt.startAt, 'HH:mm')}</span>{' '}
                          <span className="hidden sm:inline">{apt.contactName}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="flex-1 overflow-auto min-h-0">
          {filteredAppointments.length === 0 ? (
            <div className="rx-panel">
              <CalendarPlus size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay citas para esta semana</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => openCreateDialog()}>
                <Plus size={14} className="mr-1" /> Crear primera cita
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAppointments.map(apt => {
                const sc = statusConfig[apt.status] || statusConfig.scheduled;
                const src = sourceIcons[apt.source || 'app'] || sourceIcons.app;
                const SIcon = sc.icon;
                const SrcIcon = src.icon;
                return (
                  <div key={apt.id} className="rx-panel">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}><SIcon size={12} /> {sc.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--rx-t2)]"><SrcIcon size={12} /> {src.label}</span>
                        {apt.employeeName && (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--rx-t2)]"><User size={12} /> {apt.employeeName}</span>
                        )}
                        {/* Actions dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-[var(--rx-s2)] text-[var(--rx-t2)]"><MoreHorizontal size={14} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(apt)}>
                              <Pencil size={14} className="mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {apt.status !== 'confirmed' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(apt, 'confirmed')}>
                                <CheckCircle2 size={14} className="mr-2" /> Confirmar
                              </DropdownMenuItem>
                            )}
                            {apt.status !== 'completed' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(apt, 'completed')}>
                                <CheckCircle2 size={14} className="mr-2" /> Completar
                              </DropdownMenuItem>
                            )}
                            {apt.status !== 'no_show' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(apt, 'no_show')}>
                                <AlertCircle size={14} className="mr-2" /> No asistió
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {apt.status !== 'cancelled' && (
                              <DropdownMenuItem className="text-[var(--rx-rose)]" onClick={() => { setSelectedAppointment(apt); setShowDeleteDialog(true); }}>
                                <XCircle size={14} className="mr-2" /> Cancelar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <p className="font-medium text-foreground">{apt.contactName}</p>
                    {apt.contactPhone && <p className="text-xs text-[var(--rx-t2)]">{apt.contactPhone}</p>}
                    <div className="flex items-center justify-between text-xs text-[var(--rx-t2)] mt-2">
                      <span>{apt.serviceType || 'General'}</span>
                      <span className="font-medium text-foreground">
                        {format(apt.startAt, "EEE d MMM", { locale: es })} · {format(apt.startAt, 'HH:mm')} - {format(apt.endAt, 'HH:mm')}
                      </span>
                    </div>
                    {apt.notes && <p className="text-xs text-[var(--rx-t2)] mt-2 italic">{apt.notes}</p>}
                    {apt.calendarSyncStatus === 'SYNCED' && (
                      <p className="text-[10px] text-green-600 mt-1">✓ Sincronizada con Google Calendar</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── CREATE DIALOG ─── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva Cita</DialogTitle>
            <DialogDescription>Completa los datos para agendar una nueva cita.</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Guardando...' : 'Crear Cita'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── EDIT DIALOG ─── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Cita</DialogTitle>
            <DialogDescription>Modifica los datos de la cita.</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? 'Guardando...' : 'Guardar Cambios'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── DELETE/CANCEL DIALOG ─── */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Cita</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas cancelar la cita de <strong>{selectedAppointment?.contactName}</strong> del{' '}
              {selectedAppointment && format(selectedAppointment.startAt, "d 'de' MMMM 'a las' HH:mm", { locale: es })}?
              {selectedAppointment?.calendarEventId && ' También se eliminará de Google Calendar.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>No, mantener</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={saving}>{saving ? 'Cancelando...' : 'Sí, cancelar cita'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AppointmentsPage;

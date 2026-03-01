import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhoneOutgoing } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ManualCallDialogProps {
  onCallRegistered: () => void;
}

const ManualCallDialog = ({ onCallRegistered }: ManualCallDialogProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    toNumber: '',
    fromNumber: '',
    contactName: '',
    durationMin: '',
    durationSec: '',
    status: 'completed',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.toNumber.trim()) {
      toast.error('El número de destino es obligatorio');
      return;
    }

    setLoading(true);
    try {
      const duration = (parseInt(form.durationMin || '0') * 60) + parseInt(form.durationSec || '0');
      const now = new Date().toISOString();
      const startedAt = new Date(Date.now() - duration * 1000).toISOString();

      const { error } = await supabase.from('call_records').insert({
        to_number: form.toNumber.trim(),
        from_number: form.fromNumber.trim() || null,
        status: form.status,
        duration,
        started_at: startedAt,
        ended_at: now,
        channel: 'manual',
        summary_human: form.notes.trim() || null,
        extracted_data: form.contactName.trim() ? { contactName: form.contactName.trim() } : {},
        recording_status: 'not_requested',
        transcript_status: 'not_requested',
        summary_status: form.notes.trim() ? 'ready' : 'not_requested',
        appointment_status: 'not_requested',
        tenant_id: (await supabase.rpc('get_user_tenant_id', { _user_id: (await supabase.auth.getUser()).data.user!.id })).data!,
      });

      if (error) throw error;

      toast.success('Llamada registrada exitosamente');
      setForm({ toNumber: '', fromNumber: '', contactName: '', durationMin: '', durationSec: '', status: 'completed', notes: '' });
      setOpen(false);
      onCallRegistered();
    } catch (err: any) {
      toast.error('Error al registrar: ' + (err.message || 'Error desconocido'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <PhoneOutgoing size={14} />
          Registrar llamada
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar llamada manual</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="toNumber">Número destino *</Label>
              <Input id="toNumber" placeholder="+52..." value={form.toNumber} onChange={e => setForm(f => ({ ...f, toNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fromNumber">Tu número</Label>
              <Input id="fromNumber" placeholder="+52..." value={form.fromNumber} onChange={e => setForm(f => ({ ...f, fromNumber: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contactName">Nombre del contacto</Label>
            <Input id="contactName" placeholder="Nombre del cliente..." value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Duración</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min="0" placeholder="min" value={form.durationMin} onChange={e => setForm(f => ({ ...f, durationMin: e.target.value }))} className="text-center" />
                <span className="text-muted-foreground">:</span>
                <Input type="number" min="0" max="59" placeholder="seg" value={form.durationSec} onChange={e => setForm(f => ({ ...f, durationSec: e.target.value }))} className="text-center" />
              </div>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completada</SelectItem>
                  <SelectItem value="no_answer">Sin respuesta</SelectItem>
                  <SelectItem value="busy">Ocupado</SelectItem>
                  <SelectItem value="canceled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas / Resumen</Label>
            <Textarea id="notes" placeholder="Resumen de la llamada..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Registrando...' : 'Registrar llamada'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ManualCallDialog;

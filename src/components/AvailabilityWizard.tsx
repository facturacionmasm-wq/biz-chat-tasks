import { useState } from 'react';
import { Clock, Check } from 'lucide-react';

const DAYS = [
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
];

export interface AvailabilityRule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
  buffer_before: number;
  buffer_after: number;
  max_appointments: number;
}

const DEFAULT_RULES: AvailabilityRule[] = DAYS.map(d => ({
  day_of_week: d.value,
  start_time: d.value <= 5 ? '09:00' : '09:00',
  end_time: d.value <= 5 ? '18:00' : '14:00',
  active: d.value <= 5,
  buffer_before: 10,
  buffer_after: 10,
  max_appointments: 8,
}));

interface AvailabilityWizardProps {
  value: AvailabilityRule[];
  onChange: (rules: AvailabilityRule[]) => void;
}

const AvailabilityWizard = ({ value, onChange }: AvailabilityWizardProps) => {
  const rules = value.length > 0 ? value : DEFAULT_RULES;

  const toggleDay = (dayOfWeek: number) => {
    const updated = rules.map(r =>
      r.day_of_week === dayOfWeek ? { ...r, active: !r.active } : r
    );
    onChange(updated);
  };

  const updateRule = (dayOfWeek: number, field: keyof AvailabilityRule, val: string | number) => {
    const updated = rules.map(r =>
      r.day_of_week === dayOfWeek ? { ...r, [field]: val } : r
    );
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock size={14} className="text-primary" />
        <span className="font-medium text-foreground">Horario de disponibilidad</span>
      </div>

      <div className="space-y-1.5">
        {DAYS.map(day => {
          const rule = rules.find(r => r.day_of_week === day.value);
          if (!rule) return null;
          return (
            <div
              key={day.value}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
                rule.active
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border bg-secondary/30 opacity-60'
              }`}
            >
              <button
                type="button"
                onClick={() => toggleDay(day.value)}
                className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                  rule.active ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border'
                }`}
              >
                {rule.active && <Check size={12} />}
              </button>
              <span className="text-xs font-medium w-12 text-foreground">{day.short}</span>
              {rule.active ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="time"
                    value={rule.start_time}
                    onChange={e => updateRule(day.value, 'start_time', e.target.value)}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary w-[90px]"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <input
                    type="time"
                    value={rule.end_time}
                    onChange={e => updateRule(day.value, 'end_time', e.target.value)}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary w-[90px]"
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">No disponible</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground block mb-1">Buffer antes (min)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={rules[0]?.buffer_before ?? 10}
            onChange={e => {
              const val = parseInt(e.target.value) || 0;
              onChange(rules.map(r => ({ ...r, buffer_before: val })));
            }}
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground block mb-1">Buffer después (min)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={rules[0]?.buffer_after ?? 10}
            onChange={e => {
              const val = parseInt(e.target.value) || 0;
              onChange(rules.map(r => ({ ...r, buffer_after: val })));
            }}
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>
  );
};

export { DEFAULT_RULES };
export default AvailabilityWizard;

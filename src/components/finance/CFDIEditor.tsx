import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useUpsertCfdi, useIssueCfdi, type CfdiInput, type CfdiConcept, type CfdiDocument } from '@/hooks/useCFDI';
import { supabase } from '@/integrations/supabase/client';

const USO_CFDI = [
  ['G01', 'Adquisición de mercancías'],
  ['G03', 'Gastos en general'],
  ['P01', 'Por definir'],
  ['S01', 'Sin efectos fiscales'],
];
const FORMA_PAGO = [
  ['01', 'Efectivo'],
  ['03', 'Transferencia electrónica'],
  ['04', 'Tarjeta de crédito'],
  ['28', 'Tarjeta de débito'],
  ['99', 'Por definir'],
];

const emptyConcept = (): CfdiConcept => ({
  descripcion: '',
  cantidad: 1,
  valor_unitario: 0,
  importe: 0,
  iva_tasa: 0.16,
});

const inputCls =
  'w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground';

export default function CFDIEditor({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: CfdiDocument | null;
}) {
  const products = useProducts();
  const upsert = useUpsertCfdi();
  const issue = useIssueCfdi();
  const [fiscalReady, setFiscalReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('tenant_fiscal_profiles_public')
      .select('is_active')
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFiscalReady(!!data?.is_active);
      });
    return () => { cancelled = true; };
  }, []);

  const [form, setForm] = useState<CfdiInput>(() => ({
    id: existing?.id ?? null,
    series: existing?.series ?? 'A',
    folio: existing?.folio ?? '',
    tipo_comprobante: existing?.tipo_comprobante ?? 'I',
    uso_cfdi: existing?.uso_cfdi ?? 'G03',
    forma_pago: existing?.forma_pago ?? '99',
    metodo_pago: existing?.metodo_pago ?? 'PUE',
    moneda: existing?.moneda ?? 'MXN',
    receptor_rfc: existing?.receptor_rfc ?? '',
    receptor_nombre: existing?.receptor_nombre ?? '',
    receptor_uso_cfdi: existing?.receptor_uso_cfdi ?? 'G03',
    concepts: (existing?.cfdi_concepts ?? []).map((c) => ({
      id: c.id,
      product_id: c.product_id ?? null,
      clave_prod_serv: c.clave_prod_serv ?? null,
      clave_unidad: c.clave_unidad ?? null,
      descripcion: c.descripcion,
      cantidad: Number(c.cantidad),
      valor_unitario: Number(c.valor_unitario),
      importe: Number(c.importe),
      iva_tasa: Number(c.iva_tasa ?? 0.16),
    })).length
      ? (existing!.cfdi_concepts as CfdiConcept[])
      : [emptyConcept()],
  }));

  if (!open) return null;

  const setConcept = (idx: number, patch: Partial<CfdiConcept>) =>
    setForm((p) => ({
      ...p,
      concepts: p.concepts.map((c, i) => {
        if (i !== idx) return c;
        const next = { ...c, ...patch };
        next.importe = Math.round((Number(next.cantidad) || 0) * (Number(next.valor_unitario) || 0) * 100) / 100;
        return next;
      }),
    }));

  const pickProduct = (idx: number, productId: string) => {
    const p = (products.data ?? []).find((x) => x.id === productId);
    if (!p) {
      setConcept(idx, { product_id: null });
      return;
    }
    setConcept(idx, {
      product_id: p.id,
      descripcion: p.name,
      valor_unitario: Number(p.unit_price),
      clave_prod_serv: p.sat_clave_prod_serv,
      clave_unidad: p.sat_clave_unidad,
    });
  };

  const totals = form.concepts.reduce(
    (acc, c) => {
      const imp = (Number(c.cantidad) || 0) * (Number(c.valor_unitario) || 0);
      acc.subtotal += imp;
      acc.iva += imp * (Number(c.iva_tasa) || 0);
      return acc;
    },
    { subtotal: 0, iva: 0 },
  );
  const total = totals.subtotal + totals.iva;
  const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: form.moneda }).format(n);

  const canSave =
    form.receptor_rfc.trim().length >= 12 &&
    form.receptor_nombre.trim().length > 0 &&
    form.concepts.length > 0 &&
    form.concepts.every((c) => c.descripcion.trim() && Number(c.cantidad) > 0 && Number(c.valor_unitario) >= 0);

  const save = async (thenIssue?: boolean) => {
    const res = await upsert.mutateAsync(form);
    if (thenIssue && res?.id) {
      await issue.mutateAsync({ id: res.id });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-3xl bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-bold">{existing ? 'Editar CFDI' : 'Nuevo CFDI'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Serie">
              <input value={form.series ?? ''} onChange={(e) => setForm({ ...form, series: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Folio">
              <input value={form.folio ?? ''} onChange={(e) => setForm({ ...form, folio: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Tipo">
              <select value={form.tipo_comprobante} onChange={(e) => setForm({ ...form, tipo_comprobante: e.target.value })} className={inputCls}>
                <option value="I">Ingreso</option>
                <option value="E">Egreso</option>
                <option value="P">Pago</option>
              </select>
            </Field>
            <Field label="Moneda">
              <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })} className={inputCls}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="RFC receptor *">
              <input
                value={form.receptor_rfc}
                onChange={(e) => setForm({ ...form, receptor_rfc: e.target.value.toUpperCase() })}
                placeholder="XAXX010101000"
                className={inputCls}
              />
            </Field>
            <Field label="Nombre receptor *">
              <input value={form.receptor_nombre} onChange={(e) => setForm({ ...form, receptor_nombre: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Uso CFDI">
              <select value={form.uso_cfdi ?? ''} onChange={(e) => setForm({ ...form, uso_cfdi: e.target.value })} className={inputCls}>
                {USO_CFDI.map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </Field>
            <Field label="Forma de pago">
              <select value={form.forma_pago ?? ''} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className={inputCls}>
                {FORMA_PAGO.map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </Field>
            <Field label="Método de pago">
              <select value={form.metodo_pago ?? ''} onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })} className={inputCls}>
                <option value="PUE">PUE — Una exhibición</option>
                <option value="PPD">PPD — Parcialidades</option>
              </select>
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Conceptos</label>
              <button
                onClick={() => setForm({ ...form, concepts: [...form.concepts, emptyConcept()] })}
                className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {form.concepts.map((c, idx) => (
                <div key={idx} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={c.product_id ?? ''}
                      onChange={(e) => pickProduct(idx, e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— Descripción libre —</option>
                      {(products.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
                      ))}
                    </select>
                    <input
                      value={c.descripcion}
                      onChange={(e) => setConcept(idx, { descripcion: e.target.value })}
                      placeholder="Descripción"
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <Field label="Cantidad">
                      <input type="number" step="0.01" min={0} value={c.cantidad}
                        onChange={(e) => setConcept(idx, { cantidad: Number(e.target.value) })} className={inputCls} />
                    </Field>
                    <Field label="P. unitario">
                      <input type="number" step="0.01" min={0} value={c.valor_unitario}
                        onChange={(e) => setConcept(idx, { valor_unitario: Number(e.target.value) })} className={inputCls} />
                    </Field>
                    <Field label="Clave ProdServ">
                      <input value={c.clave_prod_serv ?? ''} maxLength={8}
                        onChange={(e) => setConcept(idx, { clave_prod_serv: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="Clave Unidad">
                      <input value={c.clave_unidad ?? ''} maxLength={3}
                        onChange={(e) => setConcept(idx, { clave_unidad: e.target.value.toUpperCase() })} className={inputCls} />
                    </Field>
                    <Field label="IVA">
                      <select value={c.iva_tasa} onChange={(e) => setConcept(idx, { iva_tasa: Number(e.target.value) })} className={inputCls}>
                        <option value={0.16}>16%</option>
                        <option value={0.08}>8%</option>
                        <option value={0}>0%</option>
                      </select>
                    </Field>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">Importe: {fmt(c.importe || (Number(c.cantidad) * Number(c.valor_unitario)))}</span>
                    <button
                      onClick={() => setForm({ ...form, concepts: form.concepts.filter((_, i) => i !== idx) })}
                      disabled={form.concepts.length === 1}
                      className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-muted/40 rounded-xl p-3 space-y-1 text-sm">
            <Row label="Subtotal" value={fmt(totals.subtotal)} />
            <Row label="IVA" value={fmt(totals.iva)} />
            <Row label="Total" value={fmt(total)} bold />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl hover:bg-muted">Cancelar</button>
          <button
            onClick={() => save(false)}
            disabled={!canSave || upsert.isPending}
            className="px-4 py-2 text-sm rounded-xl bg-secondary text-foreground disabled:opacity-50 flex items-center gap-2"
          >
            {upsert.isPending && <Loader2 size={14} className="animate-spin" />}
            Guardar borrador
          </button>
          <button
            onClick={() => save(true)}
            disabled={!canSave || upsert.isPending || issue.isPending || fiscalReady === false}
            title={fiscalReady === false ? 'Completa tus datos fiscales primero' : undefined}
            className="px-4 py-2 text-sm rounded-xl bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-2"
          >
            {(upsert.isPending || issue.isPending) && <Loader2 size={14} className="animate-spin" />}
            {fiscalReady === false ? 'Completa tus datos fiscales primero' : 'Guardar y timbrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-bold' : 'text-muted-foreground'}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}

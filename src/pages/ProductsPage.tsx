import { useState, useMemo } from 'react';
import { Plus, Search, Package, Edit2, Trash2, X, Loader2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import {
  useProducts,
  useUpsertProduct,
  useDeleteProduct,
  type Product,
  type ProductInput,
} from '@/hooks/useProducts';
import { useFinancialCategories } from '@/hooks/useFinance';

function ProductModal({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
}) {
  const cats = useFinancialCategories();
  const upsert = useUpsertProduct();
  const [form, setForm] = useState<ProductInput>({
    id: product?.id ?? null,
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    unit_price: Number(product?.unit_price ?? 0),
    currency: product?.currency ?? 'MXN',
    unit_of_measure: product?.unit_of_measure ?? '',
    sat_clave_prod_serv: product?.sat_clave_prod_serv ?? '',
    sat_clave_unidad: product?.sat_clave_unidad ?? '',
    stock_quantity: Number(product?.stock_quantity ?? 0),
    category_id: product?.category_id ?? null,
    is_active: product?.is_active ?? true,
  });

  if (!open) return null;

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.name.trim().length > 0 && Number(form.unit_price) >= 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-bold">{product ? 'Editar producto' : 'Nuevo producto'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU">
              <input value={form.sku ?? ''} onChange={(e) => set('sku', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Unidad de medida">
              <input value={form.unit_of_measure ?? ''} onChange={(e) => set('unit_of_measure', e.target.value)} placeholder="Pieza, Servicio…" className={inputCls} />
            </Field>
          </div>
          <Field label="Nombre *">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Descripción">
            <textarea value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Precio unitario">
              <input type="number" step="0.01" min={0} value={form.unit_price} onChange={(e) => set('unit_price', Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Moneda">
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>
            <Field label="Stock">
              <input type="number" step="0.01" value={form.stock_quantity ?? 0} onChange={(e) => set('stock_quantity', Number(e.target.value))} className={inputCls} />
            </Field>
          </div>
          <Field label="Categoría contable (opcional)">
            <select
              value={form.category_id ?? ''}
              onChange={(e) => set('category_id', e.target.value || null)}
              className={inputCls}
            >
              <option value="">— Sin categoría —</option>
              {(cats.data ?? []).map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Clave ProdServ SAT (8 dígitos)">
              <input
                value={form.sat_clave_prod_serv ?? ''}
                onChange={(e) => set('sat_clave_prod_serv', e.target.value)}
                placeholder="Ej. 01010101"
                maxLength={8}
                className={inputCls}
              />
            </Field>
            <Field label="Clave Unidad SAT (2-3 car.)">
              <input
                value={form.sat_clave_unidad ?? ''}
                onChange={(e) => set('sat_clave_unidad', e.target.value.toUpperCase())}
                placeholder="H87, E48…"
                maxLength={3}
                className={inputCls}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active ?? true}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            Activo
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl hover:bg-muted">Cancelar</button>
          <button
            onClick={async () => {
              await upsert.mutateAsync(form);
              onClose();
            }}
            disabled={!canSave || upsert.isPending}
            className="px-4 py-2 text-sm rounded-xl bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-2"
          >
            {upsert.isPending && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const products = useProducts({ includeInactive });
  const del = useDeleteProduct();

  const rows = useMemo(() => {
    const list = (products.data ?? []) as Product[];
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.sku ?? '').toLowerCase().includes(s) ||
        (p.description ?? '').toLowerCase().includes(s),
    );
  }, [products.data, q]);

  const fmt = (n: number, cur: string) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur }).format(n);

  return (
    <AppLayout>
      <div className="p-4 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package size={22} /> Productos e inventario
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Catálogo de productos y servicios con claves SAT.</p>
          </div>
          <button
            onClick={() => setEditing(null)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-2 hover:bg-primary/90"
          >
            <Plus size={16} /> Nuevo producto
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, SKU o descripción"
              className="w-full pl-9 pr-3 py-2 text-sm bg-secondary rounded-xl outline-none border border-border focus:border-primary text-foreground"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Incluir inactivos
          </label>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {products.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sin productos.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Nombre</th>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium">SAT</th>
                  <th className="text-right px-3 py-2 font-medium">Precio</th>
                  <th className="text-right px-3 py-2 font-medium">Stock</th>
                  <th className="text-right px-3 py-2 font-medium w-24">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>
                      )}
                      {!p.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Inactivo</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.sku ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.sat_clave_prod_serv && <div>ProdServ: {p.sat_clave_prod_serv}</div>}
                      {p.sat_clave_unidad && <div>Unidad: {p.sat_clave_unidad}</div>}
                      {!p.sat_clave_prod_serv && !p.sat_clave_unidad && <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(p.unit_price), p.currency)}</td>
                    <td className="px-3 py-2 text-right">{Number(p.stock_quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          className="p-1.5 rounded hover:bg-muted"
                          aria-label="Editar"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Desactivar "${p.name}"?`)) del.mutate(p.id);
                          }}
                          className="p-1.5 rounded text-destructive hover:bg-destructive/10"
                          aria-label="Desactivar"
                          disabled={!p.is_active}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ProductModal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        product={editing ?? null}
      />
    </AppLayout>
  );
}

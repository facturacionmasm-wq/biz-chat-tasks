import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase as supabaseTyped } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// Types haven't regenerated for new tables yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = supabaseTyped as any;


export type Product = {
  id: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit_price: number;
  currency: string;
  unit_of_measure: string | null;
  sat_clave_prod_serv: string | null;
  sat_clave_unidad: string | null;
  stock_quantity: number;
  category_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductInput = {
  id?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  unit_price: number;
  currency?: string;
  unit_of_measure?: string | null;
  sat_clave_prod_serv?: string | null;
  sat_clave_unidad?: string | null;
  stock_quantity?: number;
  category_id?: string | null;
  is_active?: boolean;
};

export function useProducts(opts?: { includeInactive?: boolean }) {
  const { tenantId } = useAuth();
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: ['products', tenantId, includeInactive],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase.from('products').select('*').eq('tenant_id', tenantId!);
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q.order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });
}

export function useUpsertProduct() {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductInput) => {
      if (!tenantId) throw new Error('Sin tenant');
      if (input.sat_clave_prod_serv && !/^[0-9]{8}$/.test(input.sat_clave_prod_serv)) {
        throw new Error('Clave ProdServ SAT: 8 dígitos');
      }
      if (input.sat_clave_unidad && !/^[A-Z0-9]{2,3}$/.test(input.sat_clave_unidad)) {
        throw new Error('Clave Unidad SAT: 2-3 caracteres (A-Z, 0-9)');
      }
      const row = {
        tenant_id: tenantId,
        sku: input.sku ?? null,
        name: input.name.trim(),
        description: input.description ?? null,
        unit_price: Number(input.unit_price) || 0,
        currency: input.currency ?? 'MXN',
        unit_of_measure: input.unit_of_measure ?? null,
        sat_clave_prod_serv: input.sat_clave_prod_serv ?? null,
        sat_clave_unidad: input.sat_clave_unidad ?? null,
        stock_quantity: Number(input.stock_quantity ?? 0),
        category_id: input.category_id ?? null,
        is_active: input.is_active ?? true,
        created_by: user?.id ?? null,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('products')
          .update(row)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert(row)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Producto guardado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Producto desactivado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

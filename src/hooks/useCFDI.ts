import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase as supabaseTyped } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = supabaseTyped as any;

export type CfdiConcept = {
  id?: string;
  product_id?: string | null;
  clave_prod_serv?: string | null;
  clave_unidad?: string | null;
  descripcion: string;
  cantidad: number;
  valor_unitario: number;
  importe: number;
  iva_tasa: number;
};

export type CfdiDocument = {
  id: string;
  tenant_id: string;
  series: string | null;
  folio: string | null;
  tipo_comprobante: string;
  uso_cfdi: string | null;
  forma_pago: string | null;
  metodo_pago: string | null;
  moneda: string;
  receptor_rfc: string;
  receptor_nombre: string;
  receptor_uso_cfdi: string | null;
  subtotal: number;
  iva: number;
  total: number;
  estado: 'borrador' | 'timbrado' | 'cancelado' | 'error';
  uuid_fiscal: string | null;
  xml_url: string | null;
  pdf_url: string | null;
  provider: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  cfdi_concepts?: CfdiConcept[];
};

export type CfdiInput = {
  id?: string | null;
  series?: string | null;
  folio?: string | null;
  tipo_comprobante?: string;
  uso_cfdi?: string | null;
  forma_pago?: string | null;
  metodo_pago?: string | null;
  moneda?: string;
  receptor_rfc: string;
  receptor_nombre: string;
  receptor_uso_cfdi?: string | null;
  concepts: CfdiConcept[];
};

export function useCfdiList() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['cfdi-list', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cfdi_documents')
        .select('*, cfdi_concepts(*)')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CfdiDocument[];
    },
  });
}

function totalsFrom(concepts: CfdiConcept[]) {
  const subtotal = concepts.reduce((s, c) => s + (Number(c.cantidad) || 0) * (Number(c.valor_unitario) || 0), 0);
  const iva = concepts.reduce(
    (s, c) => s + (Number(c.cantidad) || 0) * (Number(c.valor_unitario) || 0) * (Number(c.iva_tasa) || 0),
    0,
  );
  return { subtotal: Math.round(subtotal * 100) / 100, iva: Math.round(iva * 100) / 100, total: Math.round((subtotal + iva) * 100) / 100 };
}

export function useUpsertCfdi() {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CfdiInput) => {
      if (!tenantId) throw new Error('Sin tenant');
      if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(input.receptor_rfc)) {
        throw new Error('RFC receptor con formato inválido');
      }
      const { subtotal, iva, total } = totalsFrom(input.concepts);
      const header = {
        tenant_id: tenantId,
        series: input.series ?? null,
        folio: input.folio ?? null,
        tipo_comprobante: input.tipo_comprobante ?? 'I',
        uso_cfdi: input.uso_cfdi ?? null,
        forma_pago: input.forma_pago ?? null,
        metodo_pago: input.metodo_pago ?? 'PUE',
        moneda: input.moneda ?? 'MXN',
        receptor_rfc: input.receptor_rfc.trim().toUpperCase(),
        receptor_nombre: input.receptor_nombre.trim(),
        receptor_uso_cfdi: input.receptor_uso_cfdi ?? input.uso_cfdi ?? null,
        subtotal,
        iva,
        total,
        created_by: user?.id ?? null,
      };

      let docId = input.id ?? null;
      if (!docId) {
        const { data, error } = await supabase.from('cfdi_documents').insert(header).select().single();
        if (error) throw error;
        docId = data.id as string;
      } else {
        const { error } = await supabase.from('cfdi_documents').update(header).eq('id', docId);
        if (error) throw error;
        await supabase.from('cfdi_concepts').delete().eq('cfdi_document_id', docId);
      }

      const rows = input.concepts.map((c) => ({
        cfdi_document_id: docId,
        product_id: c.product_id ?? null,
        clave_prod_serv: c.clave_prod_serv ?? null,
        clave_unidad: c.clave_unidad ?? null,
        descripcion: c.descripcion,
        cantidad: Number(c.cantidad) || 0,
        valor_unitario: Number(c.valor_unitario) || 0,
        importe: Math.round((Number(c.cantidad) || 0) * (Number(c.valor_unitario) || 0) * 100) / 100,
        iva_tasa: Number(c.iva_tasa ?? 0.16),
      }));
      if (rows.length) {
        const { error } = await supabase.from('cfdi_concepts').insert(rows);
        if (error) throw error;
      }
      return { id: docId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfdi-list'] });
      toast.success('CFDI guardado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useIssueCfdi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; provider?: string }) => {
      const { data, error } = await supabase.functions.invoke('cfdi-issue', {
        body: { cfdi_document_id: input.id, provider: input.provider ?? 'facturama' },
      });
      if (error) throw new Error(error.message);
      if (data?.configured === false) {
        throw new Error(`Requiere credenciales: ${(data.missing_secrets ?? []).join(', ')}`);
      }
      if (!data?.ok) throw new Error(data?.error ?? 'Timbrado falló');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfdi-list'] });
      toast.success('CFDI timbrado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelCfdi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; motivo: string; folio_sustitucion?: string }) => {
      const { data, error } = await supabase.functions.invoke('cfdi-cancel', {
        body: { cfdi_document_id: input.id, motivo: input.motivo, folio_sustitucion: input.folio_sustitucion ?? null },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'Cancelación falló');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfdi-list'] });
      toast.success('CFDI cancelado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

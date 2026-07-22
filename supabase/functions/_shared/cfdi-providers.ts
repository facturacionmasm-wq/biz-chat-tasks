// Shared CFDI provider adapter — Facturama (real/sandbox) + SW/Finkok stubs.
// If provider secrets are missing → returns { configured: false, missing_secrets: [...] }
// mirroring the pattern used by the finance-providers Belvo/Finerio stubs.

export type CfdiIssueInput = {
  tenantId: string;
  document: {
    id: string;
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
  };
  concepts: Array<{
    clave_prod_serv: string | null;
    clave_unidad: string | null;
    descripcion: string;
    cantidad: number;
    valor_unitario: number;
    importe: number;
    iva_tasa: number;
  }>;
};

export type CfdiIssueResult =
  | { ok: true; uuid: string; xml_url: string | null; pdf_url: string | null; raw?: unknown }
  | { ok: false; error: string; raw?: unknown };

export type CfdiCancelResult =
  | { ok: true; acuse_xml_url?: string | null; raw?: unknown }
  | { ok: false; error: string; raw?: unknown };

export interface CfdiAdapter {
  id: 'facturama' | 'sw_sapien' | 'finkok';
  label: string;
  requiredSecrets: string[];
  isConfigured(): { configured: boolean; missing: string[] };
  issue(input: CfdiIssueInput): Promise<CfdiIssueResult>;
  cancel(input: { uuid: string; motivo: string; folio_sustitucion?: string | null }): Promise<CfdiCancelResult>;
}

function checkSecrets(names: string[]) {
  const missing = names.filter((n) => !Deno.env.get(n));
  return { configured: missing.length === 0, missing };
}

// -------------------- Facturama (real / sandbox) --------------------
export const FacturamaAdapter: CfdiAdapter = {
  id: 'facturama',
  label: 'Facturama',
  requiredSecrets: ['FACTURAMA_USER', 'FACTURAMA_PASSWORD', 'FACTURAMA_ENV'],

  isConfigured() {
    return checkSecrets(this.requiredSecrets);
  },

  async issue(input) {
    const check = this.isConfigured();
    if (!check.configured) return { ok: false, error: `missing_secrets:${check.missing.join(',')}` };

    const env = (Deno.env.get('FACTURAMA_ENV') ?? 'sandbox').toLowerCase();
    const base =
      env === 'production' ? 'https://api.facturama.mx' : 'https://apisandbox.facturama.com.mx';
    const auth = 'Basic ' + btoa(`${Deno.env.get('FACTURAMA_USER')}:${Deno.env.get('FACTURAMA_PASSWORD')}`);

    const payload = {
      NameId: 1,
      Folio: input.document.folio ?? undefined,
      Serie: input.document.series ?? undefined,
      CfdiType: input.document.tipo_comprobante ?? 'I',
      PaymentForm: input.document.forma_pago ?? '99',
      PaymentMethod: input.document.metodo_pago ?? 'PUE',
      Currency: input.document.moneda ?? 'MXN',
      ExpeditionPlace: Deno.env.get('FACTURAMA_EXPEDITION_ZIP') ?? '00000',
      Receiver: {
        Rfc: input.document.receptor_rfc,
        Name: input.document.receptor_nombre,
        CfdiUse: input.document.receptor_uso_cfdi ?? input.document.uso_cfdi ?? 'G03',
      },
      Items: input.concepts.map((c) => ({
        ProductCode: c.clave_prod_serv ?? '01010101',
        UnitCode: c.clave_unidad ?? 'H87',
        Description: c.descripcion,
        Quantity: c.cantidad,
        UnitPrice: c.valor_unitario,
        Subtotal: c.importe,
        Total: c.importe + c.importe * (c.iva_tasa ?? 0.16),
        Taxes: [
          {
            Total: Math.round(c.importe * (c.iva_tasa ?? 0.16) * 100) / 100,
            Name: 'IVA',
            Base: c.importe,
            Rate: c.iva_tasa ?? 0.16,
            IsRetention: false,
          },
        ],
      })),
    };

    try {
      const resp = await fetch(`${base}/3/cfdis`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: `facturama_${resp.status}:${JSON.stringify(raw).slice(0, 300)}`, raw };
      }
      const uuid = raw?.Complement?.TaxStamp?.Uuid ?? raw?.Id ?? null;
      const docId = raw?.Id ?? null;
      const xml_url = docId ? `${base}/cfdi/xml/issued/${docId}` : null;
      const pdf_url = docId ? `${base}/cfdi/pdf/issued/${docId}` : null;
      return uuid
        ? { ok: true, uuid, xml_url, pdf_url, raw }
        : { ok: false, error: 'no_uuid_returned', raw };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async cancel({ uuid, motivo, folio_sustitucion }) {
    const check = this.isConfigured();
    if (!check.configured) return { ok: false, error: `missing_secrets:${check.missing.join(',')}` };

    const env = (Deno.env.get('FACTURAMA_ENV') ?? 'sandbox').toLowerCase();
    const base = env === 'production' ? 'https://api.facturama.mx' : 'https://apisandbox.facturama.com.mx';
    const auth = 'Basic ' + btoa(`${Deno.env.get('FACTURAMA_USER')}:${Deno.env.get('FACTURAMA_PASSWORD')}`);

    try {
      const q = new URLSearchParams({ motive: motivo });
      if (folio_sustitucion) q.set('uuidReplacement', folio_sustitucion);
      const resp = await fetch(`${base}/cfdi/${uuid}?${q.toString()}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const raw = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, error: `facturama_cancel_${resp.status}`, raw };
      return { ok: true, raw };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

// -------------------- SW Sapien (stub) --------------------
export const SwSapienAdapter: CfdiAdapter = {
  id: 'sw_sapien',
  label: 'SW Sapien',
  requiredSecrets: ['SW_SAPIEN_TOKEN', 'SW_SAPIEN_ENV'],
  isConfigured() { return checkSecrets(this.requiredSecrets); },
  async issue() { return { ok: false, error: 'provider_not_configured' }; },
  async cancel() { return { ok: false, error: 'provider_not_configured' }; },
};

// -------------------- Finkok (stub) --------------------
export const FinkokAdapter: CfdiAdapter = {
  id: 'finkok',
  label: 'Finkok',
  requiredSecrets: ['FINKOK_USER', 'FINKOK_PASSWORD', 'FINKOK_ENV'],
  isConfigured() { return checkSecrets(this.requiredSecrets); },
  async issue() { return { ok: false, error: 'provider_not_configured' }; },
  async cancel() { return { ok: false, error: 'provider_not_configured' }; },
};

const registry: Record<string, CfdiAdapter> = {
  facturama: FacturamaAdapter,
  sw_sapien: SwSapienAdapter,
  finkok: FinkokAdapter,
};

export function getCfdiAdapter(id: string): CfdiAdapter {
  return registry[id] ?? FacturamaAdapter;
}

export function listCfdiAdapters(): CfdiAdapter[] {
  return Object.values(registry);
}

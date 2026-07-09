import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BrandingData {
  orgName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  slogan: string;
  loading: boolean;
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_BRANDING: BrandingData = {
  orgName: 'OfficeHub',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  slogan: '',
  loading: true,
};

export const useBranding = (): BrandingData => {
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-branding', TENANT_ID],
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    queryFn: async () => {
      const { data: tenant } = await supabase
        .rpc('get_tenant_branding', { _tenant_id: TENANT_ID }) as { data: { id: string; name: string; settings_json: any } | null };
      if (!tenant) return null;
      const s = (tenant.settings_json || {}) as Record<string, any>;
      return {
        orgName: tenant.name || 'OfficeHub',
        logoUrl: s.logo_url || '',
        faviconUrl: s.favicon_url || '',
        favicon32Url: s.favicon_32_url || '',
        primaryColor: s.primary_color || '#6366f1',
        secondaryColor: s.secondary_color || '#8b5cf6',
        slogan: s.slogan || '',
      };
    },
  });

  // Apply favicon + title as side effect (same behavior as before)
  useEffect(() => {
    if (!data) return;
    const faviconSrc = data.favicon32Url || data.faviconUrl;
    if (faviconSrc) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement
        || document.createElement('link');
      link.rel = 'icon';
      link.href = faviconSrc;
      document.head.appendChild(link);

      if (data.faviconUrl) {
        const appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement
          || document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        appleLink.href = data.faviconUrl;
        document.head.appendChild(appleLink);
      }
    }
    if (data.orgName) document.title = data.orgName;
  }, [data]);

  if (!data) {
    return { ...DEFAULT_BRANDING, loading: isLoading };
  }
  return {
    orgName: data.orgName,
    logoUrl: data.logoUrl,
    faviconUrl: data.faviconUrl,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    slogan: data.slogan,
    loading: false,
  };
};

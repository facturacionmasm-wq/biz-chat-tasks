import { useState, useEffect } from 'react';
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

export const useBranding = () => {
  const [branding, setBranding] = useState<BrandingData>({
    orgName: 'OfficeHub',
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    slogan: '',
    loading: true,
  });

  useEffect(() => {
    const load = async () => {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, settings_json')
        .eq('id', TENANT_ID)
        .maybeSingle();

      if (tenant) {
        const s = (tenant.settings_json || {}) as Record<string, any>;
        const newBranding: BrandingData = {
          orgName: tenant.name || 'OfficeHub',
          logoUrl: s.logo_url || '',
          faviconUrl: s.favicon_url || '',
          primaryColor: s.primary_color || '#6366f1',
          secondaryColor: s.secondary_color || '#8b5cf6',
          slogan: s.slogan || '',
          loading: false,
        };
        setBranding(newBranding);

        // Update favicon dynamically (use 32px version for browser tab)
        const faviconSrc = s.favicon_32_url || s.favicon_url;
        if (faviconSrc) {
          const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement
            || document.createElement('link');
          link.rel = 'icon';
          link.href = faviconSrc;
          document.head.appendChild(link);

          // Update apple-touch-icon with 192px version
          if (s.favicon_url) {
            const appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement
              || document.createElement('link');
            appleLink.rel = 'apple-touch-icon';
            appleLink.href = s.favicon_url;
            document.head.appendChild(appleLink);
          }
        }

        // Update page title
        if (tenant.name) {
          document.title = tenant.name;
        }
      } else {
        setBranding(prev => ({ ...prev, loading: false }));
      }
    };
    load();
  }, []);

  return branding;
};

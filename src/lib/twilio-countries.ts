// Curated list of Twilio-supported countries for phone number purchase.
// Kept intentionally short; extend as needed. Countries flagged with
// `requiresBundle: true` require a Twilio Regulatory Bundle before purchase
// and are shown but disabled in the wizard.
export type TwilioNumberType = 'Local' | 'Mobile' | 'TollFree';

export interface TwilioCountry {
  code: string;
  name: string;
  flag: string;
  types: TwilioNumberType[];
  requiresBundle?: boolean;
  note?: string;
}

export const TWILIO_COUNTRIES: TwilioCountry[] = [
  { code: 'US', name: 'Estados Unidos',   flag: '🇺🇸', types: ['Local', 'TollFree'] },
  { code: 'CA', name: 'Canadá',           flag: '🇨🇦', types: ['Local', 'TollFree'] },
  { code: 'MX', name: 'México',           flag: '🇲🇽', types: ['Local', 'Mobile'], requiresBundle: true, note: 'Requiere Regulatory Bundle en Twilio.' },
  { code: 'GB', name: 'Reino Unido',      flag: '🇬🇧', types: ['Local', 'Mobile', 'TollFree'] },
  { code: 'ES', name: 'España',           flag: '🇪🇸', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'DE', name: 'Alemania',         flag: '🇩🇪', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'FR', name: 'Francia',          flag: '🇫🇷', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'IT', name: 'Italia',           flag: '🇮🇹', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'NL', name: 'Países Bajos',     flag: '🇳🇱', types: ['Local', 'Mobile'] },
  { code: 'BE', name: 'Bélgica',          flag: '🇧🇪', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'PT', name: 'Portugal',         flag: '🇵🇹', types: ['Local', 'Mobile'] },
  { code: 'IE', name: 'Irlanda',          flag: '🇮🇪', types: ['Local', 'Mobile'] },
  { code: 'AT', name: 'Austria',          flag: '🇦🇹', types: ['Local', 'Mobile'] },
  { code: 'CH', name: 'Suiza',            flag: '🇨🇭', types: ['Local', 'Mobile'] },
  { code: 'SE', name: 'Suecia',           flag: '🇸🇪', types: ['Local', 'Mobile'] },
  { code: 'NO', name: 'Noruega',          flag: '🇳🇴', types: ['Local', 'Mobile'] },
  { code: 'DK', name: 'Dinamarca',        flag: '🇩🇰', types: ['Local', 'Mobile'] },
  { code: 'FI', name: 'Finlandia',        flag: '🇫🇮', types: ['Local', 'Mobile'] },
  { code: 'PL', name: 'Polonia',          flag: '🇵🇱', types: ['Local', 'Mobile'] },
  { code: 'CZ', name: 'Chequia',          flag: '🇨🇿', types: ['Local', 'Mobile'] },
  { code: 'BR', name: 'Brasil',           flag: '🇧🇷', types: ['Local', 'Mobile'], requiresBundle: true },
  { code: 'AR', name: 'Argentina',        flag: '🇦🇷', types: ['Local', 'Mobile'] },
  { code: 'CL', name: 'Chile',            flag: '🇨🇱', types: ['Local', 'Mobile'] },
  { code: 'CO', name: 'Colombia',         flag: '🇨🇴', types: ['Local', 'Mobile'] },
  { code: 'PE', name: 'Perú',             flag: '🇵🇪', types: ['Local', 'Mobile'] },
  { code: 'AU', name: 'Australia',        flag: '🇦🇺', types: ['Local', 'Mobile', 'TollFree'] },
  { code: 'NZ', name: 'Nueva Zelanda',    flag: '🇳🇿', types: ['Local', 'Mobile'] },
  { code: 'JP', name: 'Japón',            flag: '🇯🇵', types: ['Local'], requiresBundle: true },
  { code: 'SG', name: 'Singapur',         flag: '🇸🇬', types: ['Local', 'Mobile'] },
  { code: 'HK', name: 'Hong Kong',        flag: '🇭🇰', types: ['Local', 'Mobile'] },
  { code: 'IN', name: 'India',            flag: '🇮🇳', types: ['Local'], requiresBundle: true },
  { code: 'ZA', name: 'Sudáfrica',        flag: '🇿🇦', types: ['Local', 'Mobile'] },
];

export const getTwilioCountry = (code: string): TwilioCountry | undefined =>
  TWILIO_COUNTRIES.find((c) => c.code === code.toUpperCase());

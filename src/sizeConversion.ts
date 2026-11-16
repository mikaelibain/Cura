export type SizeRegion = 'US' | 'UK' | 'EU' | 'JP';

export type SizeConversion = {
  us: string;
  uk: string;
  eu: string;
  jp: string;
};

// Standard international clothing size chart mappings
const alphaToNumeric: Record<string, SizeConversion> = {
  XXS: { us: '00 / XXS', uk: '4', eu: '32', jp: '3' },
  XS: { us: '0-2 / XS', uk: '6', eu: '34', jp: '5' },
  S: { us: '4-6 / S', uk: '8-10', eu: '36-38', jp: '7-9' },
  M: { us: '8-10 / M', uk: '12-14', eu: '40-42', jp: '11-13' },
  L: { us: '12-14 / L', uk: '16-18', eu: '44-46', jp: '15-17' },
  XL: { us: '16 / XL', uk: '20', eu: '48', jp: '19' },
  XXL: { us: '18-20 / XXL', uk: '22-24', eu: '50-52', jp: '21' },
};

export const convertSize = (sizeInput: string, preferredRegion: SizeRegion = 'US'): string => {
  if (!sizeInput) return '';
  const clean = sizeInput.trim().toUpperCase();

  // Match alpha sizes
  for (const [key, mapping] of Object.entries(alphaToNumeric)) {
    if (clean === key || clean.includes(key)) {
      return `${sizeInput} (${preferredRegion}: ${mapping[preferredRegion.toLowerCase() as keyof SizeConversion]})`;
    }
  }

  // Match numeric sizes if applicable
  const num = Number.parseInt(clean, 10);
  if (Number.isFinite(num)) {
    // Basic US women's size to UK/EU heuristic
    if (num >= 0 && num <= 16) {
      const ukSize = num + 4;
      const euSize = num + 32;
      return `${sizeInput} US (UK ${ukSize} / EU ${euSize})`;
    }
  }

  return sizeInput;
};

export const formatCurrency = (amount: number | null, currency = 'USD', preferredCurrency = 'USD'): string => {
  if (amount === null || !Number.isFinite(amount)) return 'Price unknown';

  const normalizeCode = (value: string, fallback: string) => {
    const text = value.toUpperCase().trim();
    if (/\bCAD\b|CA\$|C\$/.test(text)) return 'CAD';
    if (/\bUSD\b|US\$/.test(text)) return 'USD';
    if (/\bGBP\b|£/.test(text)) return 'GBP';
    if (/\bEUR\b|€/.test(text)) return 'EUR';
    if (/\bAUD\b|AU\$/.test(text)) return 'AUD';
    return /^[A-Z]{3}$/.test(text) ? text : fallback;
  };
  const preferredCode = normalizeCode(preferredCurrency, 'USD');
  const code = normalizeCode(currency, preferredCode);
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: code === 'JPY' || Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: code === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    formatted = `${code} ${amount.toFixed(code === 'JPY' ? 0 : 2).replace(/\.00$/, '')}`;
  }

  if (code !== preferredCode) {
    // Show original listing price with currency code specified
    return `${formatted} ${code}`;
  }

  return formatted;
};

export const convertCurrencyAmount = (amount: number, fromCurrency: string, toCurrency: string, liveRates?: Record<string, number>): number => {
  const from = fromCurrency.toUpperCase().trim();
  const to = toCurrency.toUpperCase().trim();
  if (from === to) return amount;
  const liveFrom = liveRates?.[from];
  const liveTo = liveRates?.[to];
  if (liveFrom && liveTo) return (amount / liveFrom) * liveTo;
  return Number.NaN;
};

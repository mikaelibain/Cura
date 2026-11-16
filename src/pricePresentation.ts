export const hasValidProductPrice = (amount: number | null | undefined, currency: string | null | undefined): amount is number =>
  typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && /^[A-Z]{3}$/.test(String(currency ?? '').toUpperCase());

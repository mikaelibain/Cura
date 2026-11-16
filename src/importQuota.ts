export type AccountTier = 'guest' | 'free';
export type ImportQuotaState = {
  tier: AccountTier;
  guestUsed: number;
  monthlyUsed: number;
  rewardGrants: number;
  monthKey: string;
  importedProductKeys: string[];
  pendingUrl?: string;
  editableCopiesUsed: number;
  editableCopyLimit?: number;
};

export type ImportQuotaStatus = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  reason?: 'signup-required' | 'monthly-limit';
  warning?: string;
};

export const monthKey = (date = new Date()): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export const canonicalImportKey = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(utm_|gclid$|gbraid$|wbraid$|fbclid$|msclkid$|srsltid$|source$|cmp$)/i.test(key)) url.searchParams.delete(key);
  });
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
};

export const freshQuotaState = (tier: AccountTier = 'guest', date = new Date()): ImportQuotaState => ({
  tier, guestUsed: 0, monthlyUsed: 0, rewardGrants: 0, monthKey: monthKey(date), importedProductKeys: [], editableCopiesUsed: 0,
});

export const normalizeQuotaState = (state: ImportQuotaState, date = new Date()): ImportQuotaState => state.monthKey === monthKey(date) ? state : {
  ...state, monthlyUsed: 0, rewardGrants: 0, monthKey: monthKey(date),
};

export const quotaStatus = (input: ImportQuotaState, url: string, date = new Date()): ImportQuotaStatus => {
  const state = normalizeQuotaState(input, date);
  const key = canonicalImportKey(url);
  if (state.importedProductKeys.includes(key)) return { allowed: true, used: state.tier === 'guest' ? state.guestUsed : state.monthlyUsed, limit: state.tier === 'guest' ? 10 : 30 + state.rewardGrants * 5, remaining: Number.POSITIVE_INFINITY };
  if (state.tier === 'guest') {
    const remaining = Math.max(0, 10 - state.guestUsed);
    return { allowed: remaining > 0, used: state.guestUsed, limit: 10, remaining, reason: remaining ? undefined : 'signup-required', warning: state.guestUsed >= 8 ? `${remaining} automatic ${remaining === 1 ? 'import' : 'imports'} remaining` : undefined };
  }
  const limit = Math.min(50, 30 + state.rewardGrants * 5);
  const remaining = Math.max(0, limit - state.monthlyUsed);
  return { allowed: remaining > 0, used: state.monthlyUsed, limit, remaining, reason: remaining ? undefined : 'monthly-limit', warning: state.monthlyUsed >= 25 ? `${remaining} automatic ${remaining === 1 ? 'import' : 'imports'} remaining this month` : undefined };
};

export const recordSuccessfulImport = (input: ImportQuotaState, url: string, date = new Date()): ImportQuotaState => {
  const state = normalizeQuotaState(input, date);
  const key = canonicalImportKey(url);
  if (state.importedProductKeys.includes(key)) return state;
  return {
    ...state,
    guestUsed: state.tier === 'guest' ? state.guestUsed + 1 : state.guestUsed,
    monthlyUsed: state.tier === 'free' ? state.monthlyUsed + 1 : state.monthlyUsed,
    importedProductKeys: [...state.importedProductKeys, key],
    pendingUrl: undefined,
  };
};

export const registerFreeAccount = (state: ImportQuotaState): ImportQuotaState => ({ ...normalizeQuotaState(state), tier: 'free' });

export const grantRewardedImports = (input: ImportQuotaState): ImportQuotaState => {
  const state = normalizeQuotaState(input);
  if (state.tier !== 'free' || state.rewardGrants >= 4) return state;
  return { ...state, rewardGrants: state.rewardGrants + 1 };
};

export const canMakeEditableCopy = (state: ImportQuotaState): boolean => state.editableCopyLimit === undefined || state.editableCopiesUsed < state.editableCopyLimit;

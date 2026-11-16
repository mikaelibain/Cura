import { buildSearchQueries, isProductMediaUrl, normalizeSearchCandidate } from './matcher.mjs';
import { cleanProductTitle, recordResolverEvent, verifyCandidate } from '../../productResolver.mjs';

const providerFailure = (error) => {
  const code = error?.status ?? Number(String(error?.message ?? '').match(/HTTP_(\d{3})/)?.[1]);
  if (Number.isInteger(code) && code > 0) return `HTTP_${code}`;
  if (/timeout|abort/i.test(String(error?.message ?? '')) || error?.name === 'TimeoutError') return 'TIMEOUT';
  return String(error?.state ?? 'TEMPORARY_ERROR').toUpperCase();
};

export class SearchRotation {
  constructor({ providers, quota, dailyCap = 50 }) { this.providers = providers; this.quota = quota; this.dailyCap = dailyCap; this.kind = 'cura_search_rotation'; this.name = 'Tavily to Firecrawl'; }

  #identityRelevant(candidate, context) {
    const match = verifyCandidate(candidate, context);
    const exactRetailerProduct = match.originalDomain && match.exactIdentifier && !match.conflictingIdentifier && !match.variantConflict;
    const usefulField = Boolean(candidate.title || isProductMediaUrl(candidate.imageUrl)
      || (match.localeMatch && candidate.price && candidate.currency));
    return usefulField && match.sellerMatch && (match.confidence === 'HIGH' || exactRetailerProduct);
  }

  #sufficient(rows, context, missingFields) {
    const needed = missingFields.length ? missingFields.filter((field) => ['title', 'imageUrl', 'price', 'currency'].includes(field)) : ['title', 'imageUrl', 'price'];
    if (!needed.length) return true;
    return needed.every((field) => rows.some((candidate) => {
      if (!this.#identityRelevant(candidate, context)) return false;
      if (field === 'title') return Boolean(candidate.title);
      if (field === 'imageUrl') return isProductMediaUrl(candidate.imageUrl);
      const match = verifyCandidate(candidate, context);
      return match.originalDomain && match.exactIdentifier && match.localeMatch && candidate.price && Number(candidate.price) > 0 && candidate.currency
        && (context.countryAssumed || !context.currencyHint || candidate.currency === context.currencyHint);
    }));
  }

  async resolveProductCandidates(context, { missingFields = [], attemptId = '' } = {}) {
    const output = [];
    const usedQueries = new Set();
    const primary = this.providers.find((provider) => provider.name?.toLowerCase() === 'tavily')
      ?? this.providers.find((provider) => provider.name?.toLowerCase() !== 'firecrawl');
    const backup = this.providers.find((provider) => provider.name?.toLowerCase() === 'firecrawl')
      ?? this.providers.find((provider) => provider !== primary);
    let successfulCalls = 0;

    const attempt = async (provider, role, query, queryIndex, reason = '') => {
      if (!provider) return { status: 'NOT_CONFIGURED', candidates: [], relevant: [] };
      const detail = { attemptId, provider: provider.name, role, queryIndex, ...(reason ? { reason } : {}) };
      const providerId = provider.name.toLowerCase();
      if (Date.now() < (provider.retryAt ?? 0)) {
        recordResolverEvent('SEARCH_PROVIDER_SKIPPED', { ...detail, status: 'COOLDOWN', reason: 'COOLDOWN' });
        return { status: 'COOLDOWN', candidates: [], relevant: [] };
      }
      if (!this.quota.canSpend(providerId) || !this.quota.spend(providerId)) {
        recordResolverEvent('SEARCH_PROVIDER_SKIPPED', { ...detail, status: 'LOCAL_QUOTA', reason: 'LOCAL_QUOTA' });
        return { status: 'LOCAL_QUOTA', candidates: [], relevant: [] };
      }
      recordResolverEvent('SEARCH_PROVIDER_ATTEMPT', detail);
      try {
        const rows = await provider.search(query);
        successfulCalls += 1;
        const candidates = rows.map((row) => normalizeSearchCandidate(row, context, provider)).filter((row) => row.url);
        const relevant = candidates.filter((candidate) => this.#identityRelevant(candidate, context));
        recordResolverEvent('SEARCH_PROVIDER_RESULT', { ...detail, status: 'SUCCESS', candidateCount: candidates.length,
          verifiedCandidates: candidates.filter((candidate) => verifyCandidate(candidate, context).confidence === 'HIGH').length,
          identityRelevantCandidates: relevant.length,
          imageCandidates: candidates.filter((candidate) => isProductMediaUrl(candidate.imageUrl)).length });
        return { status: 'SUCCESS', candidates, relevant };
      } catch (error) {
        const status = providerFailure(error);
        recordResolverEvent('SEARCH_PROVIDER_FAILURE', { ...detail, status });
        return { status, candidates: [], relevant: [] };
      }
    };

    for (let queryIndex = 1; queryIndex <= 2; queryIndex += 1) {
      const priceNeeded = missingFields.includes('price') || missingFields.includes('currency');
      const verifiedPrice = output.some((candidate) => {
        const match = verifyCandidate(candidate, context);
        return match.originalDomain && match.exactIdentifier && match.localeMatch && match.sellerMatch
          && Number(candidate.price) > 0 && candidate.currency && (context.countryAssumed || candidate.currency === context.currencyHint);
      });
      const query = buildSearchQueries(context, { priceFocus: queryIndex === 2 && priceNeeded && !verifiedPrice }).find((candidate) => !usedQueries.has(candidate));
      if (!query) break;
      usedQueries.add(query);
      recordResolverEvent('SEARCH_QUERY', { attemptId, queryIndex, query });

      const primaryResult = await attempt(primary, 'PRIMARY', query, queryIndex);
      output.push(...primaryResult.candidates);
      const primaryHasVerifiedPrice = primaryResult.relevant.some((candidate) => {
        const match = verifyCandidate(candidate, context);
        return match.originalDomain && match.exactIdentifier && match.localeMatch && match.sellerMatch
          && Number(candidate.price) > 0 && candidate.currency && (context.countryAssumed || candidate.currency === context.currencyHint);
      });
      const primaryHasExactPage = primaryResult.candidates.some((candidate) => verifyCandidate(candidate, context).exactCanonical);
      if (primaryHasExactPage || primaryResult.relevant.length && (!priceNeeded || primaryHasVerifiedPrice)) {
        if (backup) recordResolverEvent('SEARCH_PROVIDER_SKIPPED', { attemptId, provider: backup.name, role: 'BACKUP', queryIndex,
          status: 'SKIPPED', reason: 'PRIMARY_RETURNED_USABLE_CANDIDATES' });
      } else {
        const reason = primaryResult.status === 'SUCCESS'
          ? priceNeeded && !primaryHasVerifiedPrice && primaryResult.relevant.length ? 'PRIMARY_NO_VERIFIED_PRICE'
            : primaryResult.candidates.length ? 'PRIMARY_ZERO_USABLE_CANDIDATES' : 'PRIMARY_ZERO_RESULTS'
          : `PRIMARY_${primaryResult.status}`;
        const backupResult = await attempt(backup, 'BACKUP', query, queryIndex, reason);
        output.push(...backupResult.candidates);
      }

      if (this.#sufficient(output, context, missingFields)) break;
      const verifiedTitle = output.find((candidate) => this.#identityRelevant(candidate, context) && candidate.title)?.title;
      context.knownTitle ||= cleanProductTitle(verifiedTitle ?? '');
    }

    output.searchOutcome = successfulCalls ? output.length ? 'results' : 'empty' : 'unavailable';
    const acceptedPrice = output.some((candidate) => {
      const match = verifyCandidate(candidate, context);
      return match.originalDomain && match.exactIdentifier && match.localeMatch && match.sellerMatch
        && Number(candidate.price) > 0 && candidate.currency && (context.countryAssumed || candidate.currency === context.currencyHint);
    });
    output.priceLookupOutcome = acceptedPrice ? 'PRICE_FOUND' : successfulCalls ? 'PRICE_NOT_FOUND' : 'PRICE_LOOKUP_UNAVAILABLE';
    recordResolverEvent('PRICE_LOOKUP_STATE', { attemptId, status: output.priceLookupOutcome, queries: usedQueries.size });
    return output;
  }
}

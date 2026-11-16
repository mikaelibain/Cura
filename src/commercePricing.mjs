export const itemsWithVerifiedPrices = (items) => items.filter((item) =>
  !item.priceEstimated && !item.priceStale && item.price !== null && Number.isFinite(item.price));

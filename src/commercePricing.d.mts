export declare const itemsWithVerifiedPrices: <T extends { price: number | null; priceEstimated?: boolean; priceStale?: boolean }>(items: T[]) => Array<T & { price: number }>;

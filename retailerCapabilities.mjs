export const retailerCapabilities = [
  { family: 'loblaw', domains: ['realcanadiansuperstore.ca', 'loblaws.ca', 'zehrs.ca', 'nofrills.ca', 'wholesaleclub.ca'], rendered: true, priceScope: 'store_or_region', commercialParams: ['pc-express-book'], nativeSearch: (context, query) => `https://${context.hostname}/en/search?search-bar=${encodeURIComponent(query)}` },
  { family: 'shoppers', domains: ['shoppersdrugmart.ca'], rendered: true, priceScope: 'store_or_region' },
  { family: 'shein', domains: ['shein.com'], rendered: true, priceScope: 'market' },
  { family: 'major_department', domains: ['macys.com', 'hm.com', 'aritzia.com', 'londondrugs.com', 'walmart.ca', 'sephora.com', 'lululemon.com'], rendered: true, priceScope: 'market' },
];

export const capabilityFor = (context) => retailerCapabilities.find((entry) => entry.domains.includes(context.baseDomain)) ?? null;

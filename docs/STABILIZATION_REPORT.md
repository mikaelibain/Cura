# Cura stabilization report

## Scope

This was a pre-mobile-UX stabilization pass. No product features, UI redesigns, or persisted-data formats were changed.

## Architecture reviewed

- The React/Vite client is in `src/` and persists its board data in browser local storage.
- The Express server in `server.mjs` handles product resolution, image proxying/caching, safety checks, and optional external integrations.
- `productResolver.mjs` owns URL parsing, public-address validation, secure outbound fetches, resolver caching, and durable technical resolver history.
- The Node test suite uses `node --test` against the `tests/` directory.

## Initial baseline

| Command | Result |
| --- | --- |
| `npm test` | Passed: 158 tests, 0 failures, 0 skipped/cancelled/todo. |
| `npm run build` | Passed: TypeScript build and Vite production build completed. |

There were no original test or build failures to classify. In particular, there was no `vite: Permission denied` error; the build did not indicate a repository configuration, executable-permission, dependency-installation, or environment problem.

## Reliability findings and changes

1. The unsafe-redirect test validated `https://example.com` with the production DNS resolver before its mocked fetch ran. That made this security test dependent on live DNS.
2. The invalid-port test could perform DNS resolution before rejecting a non-default port, even though the URL was already invalid.

Changes made:

- Added `createPublicUrlValidator({ dnsLookup })`, with `validatePublicUrl` retaining the existing production default of Node's DNS lookup.
- Added optional `urlValidator` and `fetcher` dependencies to `secureFetch`, retaining production defaults of `validatePublicUrl` and native `fetch`.
- Reworked security tests to use deterministic DNS answers and a scoped fetch fixture rather than mutating `globalThis.fetch`.
- Added coverage that permits public DNS answers, rejects private DNS answers, rejects unsafe redirect destinations, and confirms malformed/private/credentialed/obfuscated/dangerous-port URLs require no DNS lookup.
- Kept private-address classification ahead of port rejection for private IP literals, preserving the established `PRIVATE_ADDRESS` behavior.

No production security restrictions were weakened. Outbound requests still validate the initial URL and every redirect, reject localhost/private/reserved address ranges, and use the same production DNS and fetch implementations by default.

## Final verification

| Command | Result |
| --- | --- |
| `npm test` | Passed: 159 tests, 0 failures, 0 skipped/cancelled/todo. |
| `npm run build` | Passed: TypeScript build and Vite production build completed. |

The test count increased by one because deterministic DNS public/private coverage was added. No warnings were emitted by either final command.

## Environmental limitations and follow-up

- The automated test suite no longer requires external DNS or internet access for its URL-safety coverage.
- Production product resolution, optional Web Risk/Vision checks, search providers, exchange rates, and image retrieval still inherently require network access and their corresponding credentials/configuration when enabled.
- No follow-up stabilization work is required from these results. Mobile UX work can proceed separately without folding it into this pass.

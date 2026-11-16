# Backend runbook

Requires Node.js 22 and npm. Run commands from `core-arbitrage-backend`:

```sh
npm install
npm run verify
node verify-all.js --require-live
```

The normal verifier reports unavailable live checks separately and may exit 0 with them skipped. `--require-live` exits nonzero when those live checks cannot run. Tests use temporary fixtures, not real leads. Network egress must allow the sites being crawled, DNS, Bing and `rdap.org`. The current sandbox did not allow Node's live HTTP requests, so the end-to-end live results are unverified.

## 1. Dead-link hunter

```sh
node 01-dead-link-hunter/index.js --seed https://en.wikipedia.org/wiki/Category:Internet --depth 1 --max-pages 20 --concurrency 4 --output output/available_expired_domains.csv
```

Repeat `--seed` for additional starting pages. Depth is relative to seeds, restricted to their origins; external links are deduplicated by registrable domain, preserving the first source and anchor. An empty CSV may mean no qualifying domains, not that a purchase opportunity exists. A candidate requires both NXDOMAIN responses and an RDAP 404. RDAP 404 can be ambiguous: **confirm with the authoritative registry and registrar before purchase**. Neither availability nor an $8 price is guaranteed. Network errors and other RDAP statuses are not treated as available. The crawler checks HTTP, DNS and RDAP but does not require an HTTP failure for candidate inclusion. HTTP checks use HTTPS. Execution time scales with discovered domains.

## 2. Apify actor

From the module directory (requires an authenticated Apify CLI):

```sh
cd 02-apify-rentable-actor
apify push
```

Example actor input:

```json
{"queries":["plumber Berlin"],"countryCodes":["DE"],"maxBusinesses":20,"maxPagesPerWebsite":5,"concurrency":3}
```

The actor parses Bing search result pages, not a licensed listings API. Search markup, access restrictions, redirect links, bot blocking and country targeting can affect coverage. It inspects HTML only, with no JavaScript rendering. `trackingStatus: incomplete` means a negative tag result is inconclusive. Even a complete crawl cannot establish that a tag is absent from every page or dynamically loaded. The actor has not been deployed or tested on Apify here. Review Apify publishing, pricing, platform terms, consent and applicable privacy laws before commercialization.

## 3. Trigger sniper

```sh
node 03-b2b-trigger-sniper/index.js --input businesses.json --days 90 --output output/ready_to_send_leads.json
# or
node 03-b2b-trigger-sniper/index.js --input businesses.csv --days 90 --output output/ready_to_send_leads.json
```

JSON is an array of businesses. Fields: `name`, `city`, optional `email`, `phone`, `website`, `reviewCount` (or `review_count`), `activeAds` (or `active_ads`), `brokenSSL` (or `broken_ssl`), `metaPixel` (or `meta_pixel`) and `reviews`. Reviews are an array of objects with numeric `rating`, ISO `date` and exact `text`. In CSV, encode the reviews array as a properly quoted JSON string. Booleans are true/false. `metaPixel: false` must be explicitly supplied; unknown is not treated as missing. Activity, SSL and pixel fields are **input assertions**, not verified by this engine. Drafts are generated locally; no messages are sent. Review claims, personal data, opt-outs and local anti-spam rules before sending.

## Operational limitations

These tools do not enforce robots.txt or site-specific terms, and are not production-hardened or a substitute for an approved data source. Use modest concurrency, explicit authorization and appropriate egress controls. URL checks reject private destinations and redirects, but DNS resolution is not pinned to the connection, so DNS rebinding remains possible; deploy behind a network-level egress policy. Tracking detection is heuristic and search coverage is not guaranteed. Logs go to stderr as JSON; output may contain personal data. Store securely and apply retention rules. `npm audit` currently reports vulnerabilities in transitive Apify dependencies; assess and remediate before deployment.

# Network load widget

Open `widget.html` directly or embed the GitHub Pages widget as shown in
`index.html`.

## Everscale mainnet

The widget polls the existing Evercloud GraphQL endpoint every five seconds.
BPS and TPS use server-side counts over `(now - 70s, now - 10s]`: a rolling
60-second window with ten seconds allowed for indexing. Masterchain and
workchain 0 TPS use the same interval. Repeated polls replace the snapshot;
they do not add the same blocks again. The server aggregates all matching
blocks, so a busy window cannot be truncated by a client-side block limit.
The displayed block is selected by generation time, not sequence numbers from
different shards.

A request times out after 15 seconds. HTTP, GraphQL, malformed response, and
stale-head errors clear the rates and display an error until a later poll
succeeds. A head more than 30 seconds from the browser clock is rejected;
the browser clock must be accurate. Rates still depend on the completeness
and indexing delay of Evercloud's data.

### Migration status (checked 2026-10-01)

The **data provider has not yet changed**. HTTP queries and WebSocket
subscriptions to the existing mainnet Evercloud endpoint both returned fresh
blocks during verification. The calculation and transport have changed.

The network title links to [Evertx](https://evertx.us/). Block labels retain
main's temporary link to [Evertx validators](https://evertx.us/validators)
until a block page is available. This is a placeholder, not a block detail page.
During verification, the home, config, account, and transaction pages exposed
no block links; `/blocks` and `/api` returned HTTP 404.

The proposed [block-rpc branch](https://github.com/aagolovanov/everscale-jrpc/tree/block-rpc)
adds `getMasterchainInfo`, `getBlockHeader`, `getShards`, and `lookupBlock`.
Its [header model](https://github.com/aagolovanov/everscale-jrpc/blob/3e321c2b75be65bc0c4b91e252c36c70dedef8a6/models/src/jrpc/blocks.rs)
does not include a transaction count, a block transaction list, or the complete
block BOC. `end_lt - start_lt` is not a transaction count. The upstream
[RPC methods](https://github.com/broxus/everscale-jrpc#methods) do not provide a
network-wide block stream either.

Completing the requested provider and block-link migration requires:

- A deployed, browser-accessible RPC/API endpoint with CORS enabled.
- Complete block transaction counts, block transaction pagination, or complete
  block BOCs that can be decoded to obtain those counts.
- A verified Evertx block URL format with a working example.

Until those prerequisites are supplied, this is a partial fix and should remain
a draft PR.

## Tests

Requires Node.js 18 or newer; no packages need to be installed.

```sh
node --test tests/everscale.test.cjs
```

Tests cover the shared measurement interval, repeated polls, empty windows,
zero workchain traffic, failed and malformed responses, stale data, recovery,
and network dispatch. Live API and browser checks are separate from these
local tests.

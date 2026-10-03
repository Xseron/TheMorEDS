# morseal-drip

Devnet faucet for the MOR site: `POST /api/drip {"address"}` sends 0.05 devnet SOL and 50 demo tokens to a wallet once, in one transaction signed by the issuer key (fee payer and mint authority); `GET /api/drip/health` reports the issuer balance.
Environment: `DRIP_KEY` (issuer keypair JSON, `/etc/morseal/issuer.json`), `DRIP_RPC`, `DRIP_MINT`, `DRIP_PORT` (8790, listens on 127.0.0.1), `DRIP_SOL` (lamports), `DRIP_TOKENS`, `DRIP_STATE` (served addresses, `./drip-state.json`), `DRIP_ORIGINS` (CORS, comma separated).
Run: Node 20.18 or newer, `npm ci && npm start` behind nginx, which must set `X-Forwarded-For $remote_addr` (the first value is the client IP for rate limits); `npm test` runs offline.

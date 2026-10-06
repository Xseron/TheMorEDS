# Contributing to MOR

Issues and pull requests are welcome

## Reporting Issues

- Open a GitHub issue with steps to reproduce, what you expected and what happened
- If it looks like a security problem (signature checks, precompile parsing, the attestor), write to us on Telegram first instead of opening a public issue

## Pull Requests

1. Fork the repository and branch from `main`
2. Keep the change focused and add tests next to the code you touch
3. Run the checks for the parts you changed
4. Open a pull request against `main`

## Checks

| Part | Command |
|------|---------|
| Programs | `anchor build && cargo test -p mor_registry -p sealed_transfer -p mor-verify-seal` |
| Attestor | `cd attestor && go vet ./... && go test ./...`, with the NCA SDK also `go test -tags kalkan ./...` |
| Website | `cd web/frontend && pnpm lint && pnpm test`, end-to-end on devnet: `pnpm test:e2e` |
| Faucet | `cd web/drip && npm test` |
| Devnet scripts | `cd scripts/devnet-v1 && npx tsc --noEmit -p .` |

CI runs all of it except the LiteSVM integration tests, which need `anchor build`, and the KalkanCrypt tests, which need the NCA SDK

## Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/) with a scope where it helps:

```
feat: revoke a seal by the organization
fix(web): seal check bound to the current wallet
test: negative paths for register_certificate
```

## Keep in Mind

- Don't commit the NCA SDK (`pkisdk/`), its license doesn't allow redistribution
- The keys in `fixtures/keys/` are test keys and public on purpose. Never put real keys into the repository
- The seal message layout is shared by the Rust program, the Go attestor and the TypeScript clients. Change it in all three at once and only with a new tag version

## Questions

Telegram [@dtorossyan](https://t.me/dtorossyan) or [@ablStartup](https://t.me/ablStartup)

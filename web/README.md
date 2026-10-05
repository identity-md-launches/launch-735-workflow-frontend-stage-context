# Genesis Protocol frontend

A static React + TypeScript dashboard for the attested GENESIS launch on Sepolia. Source, frontend configuration, and the exact npm lockfile live here. The publisher serves the committed repository-root `dist/`; no server or runtime build is required.

## Install, build and preview

Use Node 22.12+ and npm 10+ from the repository root:

```sh
npm ci --prefix web --cache test/scratch/npm-cache
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run check:export
npm --prefix web run preview
```

`npm ci` uses the lockfile; installation may need the registry. With an already populated local npm cache, `npm ci --offline --prefix web --cache test/scratch/npm-cache` also works. No dependency registry or package archives are shipped. `node_modules` and caches are excluded. The build itself has no network dependency; it requires Git history containing the pinned deployment source commit to verify the ABI.

Vite uses `base: './'`. The export contains local scripts, styles, a vector brand mark, the raw contract ABI, and `imd-deployment.json`. Navigation uses in-page anchors, so gateway subpaths need no rewrite rules. Serve `dist/` over HTTP(S), not `file://`. Wallet clipboard features work best in secure contexts.

## Deployment configuration

`src/config.ts` fetches **the exported `imd-deployment.json` at runtime**, then fetches the ABI at each contract's declared `abiPath` and checks canonical Keccak-256. Addresses, chain ID, network endpoints, explorer/faucet links, pool key and Uniswap addresses come only from that runtime manifest. Protocol interfaces in `src/protocol.ts` describe external Uniswap functions; the application token ABI is loaded from the implementation-derived JSON, not handwritten.

`deployment/handoff.json` and `deployment/network.json` preserve the supplied build inputs. They are not bundled into JavaScript or a second runtime map. `scripts/export.mjs`:

1. Checks preserved inputs against `.imd/reads/` when those worker inputs still exist.
2. Reads `docs/abi/LaunchToken.json` and compares it with the exact pinned Git source commit.
3. Computes recursively key-sorted canonical JSON Keccak-256 and checks the attested ABI hash.
4. Copies the ABI, identifiers, exact contract set, pool key and unchanged network/wallet setup objects into the export.
5. Enumerates and SHA-256 hashes every exported file except the manifest itself.

Always use `npm run build` after source or asset edits. Do not edit generated deployment data separately. `check:export` validates the complete inventory, bytes, hashes, limits and exact expected manifest. Publication checks are the control plane's responsibility.

## Available actions

- Connect an injected Ethereum browser wallet, disconnect, and switch to Sepolia. Unknown-chain error 4902 (or an equivalent unknown-chain message) offers the exact supplied `wallet_addEthereumChain` record, then retries switching. No WalletConnect project ID was supplied, so there is no WalletConnect dependency or QR connector.
- Read total supply, token metadata, wallet balances, current block, pool slot and liquidity at a single block per refresh. Reads poll every five seconds when connected and every fifteen seconds otherwise, pause when the page is hidden, and never overlap. Public RPCs fall back in the supplied order; an already connected wallet can supply dashboard reads if public chain discovery fails. Quotes/simulations and receipt checks use configured public RPCs.
- Buy and sell GENESIS in the exact attested ETH pool, including its nonzero initialization guard and 1.25% fee. Earlier 0.3% admission-policy fields are not used for trading. Positive initialized price permits quoting even when current-tick liquidity is zero; the quoter can cross into other ranges. A successful quote and execution simulation determine whether a swap can proceed.
- Sell approval step 1: approve the exact GENESIS amount to configured Permit2 when needed. Step 2: authorize the configured Universal Router for that amount for 30 minutes when needed. Both allowances are reread. Each step requires a separate click and wallet confirmation. Native buys skip approval and send exactly the input ETH.
- Quotes use `simulateContract` on `quoteExactInputSingle`. Slippage accepts 0.1–5% in hundredths of a percent. Quotes expire after 30 seconds and are invalidated on form, account or network changes. Integer minimum output rounds down; calldata uses V4 command `0x10`, actions `0x060c0f`, the handoff pool key, and a 20-minute deadline. The codec supports the network's optional extended tuple flag; this release's UI is for the supplied native ETH pair.
- Token tools expose `transfer`, `approve` (including revocation), `transferFrom`, and an allowance reader. Nonzero-to-nonzero generic allowance changes require a confirmed zero reset. Address inputs require valid nonzero hexadecimal addresses; ENS resolution is not configured for this release. A full amount/address review precedes wallet requests.

The ABI, chain and nonempty code checks gate transactions. Code is checked initially for every configured protocol/application address and the guard, then again on each transaction target before simulation. Every transaction is simulated before requesting a signature; wallet account and chain are checked again immediately before sending. Buttons lock through receipt confirmation and refresh. Session history shows simulation, signing, pending, confirmed and failure states with explorer links. Cancellation/replacement handling and unknown-confirmation messages avoid presenting a timeout as success.

## Metrics and limitations

Total supply is live `totalSupply()`, not a hardcoded metric. Circulating supply is intentionally **unavailable**: the handoff does not provide a reliable definition or verified distributor/locked allocation addresses. Supply minus arbitrary addresses would invent a metric. Wallet balance and ETH fees use on-chain decimals. Spot price comes from `sqrtPriceX96` and is not an executable quote. USD values are unavailable because no approved price source was provided. Liquidity is labeled as raw current-tick pool units, not TVL. Activity is for the current browser session only.

This is an intentionally dark interface. No theme control, external font service, analytics, private endpoint, backend, secret, key or signing service is included. Visitors sign with their own wallets. No real transaction was broadcast during validation. Wallet extension compatibility, real gas spending, transaction replacement on a live chain and mobile wallet browsers remain untested. Local receipt/rejection paths are mocked. There is no liquidity-management UI because no LP ownership handoff or liquidity-management requirement was supplied.

No final domain or CID was supplied. Title, description, favicon and Open Graph text are included; absolute social-image/canonical URLs are deferred until publication.

## Reproduce validation

```sh
npm --prefix web test
npm --prefix web run test:browser
node web/scripts/live-check.mjs 11851614
```

The browser script starts and stops its own foreground HTTP server at `/preview/`, launches local headless Chromium, and intercepts all RPC/wallet transaction requests. It needs no funds and never broadcasts. This worker's default Chromium executable is declared in the script; elsewhere set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible installed Chromium. It writes actual screenshots, axe results, measured contrast and interaction results under `docs/evidence/`. The live check is read-only: it uses `curl` through only supplied public RPCs and optionally takes a fixed block number. Archive availability may vary.

See `../docs/VALIDATION.md` for measured outcomes, known limitations, and the six-domain Better Interface review. See `../docs/DESIGN.md` for the final implemented design. Root `DESIGN.md` could not be created under this assignment's explicit path restriction; its content is delivered at the allowed documentation path instead.

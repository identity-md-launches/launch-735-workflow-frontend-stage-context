import { useState } from "react";
import { useConnect, useDisconnect } from "wagmi";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  CircleHelp,
  Code2,
  Coins,
  FileCheck2,
  Globe2,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Runtime } from "./config";
import { switchNetwork } from "./config";
import { useDashboard } from "./useDashboard";
import { display, friendlyError } from "./protocol";
import { AddressLink, Busy, ErrorText, External, Metric } from "./components";
import { Swap } from "./Swap";
import { TokenTools } from "./TokenTools";
export function App({ runtime }: { runtime: Runtime }) {
  const dash = useDashboard(runtime);
  const { deployment: d, token } = runtime;
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [walletError, setWalletError] = useState("");
  const [switching, setSwitching] = useState(false);
  const s = dash.snapshot;
  const symbol = s?.symbol || "GENESIS";
  const wrong = !!dash.address && dash.chainId !== d.chainId;
  async function connect() {
    setWalletError("");
    try {
      const connector = connectors[0];
      if (!connector || !(await connector.getProvider()))
        throw Error(
          "No browser wallet found. Open this page in a wallet browser or install an Ethereum wallet extension, then retry.",
        );
      await connectAsync({ connector });
    } catch (e) {
      setWalletError(friendlyError(e));
    }
  }
  async function switchChain() {
    setWalletError("");
    setSwitching(true);
    try {
      await switchNetwork(await dash.provider(), d);
      await dash.refresh();
    } catch (e) {
      setWalletError(friendlyError(e));
    } finally {
      setSwitching(false);
    }
  }
  const walletButton = (
    <button
      className="primary full"
      disabled={isPending || switching || !!dash.active}
      onClick={() => void (wrong ? switchChain() : connect())}
    >
      {isPending || switching ? (
        <Busy label={switching ? "Switching network…" : "Connecting…"} />
      ) : (
        <>
          <Wallet size={16} />
          {wrong ? `Switch to ${d.network.name}` : "Connect wallet"}
        </>
      )}
    </button>
  );
  const poolStatus = s?.pool
    ? s.pool.sqrtPrice === 0n
      ? "Not initialized"
      : s.pool.liquidity === 0n
        ? "No liquidity at current tick"
        : "Active liquidity"
    : "Awaiting network";
  let spot: string | undefined;
  if (s?.pool && s.pool.sqrtPrice > 0n) {
    const raw = (Number(s.pool.sqrtPrice) / 2 ** 96) ** 2;
    const tokenFirst =
      d.poolKey.currency0.toLowerCase() === token.address.toLowerCase();
    const ratio = tokenFirst
      ? raw * 10 ** (s.decimals - d.network.nativeCurrency.decimals)
      : (1 / raw) * 10 ** (s.decimals - d.network.nativeCurrency.decimals);
    spot = ratio.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  }
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#main" aria-label="Genesis Protocol home">
          <img src="./genesis.svg" width="38" height="38" alt="" />
          <span>
            genesis<span className="brand-sub">PROTOCOL</span>
          </span>
        </a>
        <div className="workspace-label">
          Workspace <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          <a className="nav-item current" href="#main">
            <LayoutDashboard size={18} />
            Overview
            <span className="nav-dot" />
          </a>
          <a className="nav-item" href="#trade">
            <ArrowLeftRight size={18} />
            Swap tokens
          </a>
          <a className="nav-item" href="#token-tools">
            <Wallet size={18} />
            Token tools
          </a>
          <a className="nav-item" href="#contracts">
            <Code2 size={18} />
            Contracts
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-orbit">
              <Globe2 size={22} />
            </div>
            <strong>Built on {d.network.name}</strong>
            <p>
              A space to explore.
              <br />
              Test tokens. Real possibilities.
            </p>
            <External href={d.network.faucets[0]}>Get test ETH</External>
          </div>
          <External
            className="help-link"
            href={`${d.network.explorer}/address/${token.address}#code`}
          >
            <CircleHelp size={16} />
            Explore the contract
          </External>
          <div className="sidebar-foot">
            <span className="status-dot" />
            Testnet environment
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <span className={`network-pill ${wrong ? "warning" : ""}`}>
              <span className="status-dot" />
              {wrong ? "Wrong network" : d.network.name}
            </span>
            {dash.address ? (
              <>
                <AddressLink
                  address={dash.address}
                  explorer={d.network.explorer}
                />
                <button
                  className="icon-button"
                  aria-label="Disconnect wallet"
                  disabled={!!dash.active}
                  onClick={() => disconnect()}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="connect-small"
                onClick={() => void connect()}
                disabled={isPending}
              >
                {isPending ? (
                  <Busy label="Connecting…" />
                ) : (
                  <>
                    <Wallet size={16} />
                    Connect wallet
                  </>
                )}
              </button>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                The genesis ecosystem
              </div>
              <h1>
                Genesis, at a glance<span>.</span>
              </h1>
              <p>
                Your gateway to GENESIS. Explore, connect, and make your next
                move.
              </p>
            </div>
            <div className="sync">
              <button
                className="quiet"
                onClick={() => void dash.refresh()}
                disabled={dash.refreshing}
              >
                <RefreshCw
                  size={14}
                  className={dash.refreshing ? "spinner" : ""}
                />
                {dash.refreshing ? "Syncing…" : "Refresh data"}
              </button>
              <span>
                {s
                  ? `Block ${s.block.toLocaleString("en-US")}`
                  : "Waiting for chain data"}
              </span>
            </div>
          </div>
          <div className="testnet-banner">
            <span className="testnet-label">Testnet</span>
            <span>
              You’re exploring on {d.network.name}. These tokens are for
              testing.
            </span>
            <External href={d.network.faucets[0]}>Get test ETH</External>
          </div>
          {walletError && <ErrorText message={walletError} />}
          {wrong && (
            <div className="notice">
              <span>
                Your wallet is on another network. Switch to continue.
              </span>
              {walletButton}
            </div>
          )}
          {dash.error && (
            <div className="notice error-notice">
              <div>
                <strong>Live data is unavailable</strong>
                <p>
                  {dash.error}{" "}
                  {s ? "Previously loaded values may be stale." : ""}
                </p>
              </div>
              <button
                onClick={() => void dash.refresh()}
                disabled={dash.refreshing}
              >
                Retry connection
              </button>
            </div>
          )}
          <div className="metrics">
            <Metric
              label="Total supply"
              value={display(s?.total, s?.decimals ?? 18, 0)}
              unit={symbol}
              detail="Fixed supply · No mint function"
              icon={<Coins size={17} />}
            />
            <Metric
              label="Circulating supply"
              value="Unavailable"
              detail="No verified allocation data provided"
              icon={<Boxes size={17} />}
            />
            <Metric
              label="Your balance"
              value={display(s?.balance, s?.decimals ?? 18)}
              unit={symbol}
              detail={
                dash.address
                  ? `${display(s?.eth, d.network.nativeCurrency.decimals)} ETH for network fees`
                  : "Connect a wallet to view your tokens"
              }
              icon={<Wallet size={17} />}
            />
          </div>
          <div className="main-grid">
            <div className="overview-column">
              <section
                className="genesis-feature"
                aria-labelledby="feature-title"
              >
                <div className="feature-content">
                  <span className="outline-label">Community starts here</span>
                  <h2 id="feature-title">
                    An open beginning.
                    <br />A shared future.
                  </h2>
                  <p>
                    A community-driven utility token.
                    <br />
                    Built for transfers, trading, and what comes next.
                  </p>
                  <a href="#contracts" className="feature-link">
                    Discover the protocol
                    <ArrowUpRight size={16} />
                  </a>
                </div>
                <div className="genesis-art" aria-hidden="true">
                  <svg viewBox="0 0 300 300">
                    <defs>
                      <radialGradient id="glow">
                        <stop stopColor="#adb967" stopOpacity=".2" />
                        <stop offset="1" stopColor="#adb967" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    <circle cx="150" cy="150" r="145" fill="url(#glow)" />
                    <g fill="none" stroke="#68704a" strokeWidth=".7">
                      <circle cx="150" cy="150" r="111" />
                      <ellipse
                        cx="150"
                        cy="150"
                        rx="111"
                        ry="45"
                        transform="rotate(-35 150 150)"
                      />
                      <ellipse
                        cx="150"
                        cy="150"
                        rx="111"
                        ry="45"
                        transform="rotate(35 150 150)"
                      />
                      <ellipse
                        cx="150"
                        cy="150"
                        rx="111"
                        ry="45"
                        transform="rotate(90 150 150)"
                      />
                    </g>
                    <circle cx="150" cy="150" r="54" fill="#c7d580" />
                    <path
                      d="M172 132a30 30 0 1 0 6 30h-30v-17h49v13a47 47 0 1 1-11-40"
                      fill="none"
                      stroke="#283017"
                      strokeWidth="7"
                      transform="translate(40 40) scale(.73)"
                    />
                    <circle cx="65" cy="79" r="4" fill="#c7d580" />
                    <circle cx="248" cy="203" r="3" fill="#c7d580" />
                  </svg>
                  <span className="art-caption">GENESIS / 001</span>
                </div>
                <div className="feature-footer">
                  <span>ERC-20 standard</span>
                  <span>
                    Onchain by design <ArrowUpRight size={13} />
                  </span>
                </div>
              </section>
              <section className="panel pool-panel" id="pool">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">The market</span>
                    <h2>GENESIS / ETH</h2>
                  </div>
                  <span className="small-badge">
                    <span className="status-dot" />
                    {poolStatus}
                  </span>
                </div>
                <div className="pool-stats">
                  <div>
                    <span>Pool fee</span>
                    <strong>
                      {(d.poolKey.fee / 10000).toFixed(2)}
                      <small>%</small>
                    </strong>
                  </div>
                  <div>
                    <span>Spot price</span>
                    <strong className="spot">
                      <span className="spot-number">{spot ?? "—"}</span>
                      <small> ETH</small>
                    </strong>
                  </div>
                  <div>
                    <span>Protocol</span>
                    <strong className="protocol-value">Uniswap v4</strong>
                  </div>
                </div>
                <p className="caption">
                  Spot price is not an execution quote. Liquidity at the current
                  tick:{" "}
                  {s?.pool ? s.pool.liquidity.toLocaleString("en-US") : "—"}{" "}
                  (raw pool units). Quotes may cross into other liquidity
                  ranges.
                </p>
                {s?.poolError && (
                  <ErrorText
                    message={`Pool state unavailable. ${s.poolError}`}
                  />
                )}
                <details>
                  <summary>View pool details</summary>
                  <dl className="details-list">
                    <div>
                      <dt>Pool ID</dt>
                      <dd className="mono wrap">{dash.id}</dd>
                    </div>
                    <div>
                      <dt>Tick spacing</dt>
                      <dd>{d.poolKey.tickSpacing}</dd>
                    </div>
                    <div>
                      <dt>Current tick</dt>
                      <dd>{s?.pool?.tick ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Observed LP fee</dt>
                      <dd>{s?.pool ? `${s.pool.lpFee / 10000}%` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Pool manager</dt>
                      <dd>
                        <AddressLink
                          address={d.network.uniswapV4.poolManager}
                          explorer={d.network.explorer}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Pool guard</dt>
                      <dd>
                        <AddressLink
                          address={d.poolKey.hooks}
                          explorer={d.network.explorer}
                        />
                      </dd>
                    </div>
                  </dl>
                </details>
                <External
                  href={`${d.network.explorer}/address/${d.network.uniswapV4.stateView}#readContract`}
                >
                  View pool state on Etherscan
                </External>
              </section>
            </div>
            <Swap runtime={runtime} dash={dash} walletControl={walletButton} />
          </div>
          <div className="lower-grid">
            <TokenTools runtime={runtime} dash={dash} />
            <section
              className="panel activity-panel"
              aria-labelledby="activity-title"
            >
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Your onchain trail</span>
                  <h2 id="activity-title">Session activity</h2>
                </div>
                <Activity size={20} className="muted" />
              </div>
              <div role="status" aria-live="polite" className="tx-status">
                {dash.transactions[0]
                  ? `${dash.transactions[0].label}: ${dash.transactions[0].status}`
                  : ""}
              </div>
              {dash.transactions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <ArrowLeftRight size={25} />
                  </span>
                  <h3>Your next move starts here</h3>
                  <p>
                    Confirmed and pending actions from this session will appear
                    here.
                  </p>
                  <a href="#trade">
                    Go to swap <ArrowUpRight size={14} />
                  </a>
                </div>
              ) : (
                <ol className="activity-list">
                  {dash.transactions.map((t, i) => (
                    <li key={i}>
                      <div className="between">
                        <strong>{t.label}</strong>
                        <span className={`tx-badge ${t.status}`}>
                          {t.status}
                        </span>
                      </div>
                      {t.hash && (
                        <External href={`${d.network.explorer}/tx/${t.hash}`}>
                          View transaction
                        </External>
                      )}
                      {t.message && <ErrorText message={t.message} />}
                    </li>
                  ))}
                </ol>
              )}
              <p className="caption activity-foot">
                Session only · Check Etherscan for your complete history.
              </p>
            </section>
          </div>
          <section className="panel contracts-panel" id="contracts">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Transparent by default</span>
                <h2>Verify the details</h2>
              </div>
              <FileCheck2 size={21} className="muted" />
            </div>
            <div className="contract-grid">
              <div>
                <span className="muted">GENESIS contract</span>
                <AddressLink
                  address={token.address}
                  explorer={d.network.explorer}
                  full
                />
                <div className="contract-tags">
                  <span>ERC-20</span>
                  <span>{s?.decimals ?? "—"} decimals</span>
                  <span>No privileged roles</span>
                </div>
              </div>
              <div>
                <span className="muted">Deployment status</span>
                <p className="verification">
                  <ShieldCheck size={17} />
                  {dash.verified
                    ? "Chain, code & ABI checked"
                    : "Waiting for deployment checks"}
                </p>
                <External
                  href={`${d.network.explorer}/address/${token.address}#code`}
                >
                  Inspect token source
                </External>
              </div>
            </div>
            <details>
              <summary>Attestation and supply methodology</summary>
              <p>
                Circulating supply needs verified locked and unclaimed
                allocations. Those addresses were not supplied, so it cannot be
                derived reliably from total supply alone.
              </p>
              <dl className="details-list">
                <div>
                  <dt>Source commit</dt>
                  <dd className="mono wrap">{d.sourceCommit}</dd>
                </div>
                <div>
                  <dt>Attestation hash</dt>
                  <dd className="mono wrap">{d.attestationHash}</dd>
                </div>
                <div>
                  <dt>ABI hash</dt>
                  <dd className="mono wrap">{token.abiHash}</dd>
                </div>
              </dl>
              <p className="caption">
                Checks bind this app to its supplied deployment record; they are
                not a contract audit. USD pricing and full historical activity
                are unavailable.
              </p>
              <a href="./imd-deployment.json">Download deployment record</a>
            </details>
          </section>
          <footer>
            <span className="footer-brand">
              genesis <span>PROTOCOL</span>
            </span>
            <p>Open access. Shared possibility.</p>
            <span>
              {d.network.name} testnet <span className="status-dot" />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

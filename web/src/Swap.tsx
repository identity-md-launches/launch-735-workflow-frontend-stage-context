import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { zeroAddress, formatUnits } from "viem";
import type { Runtime } from "./config";
import type { Dashboard } from "./useDashboard";
import {
  amountUnits,
  display,
  friendlyError,
  minimumOut,
  permitAbi,
  quoterAbi,
  routerAbi,
  slippageBps,
  swapPayload,
} from "./protocol";
import { Busy, ErrorText } from "./components";
interface Quote {
  out: bigint;
  minimum: bigint;
  amount: bigint;
  at: number;
  tokenAllowance: bigint;
  routerAllowance: bigint;
  expiration: number;
  key: string;
}
export function Swap({
  runtime,
  dash,
  walletControl,
}: {
  runtime: Runtime;
  dash: Dashboard;
  walletControl: React.ReactNode;
}) {
  const { deployment: d, client, token, abis } = runtime;
  const { address, snapshot, ready, active } = dash;
  const [sell, setSell] = useState(false);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [acting, setActing] = useState(false);
  const actionLock = useRef(false);
  const [now, setNow] = useState(Date.now());
  const serial = useRef(0);
  const decimals = snapshot?.decimals ?? 18;
  const symbol = snapshot?.symbol || "GENESIS";
  const input = sell ? token.address : zeroAddress;
  const output = sell ? zeroAddress : token.address;
  const inputSymbol = sell ? symbol : d.network.nativeCurrency.symbol;
  const outputSymbol = sell ? d.network.nativeCurrency.symbol : symbol;
  const inputDecimals = sell ? decimals : d.network.nativeCurrency.decimals;
  const outputDecimals = sell ? d.network.nativeCurrency.decimals : decimals;
  const key = `${address}:${dash.chainId}:${amount}:${slippage}:${sell}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    setQuote(undefined);
    setError("");
    serial.current++;
  }, [key]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const fresh = !!quote && quote.key === key && now - quote.at < 30000;
  const nativePair = [d.poolKey.currency0, d.poolKey.currency1].includes(
    zeroAddress,
  );
  const poolReady =
    !!snapshot?.pool && snapshot.pool.sqrtPrice > 0n && nativePair;
  const needsToken = !!quote && sell && quote.tokenAllowance < quote.amount;
  const needsRouter =
    !!quote &&
    sell &&
    (quote.routerAllowance < quote.amount ||
      quote.expiration < Math.floor(now / 1000) + 1200);
  async function allowances() {
    if (!sell || !address)
      return { tokenAllowance: 0n, routerAllowance: 0n, expiration: 0 };
    const [tokenAllowance, permit] = await Promise.all([
      client.readContract({
        address: token.address,
        abi: abis[token.name],
        functionName: "allowance",
        args: [address, d.network.uniswapV4.permit2],
      }) as Promise<bigint>,
      client.readContract({
        address: d.network.uniswapV4.permit2,
        abi: permitAbi,
        functionName: "allowance",
        args: [address, token.address, d.network.uniswapV4.universalRouter],
      }),
    ]);
    return {
      tokenAllowance,
      routerAllowance: permit[0],
      expiration: permit[1],
    };
  }
  async function getQuote() {
    if (quoting || active) return;
    setError("");
    setQuoting(true);
    const ticket = ++serial.current;
    const requestedKey = key;
    try {
      if (
        !ready ||
        !poolReady ||
        !snapshot ||
        Date.now() - snapshot.time >= 45000
      )
        throw Error(
          "Connect on the configured network and wait for a verified, initialized pool.",
        );
      const parsed = amountUnits(amount, inputDecimals);
      const bps = slippageBps(slippage);
      const balance = sell ? snapshot?.balance : snapshot?.eth;
      if (balance === undefined || parsed > balance)
        throw Error(
          `Your ${inputSymbol} balance is too low. Reduce the amount.`,
        );
      if (!sell && parsed === balance)
        throw Error("Keep some ETH in your wallet for network fees.");
      const [{ result }, allowance] = await Promise.all([
        client.simulateContract({
          address: d.network.uniswapV4.quoter,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              poolKey: d.poolKey,
              zeroForOne: input === d.poolKey.currency0,
              exactAmount: parsed,
              hookData: "0x",
            },
          ],
          account: address!,
        }),
        allowances(),
      ]);
      const minimum = minimumOut(result[0], bps);
      if (minimum === 0n)
        throw Error(
          "The quote returns too little. Increase the amount or retry when liquidity is available.",
        );
      if (ticket === serial.current && requestedKey === currentKey.current)
        setQuote({
          out: result[0],
          minimum,
          amount: parsed,
          at: Date.now(),
          ...allowance,
          key: requestedKey,
        });
    } catch (e) {
      if (ticket === serial.current) setError(friendlyError(e));
    } finally {
      setQuoting(false);
    }
  }
  async function act() {
    if (!quote || !fresh || active || actionLock.current) return;
    actionLock.current = true;
    setActing(true);
    setError("");
    try {
      const current = await allowances();
      if (quote.key !== currentKey.current || Date.now() - quote.at >= 30000)
        throw Error(
          "This quote expired or the form changed. Request a fresh quote.",
        );
      if (sell && current.tokenAllowance < quote.amount) {
        const success = await dash.transact(`Approve ${symbol} to Permit2`, {
          address: token.address,
          abi: abis[token.name],
          functionName: "approve",
          args: [d.network.uniswapV4.permit2, quote.amount],
        });
        if (success) {
          const next = await allowances();
          setQuote((q) => (q ? { ...q, ...next } : q));
        }
        return;
      }
      if (
        sell &&
        (current.routerAllowance < quote.amount ||
          current.expiration < Math.floor(Date.now() / 1000) + 1200)
      ) {
        const success = await dash.transact("Authorize router", {
          address: d.network.uniswapV4.permit2,
          abi: permitAbi,
          functionName: "approve",
          args: [
            token.address,
            d.network.uniswapV4.universalRouter,
            quote.amount,
            Math.floor(Date.now() / 1000) + 1800,
          ],
        });
        if (success) {
          const next = await allowances();
          setQuote((q) => (q ? { ...q, ...next } : q));
        }
        return;
      }
      if (quote.key !== currentKey.current || Date.now() - quote.at >= 30000)
        throw Error(
          "This quote expired. Request a fresh quote before swapping.",
        );
      const payload = swapPayload(d, input, quote.amount, quote.minimum);
      if (
        await dash.transact(`Swap ${inputSymbol} for ${outputSymbol}`, {
          address: d.network.uniswapV4.universalRouter,
          abi: routerAbi,
          functionName: "execute",
          args: [payload.commands, payload.inputs, payload.deadline],
          value: payload.value,
        })
      ) {
        setAmount("");
        setQuote(undefined);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  }
  const actionLabel = needsToken
    ? `Approve ${symbol} to Permit2`
    : needsRouter
      ? "Authorize router"
      : `Swap ${inputSymbol} for ${outputSymbol}`;
  const latestTx = dash.transactions[0];
  const transactionError =
    latestTx?.status === "failed" &&
    [
      "Authorize router",
      `Approve ${symbol} to Permit2`,
      `Swap ${inputSymbol} for ${outputSymbol}`,
    ].includes(latestTx.label)
      ? latestTx.message ||
        "The transaction failed. Review the details and retry."
      : "";
  return (
    <section
      className="panel swap-panel"
      id="trade"
      aria-labelledby="swap-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Make a move</span>
          <h2 id="swap-title">Swap tokens</h2>
        </div>
        <span className="small-badge">Uniswap v4</span>
      </div>
      <div className="swap-field">
        <div className="between">
          <label htmlFor="swap-amount">You pay</label>
          <span className="muted">
            Balance:{" "}
            {display(sell ? snapshot?.balance : snapshot?.eth, inputDecimals)}
          </span>
        </div>
        <div className="amount-row">
          <input
            id="swap-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!!active || acting}
            aria-describedby="swap-error"
            aria-invalid={!!error}
          />
          <span className="token-pill">
            <span className={`coin ${sell ? "genesis" : "eth"}`}>
              {sell ? "G" : "◆"}
            </span>
            {inputSymbol}
          </span>
        </div>
        <span className="caption">
          {sell ? "GENESIS PROTOCOL" : "Sepolia Ether"}
        </span>
      </div>
      <div className="direction">
        <button
          className="icon-button"
          aria-label="Reverse swap direction"
          disabled={!!active || quoting || acting}
          onClick={() => {
            setSell((s) => !s);
            setAmount("");
          }}
        >
          <ArrowDown size={18} />
        </button>
      </div>
      <div className="swap-field receive">
        <div className="between">
          <span>You receive</span>
          <span className="muted">Estimated</span>
        </div>
        <div className="amount-row">
          <output aria-label="Estimated output">
            {quote ? display(quote.out, outputDecimals, 6) : "0.00"}
          </output>
          <span className="token-pill">
            <span className={`coin ${sell ? "eth" : "genesis"}`}>
              {sell ? "◆" : "G"}
            </span>
            {outputSymbol}
          </span>
        </div>
        <span className="caption">
          {quote && !fresh ? "Quote expired" : "USD price unavailable"}
        </span>
      </div>
      <div className="swap-settings">
        <label htmlFor="slippage">Slippage tolerance</label>
        <div>
          <input
            id="slippage"
            aria-describedby="swap-error"
            aria-invalid={!!error}
            inputMode="decimal"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            disabled={!!active || acting}
          />
          <span>%</span>
        </div>
      </div>
      {quote && (
        <div className="quote-detail">
          <div className="between">
            <span>Minimum received</span>
            <strong title={formatUnits(quote.minimum, outputDecimals)}>
              {display(quote.minimum, outputDecimals, 6)} {outputSymbol}
            </strong>
          </div>
          <div className="between">
            <span>Exchange rate</span>
            <span>
              1 {inputSymbol} ≈{" "}
              {(
                Number(formatUnits(quote.out, outputDecimals)) /
                Number(formatUnits(quote.amount, inputDecimals))
              ).toLocaleString("en-US", { maximumSignificantDigits: 6 })}{" "}
              {outputSymbol}
            </span>
          </div>
          <p>
            {fresh
              ? `Quote expires in ${Math.max(0, Math.min(30, Math.ceil((30000 - (now - quote.at)) / 1000)))}s.`
              : "Quote expired. Refresh before continuing."}{" "}
            Network fees apply.
          </p>
          {sell && (
            <p>
              {needsToken
                ? "Step 1 of 3: allow Permit2 to spend only this amount."
                : needsRouter
                  ? "Step 2 of 3: authorize the configured router for this amount, for 30 minutes."
                  : "Step 3 of 3: swap the approved amount."}
            </p>
          )}
        </div>
      )}
      <ErrorText message={error || transactionError} id="swap-error" />
      {!address || dash.chainId !== d.chainId ? (
        walletControl
      ) : !fresh ? (
        <button
          className="primary full"
          onClick={() => void getQuote()}
          disabled={!ready || !poolReady || quoting || !!active || acting}
        >
          {quoting ? (
            <Busy label="Getting quote…" />
          ) : (
            <>
              <ArrowLeftRight size={16} />
              {quote ? "Refresh quote" : "Get quote"}
            </>
          )}
        </button>
      ) : (
        <button
          className="primary full"
          disabled={!ready || !poolReady || !!active || acting}
          onClick={() => void act()}
        >
          {active === actionLabel ? <Busy label={active + "…"} /> : actionLabel}
        </button>
      )}
      {address && !ready && (
        <p className="caption">
          Transactions unlock after deployment and network checks pass.
        </p>
      )}
      {ready && !poolReady && (
        <p className="caption">
          {!nativePair
            ? "This release supports the attested native ETH pair only."
            : "Swaps are unavailable until the pool is initialized."}
        </p>
      )}
      <div className="swap-note">
        <ShieldCheck size={15} />
        <span>Review the amount, then confirm in your wallet.</span>
      </div>
    </section>
  );
}

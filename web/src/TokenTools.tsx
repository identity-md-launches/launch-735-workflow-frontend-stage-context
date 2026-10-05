import { useEffect, useState, type FormEvent } from "react";
import {
  getAddress,
  isAddress,
  zeroAddress,
  formatUnits,
  type Address,
} from "viem";
import { Send, KeyRound, ArrowUpRight } from "lucide-react";
import type { Runtime } from "./config";
import type { Dashboard } from "./useDashboard";
import { amountUnits, display, friendlyError } from "./protocol";
import { AddressLink, Busy, ErrorText } from "./components";
export function TokenTools({
  runtime,
  dash,
}: {
  runtime: Runtime;
  dash: Dashboard;
}) {
  const [mode, setMode] = useState<"transfer" | "approve" | "transferFrom">(
    "transfer",
  );
  const [recipient, setRecipient] = useState("");
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    value: bigint;
    target: Address;
    owner?: Address;
  }>();
  const [allowance, setAllowance] = useState<bigint>();
  const [checking, setChecking] = useState(false);
  const { client, token, abis, deployment: d } = runtime;
  const abi = abis[token.name];
  const decimals = dash.snapshot?.decimals ?? 18;
  const symbol = dash.snapshot?.symbol || "GENESIS";
  useEffect(() => {
    setReview(undefined);
    setError("");
    setAllowance(undefined);
  }, [mode, recipient, from, amount, dash.address, dash.chainId]);
  const checkAddress = (value: string) => {
    if (!isAddress(value.trim()) || getAddress(value.trim()) === zeroAddress)
      throw Error("Enter a valid nonzero 0x address.");
    return getAddress(value.trim());
  };
  async function readAllowance() {
    setChecking(true);
    setError("");
    try {
      if (!dash.address) throw Error("Connect a wallet first.");
      const owner = mode === "transferFrom" ? checkAddress(from) : dash.address;
      const spender =
        mode === "transferFrom" ? dash.address : checkAddress(recipient);
      const value = (await client.readContract({
        address: token.address,
        abi,
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint;
      setAllowance(value);
      return value;
    } catch (e) {
      setError(friendlyError(e));
      return undefined;
    } finally {
      setChecking(false);
    }
  }
  async function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    try {
      const target = checkAddress(recipient);
      const owner = mode === "transferFrom" ? checkAddress(from) : undefined;
      const value = amountUnits(amount, decimals, mode === "approve");
      if (mode === "approve") {
        const current = await readAllowance();
        if (current === undefined) return;
        if (current > 0n && value > 0n)
          throw Error(
            "Reset this allowance to 0 before setting a new amount. Enter 0 and review again.",
          );
      }
      if (mode === "transfer" && value > (dash.snapshot?.balance ?? 0n))
        throw Error("Your GENESIS balance is too low. Reduce the amount.");
      if (mode === "transferFrom") {
        const current = await readAllowance();
        if (current === undefined) return;
        if (current < value)
          throw Error(
            "The owner has not approved enough GENESIS for your wallet. Ask them to approve it first.",
          );
      }
      setReview({ target, owner, value });
    } catch (e) {
      setError(friendlyError(e));
      (form.querySelector("input") as HTMLInputElement)?.focus();
    }
  }
  const actionLabel =
    mode === "approve"
      ? review?.value === 0n
        ? "Revoke allowance"
        : "Set token allowance"
      : mode === "transfer"
        ? "Send GENESIS"
        : "Transfer approved GENESIS";
  const latestTx = dash.transactions[0];
  const transactionError =
    latestTx?.status === "failed" && latestTx.label === actionLabel
      ? latestTx.message ||
        "The transaction failed. Review the details and retry."
      : "";
  async function send() {
    if (!review) return;
    const label =
      mode === "approve"
        ? review.value === 0n
          ? "Revoke allowance"
          : "Set token allowance"
        : mode === "transfer"
          ? "Send GENESIS"
          : "Transfer approved GENESIS";
    const args =
      mode === "transferFrom"
        ? [review.owner, review.target, review.value]
        : [review.target, review.value];
    if (
      await dash.transact(label, {
        address: token.address,
        abi,
        functionName: mode,
        args,
      })
    ) {
      setReview(undefined);
      setAmount("");
      setAllowance(undefined);
    }
  }
  return (
    <section className="panel tools-panel" id="token-tools">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Your token, your control</span>
          <h2>Token tools</h2>
        </div>
        <Send size={20} className="muted" />
      </div>
      <div className="segmented" aria-label="Token action">
        {(["transfer", "approve", "transferFrom"] as const).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            disabled={!!dash.active}
          >
            {m === "transfer"
              ? "Send"
              : m === "approve"
                ? "Allowance"
                : "Transfer from"}
          </button>
        ))}
      </div>
      <p className="muted">
        {mode === "transfer"
          ? "Send GENESIS directly to another address."
          : mode === "approve"
            ? "Set how much GENESIS a spender can use. Enter 0 to revoke access."
            : "Transfer tokens from an owner who has approved your connected wallet."}
      </p>
      <form onSubmit={(e) => void prepare(e)}>
        {mode === "transferFrom" && (
          <label>
            Token owner
            <input
              name="owner"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              disabled={!!dash.active}
              aria-describedby="tools-error"
            />
          </label>
        )}
        <label>
          {mode === "approve" ? "Spender address" : "Recipient address"}
          <input
            name="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={!!dash.active}
            aria-describedby="tools-error"
            aria-invalid={!!error}
          />
        </label>
        <label>
          Amount ({symbol})
          <input
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={mode === "approve" ? "0 to revoke" : "0.00"}
            autoComplete="off"
            disabled={!!dash.active}
            aria-describedby="tools-error"
          />
        </label>
        {mode !== "transfer" && (
          <div className="allowance-row">
            <button
              type="button"
              className="quiet"
              disabled={!dash.ready || checking || !!dash.active}
              onClick={() => void readAllowance()}
            >
              {checking ? (
                <Busy label="Checking…" />
              ) : (
                <>
                  <KeyRound size={14} />
                  Check allowance
                </>
              )}
            </button>
            <span
              title={
                allowance !== undefined
                  ? formatUnits(allowance, decimals)
                  : undefined
              }
            >
              {display(allowance, decimals)} {symbol}
            </span>
          </div>
        )}
        <ErrorText message={error || transactionError} id="tools-error" />
        {review ? (
          <div className="review">
            <strong>
              {mode === "approve" ? "Review allowance" : "Review transfer"}
            </strong>
            <p>
              {formatUnits(review.value, decimals)} {symbol}{" "}
              {mode === "approve" ? "available to" : "to"}
            </p>
            <AddressLink
              address={review.target}
              explorer={d.network.explorer}
              full
            />
            {review.owner && (
              <p>
                From{" "}
                <AddressLink
                  address={review.owner}
                  explorer={d.network.explorer}
                />
              </p>
            )}
            <p className="caption">
              Network fees apply. Confirm only if the amount and address are
              correct.
            </p>
            <div className="button-row">
              <button
                type="button"
                disabled={!!dash.active}
                onClick={() => setReview(undefined)}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!dash.ready || !!dash.active}
                onClick={() => void send()}
              >
                {dash.active === actionLabel ? (
                  <Busy label={dash.active + "…"} />
                ) : (
                  "Confirm in wallet"
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            className="full"
            disabled={!dash.ready || !!dash.active || checking}
          >
            Review {mode === "approve" ? "allowance" : "transfer"}
            <ArrowUpRight size={16} />
          </button>
        )}
        {!dash.ready && (
          <p className="caption">
            Connect on {d.network.name} and wait for deployment verification to
            use token tools.
          </p>
        )}
      </form>
    </section>
  );
}

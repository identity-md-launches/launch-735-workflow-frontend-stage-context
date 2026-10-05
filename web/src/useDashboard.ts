import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  createWalletClient,
  custom,
  getAddress,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Abi,
  type PublicClient,
} from "viem";
import type { Runtime } from "./config";
import { walletReadFallback } from "./config";
import { friendlyError, poolId, stateAbi } from "./protocol";
export interface Snapshot {
  block: bigint;
  time: number;
  total: bigint;
  balance?: bigint;
  eth?: bigint;
  name: string;
  symbol: string;
  decimals: number;
  pool?: { sqrtPrice: bigint; liquidity: bigint; lpFee: number; tick: number };
  poolError?: string;
}
export interface Transaction {
  label: string;
  hash?: Hash;
  status: "simulating" | "signing" | "pending" | "confirmed" | "failed";
  message?: string;
}
export function useDashboard(runtime: Runtime) {
  const { address, chainId, connector } = useAccount();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [active, setActive] = useState("");
  const checkedTransport = useRef("");
  const lock = useRef(false);
  const readLock = useRef(false);
  const session = useRef("");
  session.current = `${address || ""}:${chainId || ""}`;
  const { deployment: d, client, token, abis } = runtime;
  const id = poolId(d.poolKey);
  const refresh = useCallback(async () => {
    if (readLock.current) return;
    readLock.current = true;
    setRefreshing(true);
    const started = session.current;
    try {
      let reader: PublicClient = client;
      try {
        if ((await reader.getChainId()) !== d.chainId)
          throw Error("The RPC reported the wrong network.");
      } catch (original) {
        if (!connector || chainId !== d.chainId) throw original;
        reader = walletReadFallback(
          runtime,
          (await connector.getProvider()) as EIP1193Provider,
        );
        if ((await reader.getChainId()) !== d.chainId)
          throw Error("The wallet reported the wrong network.");
      }
      if (checkedTransport.current !== reader.transport.type) {
        const addresses = [
          ...d.contracts.map((c) => c.address),
          ...Object.values(d.network.uniswapV4).filter(
            (a): a is Address => typeof a === "string",
          ),
          d.poolKey.hooks,
        ].filter((a) => a !== zeroAddress);
        const codes = await Promise.all(
          addresses.map((a) => reader.getCode({ address: a })),
        );
        if (codes.some((code) => !code || code === "0x"))
          throw Error(
            "A configured contract has no code on this network. Transactions are disabled.",
          );
        checkedTransport.current = reader.transport.type;
      }
      const block = await reader.getBlockNumber({ cacheTime: 0 });
      const args = {
        address: token.address,
        abi: abis[token.name],
        blockNumber: block,
      };
      const [total, name, symbol, decimals, balance, eth] = await Promise.all([
        reader.readContract({
          ...args,
          functionName: "totalSupply",
        }) as Promise<bigint>,
        reader.readContract({
          ...args,
          functionName: "name",
        }) as Promise<string>,
        reader.readContract({
          ...args,
          functionName: "symbol",
        }) as Promise<string>,
        reader.readContract({
          ...args,
          functionName: "decimals",
        }) as Promise<number>,
        address
          ? (reader.readContract({
              ...args,
              functionName: "balanceOf",
              args: [address],
            }) as Promise<bigint>)
          : undefined,
        address
          ? reader.getBalance({ address, blockNumber: block })
          : undefined,
      ]);
      let pool: Snapshot["pool"];
      let poolError: string | undefined;
      try {
        const [slot, liquidity] = await Promise.all([
          reader.readContract({
            address: d.network.uniswapV4.stateView,
            abi: stateAbi,
            functionName: "getSlot0",
            args: [id],
            blockNumber: block,
          }),
          reader.readContract({
            address: d.network.uniswapV4.stateView,
            abi: stateAbi,
            functionName: "getLiquidity",
            args: [id],
            blockNumber: block,
          }),
        ]);
        pool = { sqrtPrice: slot[0], tick: slot[1], lpFee: slot[3], liquidity };
      } catch (e) {
        poolError = friendlyError(e);
      }
      if (started !== session.current) return;
      setSnapshot({
        block,
        time: Date.now(),
        total,
        name,
        symbol,
        decimals,
        balance,
        eth,
        pool,
        poolError,
      });
      setError("");
      setVerified(true);
    } catch (e) {
      if (started === session.current) {
        setError(friendlyError(e));
        setVerified(false);
      }
    } finally {
      readLock.current = false;
      setRefreshing(false);
    }
  }, [address, chainId, connector, client, d, token, abis, id, runtime]);
  useEffect(() => {
    setVerified(false);
    setSnapshot(undefined);
    void refresh();
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      address ? 5000 : 15000,
    );
    return () => clearInterval(timer);
  }, [refresh, address]);
  const ready =
    !!address &&
    chainId === d.chainId &&
    verified &&
    !!snapshot &&
    Date.now() - snapshot.time < 45000;
  async function provider() {
    if (!connector || !address)
      throw Error("Connect a browser wallet to continue.");
    return (await connector.getProvider()) as EIP1193Provider;
  }
  async function assertWallet(p: EIP1193Provider) {
    const [chain, accounts] = await Promise.all([
      p.request({ method: "eth_chainId" }),
      p.request({ method: "eth_accounts" }),
    ]);
    if (Number(chain) !== d.chainId)
      throw Error(`Switch your wallet to ${d.network.name} to continue.`);
    if (
      !address ||
      !accounts[0] ||
      getAddress(accounts[0]) !== getAddress(address)
    )
      throw Error("The active wallet changed. Review the action again.");
    if ((await client.getChainId()) !== d.chainId)
      throw Error("The RPC reported the wrong network.");
  }
  async function transact(
    label: string,
    call: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    },
  ): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setActive(label);
    let transaction: Transaction = { label, status: "simulating" };
    const update = (change: Partial<Transaction>) => {
      transaction = { ...transaction, ...change };
      setTransactions((old) => [
        transaction,
        ...old.filter((t) => t !== old[0]).slice(0, 9),
      ]);
    };
    setTransactions((old) => [transaction, ...old.slice(0, 9)]);
    try {
      if (!ready || !snapshot || Date.now() - snapshot.time >= 45000)
        throw Error(
          "Wait for deployment verification and connect to the correct network.",
        );
      const p = await provider();
      await assertWallet(p);
      const code = await client.getCode({ address: call.address });
      if (!code || code === "0x")
        throw Error("The target contract has no code.");
      const { request } = await client.simulateContract({
        ...call,
        account: address!,
      });
      await assertWallet(p);
      update({ status: "signing" });
      const wallet = createWalletClient({
        chain: runtime.chain,
        transport: custom(p),
        account: address!,
      });
      const hash = await wallet.writeContract(request);
      update({ status: "pending", hash });
      let cancelled = false;
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120000,
        onReplaced: (r) => {
          cancelled = r.reason === "cancelled";
          update({ hash: r.transaction.hash });
        },
      });
      if (cancelled)
        throw Error(
          "The transaction was cancelled in your wallet. The original action was not completed.",
        );
      if (receipt.status !== "success")
        throw Error(
          "The transaction reverted. No action was completed; check its explorer receipt.",
        );
      update({ status: "confirmed" });
      await refresh();
      return true;
    } catch (e) {
      update({
        status: "failed",
        message:
          transaction.hash &&
          /timed out|timeout/i.test(String((e as Error).message))
            ? "Confirmation is unknown. Check the transaction on Etherscan before retrying."
            : friendlyError(e),
      });
      return false;
    } finally {
      lock.current = false;
      setActive("");
    }
  }
  return {
    address,
    chainId,
    connector,
    snapshot,
    error,
    refreshing,
    verified,
    ready,
    refresh,
    provider,
    assertWallet,
    transact,
    transactions,
    active,
    id,
  };
}
export type Dashboard = ReturnType<typeof useDashboard>;

import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}
export interface Deployment {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    > & { extendedSwapParams?: boolean };
  };
  walletAddChain?: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function loadDeployment() {
  const response = await fetch("./imd-deployment.json", { cache: "no-store" });
  if (!response.ok)
    throw Error(
      "Deployment configuration could not be loaded. Reload to try again.",
    );
  const deployment: Deployment = await response.json();
  if (
    deployment.version !== 1 ||
    !deployment.network ||
    deployment.chainId !== deployment.network.chainId ||
    !deployment.poolKey
  )
    throw Error(
      "The deployment configuration is incomplete. Transactions are disabled.",
    );
  const abis: Record<string, Abi> = {};
  for (const contract of deployment.contracts) {
    if (
      !/^(?:[\w-]+\/)*[\w.-]+\.json$/.test(contract.abiPath) ||
      contract.abiPath.includes("..")
    )
      throw Error("Unsafe ABI path");
    const r = await fetch("./" + contract.abiPath);
    if (!r.ok) throw Error("The contract ABI could not be loaded.");
    const abi = await r.json();
    if (
      !Array.isArray(abi) ||
      keccak256(toBytes(canonical(abi))).slice(2) !== contract.abiHash
    )
      throw Error(
        "Contract ABI verification failed. Transactions are disabled.",
      );
    abis[contract.name] = abi;
  }
  const token = deployment.contracts.find((c) => c.name === "LaunchToken");
  if (
    !token ||
    ![
      deployment.poolKey.currency0.toLowerCase(),
      deployment.poolKey.currency1.toLowerCase(),
    ].includes(token.address.toLowerCase())
  )
    throw Error("Token and pool configuration do not agree.");
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
    testnet: deployment.network.testnet,
  });
  const transport = fallback(
    deployment.network.rpcUrls.map((url) =>
      http(url, { timeout: 8000, retryCount: 0 }),
    ),
    { retryCount: 1 },
  );
  const client = createPublicClient({
    chain,
    transport,
    batch: { multicall: false },
  });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport },
  });
  return { deployment, abis, token, chain, client, wagmi };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
export async function switchNetwork(provider: EIP1193Provider, d: Deployment) {
  const params = [{ chainId: `0x${d.chainId.toString(16)}` }];
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params,
    } as never);
  } catch (error) {
    const e = error as { code?: number; message?: string };
    if (
      e.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(e.message || "")
    )
      throw error;
    if (!d.walletAddChain)
      throw Error(
        "Chain setup is unavailable. Add the network to your wallet and try again.",
      );
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [d.walletAddChain],
    } as never);
    await provider.request({
      method: "wallet_switchEthereumChain",
      params,
    } as never);
  }
}
export function walletReadFallback(
  runtime: Runtime,
  provider: EIP1193Provider,
) {
  return createPublicClient({
    chain: runtime.chain,
    transport: custom(provider),
  });
}

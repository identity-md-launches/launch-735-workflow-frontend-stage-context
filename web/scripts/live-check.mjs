// Read-only evidence. Uses only the public endpoints in the runtime manifest.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  parseAbi,
  formatUnits,
} from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const d = JSON.parse(
  await readFile(resolve(root, "dist/imd-deployment.json"), "utf8"),
);
const abi = JSON.parse(
  await readFile(resolve(root, "dist", d.contracts[0].abiPath), "utf8"),
);
const evidence = {
  checkedAt: new Date().toISOString(),
  chainId: d.chainId,
  readsOnly: true,
  endpointResults: [],
};
let reader;
for (const endpoint of d.network.rpcUrls) {
  const candidate = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          const request = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params: params || [],
          });
          const raw = execFileSync(
            "curl",
            [
              "--silent",
              "--show-error",
              "--max-time",
              "15",
              "--retry",
              "1",
              "-H",
              "content-type: application/json",
              "--data-binary",
              "@-",
              endpoint,
            ],
            { input: request, encoding: "utf8", maxBuffer: 1024 * 1024 },
          );
          const data = JSON.parse(raw);
          if (data.error) throw Error(data.error.message);
          return data.result;
        },
      },
      { retryCount: 0 },
    ),
  });
  try {
    const chainId = await candidate.getChainId();
    evidence.endpointResults.push({ endpoint, chainId });
    if (chainId === d.chainId) {
      reader = candidate;
      break;
    }
  } catch (e) {
    evidence.endpointResults.push({ endpoint, error: e.message.slice(0, 250) });
  }
}
if (reader)
  try {
    const blockNumber = BigInt(
      process.argv[2] || (await reader.getBlockNumber()),
    );
    evidence.blockNumber = blockNumber.toString();
    const entries = [
      ...d.contracts.map((c) => [c.name, c.address]),
      ...Object.entries(d.network.uniswapV4),
      ["poolGuard", d.poolKey.hooks],
    ].filter(([, a]) => typeof a === "string");
    evidence.code = [];
    for (const [name, address] of entries) {
      const code = await reader.getCode({ address, blockNumber });
      evidence.code.push({
        name,
        address,
        bytes: code ? (code.length - 2) / 2 : 0,
        keccak256: code && code !== "0x" ? keccak256(code) : null,
      });
    }
    const read = async (name) =>
      await reader.readContract({
        address: d.contracts[0].address,
        abi,
        functionName: name,
        blockNumber,
      });
    evidence.token = {
      name: await read("name"),
      symbol: await read("symbol"),
      decimals: await read("decimals"),
      totalSupply: formatUnits(await read("totalSupply"), 18),
    };
    const poolType =
      "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
    const poolId = keccak256(
      encodeAbiParameters(parseAbiParameters(poolType), [d.poolKey]),
    );
    const stateAbi = parseAbi([
      "function getSlot0(bytes32 poolId) view returns(uint160,int24,uint24,uint24)",
      "function getLiquidity(bytes32 poolId) view returns(uint128)",
    ]);
    const slot = await reader.readContract({
      address: d.network.uniswapV4.stateView,
      abi: stateAbi,
      functionName: "getSlot0",
      args: [poolId],
      blockNumber,
    });
    const liquidity = await reader.readContract({
      address: d.network.uniswapV4.stateView,
      abi: stateAbi,
      functionName: "getLiquidity",
      args: [poolId],
      blockNumber,
    });
    evidence.pool = { poolId, slot0: slot, liquidity };
    try {
      const quoter = parseAbi([
        `function quoteExactInputSingle((${poolType} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)`,
      ]);
      const quote = await reader.simulateContract({
        address: d.network.uniswapV4.quoter,
        abi: quoter,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: d.poolKey,
            zeroForOne: true,
            exactAmount: 1000000000000000n,
            hookData: "0x",
          },
        ],
        blockNumber,
      });
      evidence.quote = {
        amountIn: "1000000000000000",
        amountOut: quote.result[0],
        gasEstimate: quote.result[1],
      };
    } catch (e) {
      evidence.quote = { error: e.shortMessage || e.message };
    }
  } catch (e) {
    evidence.error = e.shortMessage || e.message;
  }
else evidence.error = "No configured public RPC was reachable.";
await writeFile(
  resolve(root, "docs/evidence/live-read.json"),
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);

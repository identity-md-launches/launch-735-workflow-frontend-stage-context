import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  formatUnits,
  zeroAddress,
  type Address,
} from "viem";
import type { PoolKey, Deployment } from "./config";
export const poolType =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
export const quoterAbi = parseAbi([
  `function quoteExactInputSingle((${poolType} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex,bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)",
]);
export const permitAbi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export function poolId(key: PoolKey) {
  return keccak256(encodeAbiParameters(parseAbiParameters(poolType), [key]));
}
export function amountUnits(text: string, decimals: number, allowZero = false) {
  if (
    !/^(?:\d+)(?:\.\d*)?$/.test(text) ||
    (text.split(".")[1]?.length || 0) > decimals
  )
    throw Error(
      `Enter a valid amount with at most ${decimals} decimal places.`,
    );
  const value = parseUnits(text, decimals);
  if (value < 0n || (!allowZero && value === 0n) || value > 2n ** 128n - 1n)
    throw Error("Enter an amount above zero within the supported range.");
  return value;
}
export function slippageBps(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw Error("Use slippage from 0.1% to 5%, with up to two decimal places.");
  const bps = Math.round(Number(text) * 100);
  if (bps < 10 || bps > 500) throw Error("Use slippage from 0.1% to 5%.");
  return bps;
}
export function minimumOut(quote: bigint, bps: number) {
  return (quote * BigInt(10000 - bps)) / 10000n;
}
export function swapPayload(
  d: Deployment,
  input: Address,
  amountIn: bigint,
  minOut: bigint,
  now = Math.floor(Date.now() / 1000),
) {
  const key = d.poolKey,
    zeroForOne = input.toLowerCase() === key.currency0.toLowerCase();
  if (
    ![key.currency0.toLowerCase(), key.currency1.toLowerCase()].includes(
      input.toLowerCase(),
    )
  )
    throw Error("Input is not a pool currency");
  const output = zeroForOne ? key.currency1 : key.currency0;
  const tuple = d.network.uniswapV4.extendedSwapParams
    ? `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`
    : `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;
  const params = [
    encodeAbiParameters(parseAbiParameters(tuple), [
      {
        poolKey: key,
        zeroForOne,
        amountIn,
        amountOutMinimum: minOut,
        ...(d.network.uniswapV4.extendedSwapParams
          ? { minHopPriceX36: 0n }
          : {}),
        hookData: "0x",
      },
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      input,
      amountIn,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      output,
      minOut,
    ]),
  ];
  return {
    commands: "0x10" as const,
    inputs: [
      encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
        "0x060c0f",
        params,
      ]),
    ],
    deadline: BigInt(now + 1200),
    value: input === zeroAddress ? amountIn : 0n,
  };
}
export function display(value: bigint | undefined, decimals = 18, max = 4) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  if (n > 0 && n < 10 ** -max) return "< " + (10 ** -max).toFixed(max);
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}
export function friendlyError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  const msg = e.shortMessage || e.message || "The request failed.";
  if (e.code === 4001 || /reject|denied/i.test(msg))
    return "Request declined in your wallet. You can try again when ready.";
  if (/InsufficientAllowance/i.test(msg))
    return "The token allowance is too low. Check the owner and approve the required amount.";
  if (/InsufficientBalance|insufficient funds/i.test(msg))
    return "Your balance is too low. Check your token balance and keep ETH for network fees.";
  if (/InvalidReceiver|InvalidSpender/i.test(msg))
    return "Use a valid, nonzero recipient or spender address.";
  if (/ExecutionFailed|V4TooLittleReceived/i.test(msg))
    return "The swap simulation failed. Refresh the quote and check pool liquidity and slippage.";
  if (/fetch|HTTP|timeout|network request/i.test(msg))
    return "The network could not be reached. Check your connection and retry.";
  return msg.slice(0, 300);
}

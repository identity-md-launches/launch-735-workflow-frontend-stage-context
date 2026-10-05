import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import {
  amountUnits,
  minimumOut,
  slippageBps,
  swapPayload,
  poolType,
  poolId,
  friendlyError,
} from "../src/protocol.ts";
import { canonical, switchNetwork, type Deployment } from "../src/config.ts";
const d = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
) as Deployment;
test("canonical pinned ABI matches the attested Keccak hash", () => {
  const abi = JSON.parse(
    readFileSync(
      new URL("../../docs/abi/LaunchToken.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    keccak256(toBytes(canonical(abi))).slice(2),
    d.contracts[0].abiHash,
  );
  assert.equal(
    canonical({ z: { b: 2, a: 1 }, a: [{ y: 0, x: 1 }] }),
    '{"a":[{"x":1,"y":0}],"z":{"a":1,"b":2}}',
  );
});
test("strict decimal input never rounds excess precision or accepts scientific notation", () => {
  for (const value of [
    "-1",
    "1e3",
    "1.0000001",
    "Infinity",
    "NaN",
    "",
    "0.0",
    " 2",
    "0x01",
  ])
    assert.throws(() => amountUnits(value, 6));
  assert.equal(amountUnits("1.234567", 6), 1234567n);
  assert.equal(amountUnits("0", 18, true), 0n);
  assert.equal(amountUnits("0.000000000000000001", 18), 1n);
});
test("slippage limits and integer rounding protect the minimum output", () => {
  assert.equal(slippageBps("0.5"), 50);
  for (const x of ["0", "5.01", "1e0", "-1", "0.111"])
    assert.throws(() => slippageBps(x));
  assert.equal(minimumOut(10001n, 50), 9950n);
});
test("native buy encodes the attested hook, fee, settlement and minimum", () => {
  const payload = swapPayload(d, zeroAddress, 10n, 9n, 1000);
  assert.equal(payload.commands, "0x10");
  assert.equal(payload.value, 10n);
  assert.equal(payload.deadline, 2200n);
  const [actions, params] = decodeAbiParameters(
    parseAbiParameters("bytes,bytes[]"),
    payload.inputs[0],
  );
  assert.equal(actions, "0x060c0f");
  const [swap] = decodeAbiParameters(
    parseAbiParameters(
      `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
    ),
    params[0],
  );
  assert.equal(swap.poolKey.hooks.toLowerCase(), d.poolKey.hooks);
  assert.equal(swap.poolKey.fee, 12500);
  assert.equal(swap.zeroForOne, true);
  assert.equal(swap.amountOutMinimum, 9n);
  assert.equal(swap.hookData, "0x");
  assert.deepEqual(
    decodeAbiParameters(parseAbiParameters("address,uint256"), params[1]),
    [zeroAddress, 10n],
  );
  assert.equal(
    decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    )[0].toLowerCase(),
    d.poolKey.currency1,
  );
});
test("selling sends no native value and reverses direction", () => {
  const payload = swapPayload(d, d.contracts[0].address, 15n, 12n);
  assert.equal(payload.value, 0n);
  const [, params] = decodeAbiParameters(
    parseAbiParameters("bytes,bytes[]"),
    payload.inputs[0],
  );
  const [swap] = decodeAbiParameters(
    parseAbiParameters(
      `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
    ),
    params[0],
  );
  assert.equal(swap.zeroForOne, false);
  assert.deepEqual(
    decodeAbiParameters(parseAbiParameters("address,uint256"), params[2]),
    [zeroAddress, 12n],
  );
});
test("extended router layout includes the extra zero uint256 and supports either token order", () => {
  const d2 = structuredClone(d);
  d2.network.uniswapV4.extendedSwapParams = true;
  const payload = swapPayload(d2, d2.poolKey.currency1, 10n, 8n);
  const [, params] = decodeAbiParameters(
    parseAbiParameters("bytes,bytes[]"),
    payload.inputs[0],
  );
  const [swap] = decodeAbiParameters(
    parseAbiParameters(
      `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`,
    ),
    params[0],
  );
  assert.equal(swap.minHopPriceX36, 0n);
  assert.equal(swap.hookData, "0x");
  const erc20 = "0x1111111111111111111111111111111111111111" as Address;
  d2.poolKey.currency0 = d.contracts[0].address;
  d2.poolKey.currency1 = erc20;
  assert.equal(swapPayload(d2, erc20, 10n, 9n).value, 0n);
  assert.throws(() => swapPayload(d2, zeroAddress, 1n, 1n));
  assert.match(poolId(d.poolKey), /^0x[0-9a-f]{64}$/);
});
test("unknown-chain recovery offers exactly the supplied wallet_addEthereumChain config", async () => {
  const calls: unknown[] = [];
  let switches = 0;
  const provider = {
    request: async (req: any) => {
      calls.push(req);
      if (req.method === "wallet_switchEthereumChain" && ++switches === 1)
        throw { code: 4902 };
    },
  };
  await switchNetwork(provider as any, d);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], {
    method: "wallet_addEthereumChain",
    params: [d.walletAddChain],
  });
});
test("a rejected switch is surfaced without adding a chain", async () => {
  let calls = 0;
  await assert.rejects(
    switchNetwork(
      {
        request: async () => {
          calls++;
          throw { code: 4001 };
        },
      } as any,
      d,
    ),
  );
  assert.equal(calls, 1);
  assert.match(friendlyError({ code: 4001 }), /declined/);
});

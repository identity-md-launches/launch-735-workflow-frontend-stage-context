import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const deployment = JSON.parse(
  await readFile(resolve(root, "dist/imd-deployment.json"), "utf8"),
);
const tokenAbi = JSON.parse(
  await readFile(
    resolve(root, "dist", deployment.contracts[0].abiPath),
    "utf8",
  ),
);
const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const permitAbi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256,uint256)",
]);
const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const account = "0x1234567890123456789012345678901234567890";
const recipient = "0x9876543210987654321098765432109876543210";
const txHash = "0x" + "a".repeat(64);
const blockHash = "0x" + "b".repeat(64);
const state = {
  erc20Allowance: 0n,
  routerAllowance: 0n,
  expiration: 0,
  sendCalls: [],
  quoteCalls: [],
  rpcCalls: [],
  receipt: null,
  rejectNext: false,
  revertQuote: false,
  revertExecute: false,
  missingCode: false,
  wrongRpc: false,
  liquidity: 0n,
};
function result(abi, name, value) {
  return encodeFunctionResult({ abi, functionName: name, result: value });
}
function rpc(method, params = []) {
  state.rpcCalls.push(method);
  if (method === "eth_chainId")
    return state.wrongRpc ? "0x1" : toHex(deployment.chainId);
  if (method === "eth_blockNumber") return "0xc00000";
  if (method === "eth_getCode") return state.missingCode ? "0x" : "0x60016000";
  if (method === "eth_getBalance") return toHex(10n * 10n ** 18n);
  if (method === "eth_getTransactionReceipt") return state.receipt;
  if (method === "eth_getBlockByNumber")
    return {
      number: "0xc00000",
      hash: blockHash,
      parentHash: blockHash,
      timestamp: toHex(Math.floor(Date.now() / 1000)),
      transactions: [],
      gasLimit: "0x1c9c380",
      gasUsed: "0x5208",
      baseFeePerGas: "0x3b9aca00",
      difficulty: "0x0",
      extraData: "0x",
      logsBloom: "0x" + "0".repeat(512),
      miner: zeroAddress,
      mixHash: blockHash,
      nonce: "0x0000000000000000",
      receiptsRoot: blockHash,
      sha3Uncles: blockHash,
      stateRoot: blockHash,
      transactionsRoot: blockHash,
      size: "0x100",
      uncles: [],
    };
  if (method === "eth_getTransactionByHash")
    return {
      hash: txHash,
      blockHash,
      blockNumber: "0xc00000",
      transactionIndex: "0x0",
      from: account,
      to: deployment.network.uniswapV4.universalRouter,
      nonce: "0x0",
      input: "0x",
      value: "0x0",
      gas: "0x5208",
      gasPrice: "0x1",
      v: "0x1",
      r: "0x1",
      s: "0x1",
      type: "0x0",
    };
  if (method === "eth_call") {
    const call = params[0],
      to = call.to.toLowerCase();
    let abi;
    if (to === deployment.contracts[0].address) abi = tokenAbi;
    else if (to === deployment.network.uniswapV4.stateView) abi = stateAbi;
    else if (to === deployment.network.uniswapV4.permit2) abi = permitAbi;
    else if (to === deployment.network.uniswapV4.quoter) abi = quoterAbi;
    else if (to === deployment.network.uniswapV4.universalRouter)
      abi = routerAbi;
    else throw Error("Unexpected call target " + to);
    const { functionName: name, args } = decodeFunctionData({
      abi,
      data: call.data,
    });
    if (name === "totalSupply")
      return result(abi, name, 1000000000n * 10n ** 18n);
    if (name === "name") return result(abi, name, "GENESIS PROTOCOL");
    if (name === "symbol") return result(abi, name, "GENESIS");
    if (name === "decimals") return result(abi, name, 18);
    if (name === "balanceOf") return result(abi, name, 12500n * 10n ** 18n);
    if (name === "getSlot0")
      return result(abi, name, [2n ** 106n, 180000, 0, 12500]);
    if (name === "getLiquidity") return result(abi, name, state.liquidity);
    if (name === "allowance")
      return result(
        abi,
        name,
        abi === permitAbi
          ? [state.routerAllowance, state.expiration, 0]
          : state.erc20Allowance,
      );
    if (name === "quoteExactInputSingle") {
      if (state.revertQuote)
        throw Error("Pool quote simulation reverted. Try a smaller amount.");
      state.quoteCalls.push({ call, args });
      return result(abi, name, [
        args[0].zeroForOne
          ? args[0].exactAmount * 100000n
          : args[0].exactAmount / 100000n,
        100000n,
      ]);
    }
    if (name === "execute") {
      if (state.revertExecute)
        throw Error("Swap simulation reverted. Refresh the quote.");
      return "0x";
    }
    if (["approve", "transfer", "transferFrom"].includes(name))
      return abi === tokenAbi ? result(abi, name, true) : "0x";
    throw Error("Unexpected method " + name);
  }
  throw Error("Unexpected RPC " + method);
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/preview/")) throw Error();
    const path = resolve(
      root,
      "dist",
      decodeURIComponent(url.pathname.slice(9) || "index.html"),
    );
    if (!path.startsWith(resolve(root, "dist") + "/")) throw Error();
    res.setHeader(
      "content-type",
      mime[extname(path)] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    "/opt/imd-tools/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell",
  headless: true,
  args: ["--no-sandbox"],
});
await mkdir(resolve(root, "docs/evidence"), { recursive: true });
const checks = [];
const errors = [];
const resources = [];
async function record(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
async function makePage(wallet = true) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400)
      resources.push(`${r.status()} ${r.url()}`);
  });
  await page.route(/^https:\/\//, async (route) => {
    if (
      !deployment.network.rpcUrls.some((u) =>
        route.request().url().startsWith(u),
      )
    )
      return route.abort();
    const body = route.request().postDataJSON();
    const handle = (payload) => {
      try {
        return {
          jsonrpc: "2.0",
          id: payload.id,
          result: rpc(payload.method, payload.params),
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: 3, message: e.message },
        };
      }
    };
    await route.fulfill({
      json: Array.isArray(body) ? body.map(handle) : handle(body),
    });
  });
  if (wallet) {
    await page.exposeFunction("__mockSend", async (tx) => {
      state.sendCalls.push(tx);
      if (state.rejectNext) {
        state.rejectNext = false;
        return { error: "User rejected the request." };
      }
      const to = tx.to.toLowerCase();
      const abi =
        to === deployment.contracts[0].address
          ? tokenAbi
          : to === deployment.network.uniswapV4.permit2
            ? permitAbi
            : routerAbi;
      const { functionName, args } = decodeFunctionData({ abi, data: tx.data });
      if (functionName === "approve" && abi === tokenAbi)
        state.erc20Allowance = args[1];
      if (functionName === "approve" && abi === permitAbi) {
        state.routerAllowance = args[2];
        state.expiration = args[3];
      }
      state.receipt = {
        transactionHash: txHash,
        transactionIndex: "0x0",
        blockHash,
        blockNumber: "0xc00000",
        from: account,
        to: tx.to,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "0".repeat(512),
        status: "0x1",
        effectiveGasPrice: "0x1",
        type: "0x2",
      };
      return { hash: txHash };
    });
    await page.addInitScript(
      ({ account, chainId }) => {
        const events = {};
        const mock = {
          chain: "0x1",
          connected: false,
          added: false,
          calls: [],
          hold: false,
        };
        window.__wallet = mock;
        window.ethereum = {
          isMetaMask: true,
          on: (n, f) => {
            (events[n] ??= []).push(f);
          },
          removeListener: (n, f) => {
            events[n] = (events[n] || []).filter((x) => x !== f);
          },
          request: async ({ method, params }) => {
            mock.calls.push({ method, params });
            if (method === "eth_chainId") return mock.chain;
            if (method === "eth_accounts")
              return mock.connected ? [account] : [];
            if (method === "eth_requestAccounts") {
              mock.connected = true;
              return [account];
            }
            if (method === "wallet_requestPermissions")
              return [{ parentCapability: "eth_accounts" }];
            if (method === "wallet_revokePermissions") return null;
            if (method === "wallet_switchEthereumChain") {
              if (!mock.added)
                throw Object.assign(Error("Unknown chain"), { code: 4902 });
              mock.chain = params[0].chainId;
              (events.chainChanged || []).forEach((f) => f(mock.chain));
              return null;
            }
            if (method === "wallet_addEthereumChain") {
              mock.added = true;
              return null;
            }
            if (method === "eth_sendTransaction") {
              while (mock.hold) await new Promise((r) => setTimeout(r, 20));
              const response = await window.__mockSend(params[0]);
              if (response.error)
                throw Object.assign(Error(response.error), { code: 4001 });
              return response.hash;
            }
            if (method === "wallet_getCapabilities") return {};
            if (method === "eth_estimateGas") return "0x50000";
            if (method === "eth_gasPrice") return "0x3b9aca00";
            throw Error("Unsupported wallet method: " + method);
          },
        };
        window.__changeAccount = () => {
          mock.connected = false;
          (events.accountsChanged || []).forEach((f) => f([]));
        };
      },
      { account, chainId: deployment.chainId },
    );
  }
  await page.goto(base);
  await page.getByRole("heading", { name: "Genesis, at a glance." }).waitFor();
  return page;
}
const page = await makePage();
const trade = page.locator("#trade");
const tools = page.locator("#token-tools");
try {
  await record(
    "Relative subpath export loads ABI/configuration and public metrics without a wallet",
    async () => {
      await page.getByText("1,000,000,000", { exact: false }).first().waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(state.sendCalls.length, 0);
      await page.screenshot({
        path: resolve(root, "docs/evidence/desktop-disconnected.png"),
        fullPage: true,
      });
    },
  );
  await record("Keyboard skip link is the first focus target", async () => {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Skip to content",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  });
  await record(
    "Wrong-chain gate and 4902 add-chain then switch use the supplied network",
    async () => {
      await trade
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await trade
        .getByRole("button", { name: "Switch to Sepolia", exact: true })
        .waitFor();
      assert.equal(
        await tools
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
      await trade
        .getByRole("button", { name: "Switch to Sepolia", exact: true })
        .click();
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
      await page.getByText("12,500", { exact: false }).first().waitFor();
      const calls = await page.evaluate(() => window.__wallet.calls);
      assert.deepEqual(
        calls.find((c) => c.method === "wallet_addEthereumChain").params,
        [deployment.walletAddChain],
      );
      assert.equal(
        calls.filter((c) => c.method === "wallet_switchEthereumChain").length,
        2,
      );
    },
  );
  await record(
    "Input validation rejects invalid amounts and excessive slippage",
    async () => {
      await page.getByLabel("You pay", { exact: true }).fill("1e3");
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await trade.getByText(/Enter a valid amount/).waitFor();
      await page.getByLabel("You pay", { exact: true }).fill("0.01");
      await page.getByLabel("Slippage tolerance").fill("6");
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await trade.getByText("Use slippage from 0.1% to 5%.").waitFor();
      await page.getByLabel("Slippage tolerance").fill("0.5");
    },
  );
  await record(
    "Native quote is simulated at configured quoter with attested key",
    async () => {
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await trade
        .getByRole("button", { name: "Swap ETH for GENESIS", exact: true })
        .waitFor();
      const call = state.quoteCalls.at(-1);
      assert.equal(
        call.call.to.toLowerCase(),
        deployment.network.uniswapV4.quoter,
      );
      assert.equal(call.args[0].poolKey.fee, deployment.poolKey.fee);
      assert.equal(
        call.args[0].poolKey.hooks.toLowerCase(),
        deployment.poolKey.hooks,
      );
      assert.equal(call.args[0].exactAmount, 10n ** 16n);
    },
  );
  await record(
    "Pending wallet request disables duplicate actions; rejection is recoverable",
    async () => {
      state.rejectNext = true;
      await page.evaluate(() => (window.__wallet.hold = true));
      await trade
        .getByRole("button", { name: "Swap ETH for GENESIS", exact: true })
        .click();
      await page
        .getByText("Swap ETH for GENESIS: signing", { exact: true })
        .waitFor();
      assert.equal(await trade.locator("button.primary").isDisabled(), true);
      assert.equal(
        await tools
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
      await page.evaluate(() => (window.__wallet.hold = false));
      await trade
        .getByText(
          "Request declined in your wallet. You can try again when ready.",
        )
        .waitFor();
      assert.equal(
        await trade
          .getByRole("button", { name: "Swap ETH for GENESIS", exact: true })
          .isEnabled(),
        true,
      );
    },
  );
  await record(
    "Native buy uses configured router, correct value, simulation, and confirmed receipt",
    async () => {
      await trade
        .getByRole("button", { name: "Swap ETH for GENESIS", exact: true })
        .click();
      await page
        .getByText("Swap ETH for GENESIS: confirmed", { exact: true })
        .waitFor();
      const tx = state.sendCalls.at(-1);
      assert.equal(
        tx.to.toLowerCase(),
        deployment.network.uniswapV4.universalRouter,
      );
      assert.equal(BigInt(tx.value), 10n ** 16n);
      const call = decodeFunctionData({ abi: routerAbi, data: tx.data });
      assert.equal(call.args[0], "0x10");
      assert.equal(
        await page.getByLabel("You pay", { exact: true }).inputValue(),
        "",
      );
    },
  );
  await record(
    "Sell flow separates ERC20 approval, Permit2 authorization, and swap",
    async () => {
      await page
        .getByRole("button", { name: "Reverse swap direction" })
        .click();
      await page.getByLabel("You pay", { exact: true }).fill("10");
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await trade
        .getByRole("button", {
          name: "Approve GENESIS to Permit2",
          exact: true,
        })
        .click();
      await trade
        .getByRole("button", { name: "Authorize router", exact: true })
        .waitFor();
      const approval = decodeFunctionData({
        abi: tokenAbi,
        data: state.sendCalls.at(-1).data,
      });
      assert.equal(
        approval.args[0].toLowerCase(),
        deployment.network.uniswapV4.permit2,
      );
      assert.equal(approval.args[1], 10n * 10n ** 18n);
      await trade
        .getByRole("button", { name: "Authorize router", exact: true })
        .click();
      await trade
        .getByRole("button", { name: "Swap GENESIS for ETH", exact: true })
        .waitFor();
      const permit = decodeFunctionData({
        abi: permitAbi,
        data: state.sendCalls.at(-1).data,
      });
      assert.equal(
        permit.args[0].toLowerCase(),
        deployment.contracts[0].address,
      );
      assert.equal(
        permit.args[1].toLowerCase(),
        deployment.network.uniswapV4.universalRouter,
      );
      assert.equal(permit.args[2], 10n * 10n ** 18n);
      await trade
        .getByRole("button", { name: "Swap GENESIS for ETH", exact: true })
        .click();
      await page
        .getByText("Swap GENESIS for ETH: confirmed", { exact: true })
        .waitFor();
      assert.equal(BigInt(state.sendCalls.at(-1).value || "0x0"), 0n);
    },
  );
  await record("Simulation failure never asks the wallet to send", async () => {
    await page.getByLabel("You pay", { exact: true }).fill("1");
    await trade.getByRole("button", { name: "Get quote", exact: true }).click();
    await trade
      .getByRole("button", { name: "Swap GENESIS for ETH", exact: true })
      .waitFor();
    state.revertExecute = true;
    const before = state.sendCalls.length;
    await trade
      .getByRole("button", { name: "Swap GENESIS for ETH", exact: true })
      .click();
    await page
      .getByText("Swap GENESIS for ETH: failed", { exact: true })
      .waitFor();
    assert.equal(state.sendCalls.length, before);
    state.revertExecute = false;
  });
  await record(
    "Expired quotes require refresh, and changing inputs clears the quote",
    async () => {
      await page.clock.install();
      await page.clock.fastForward(31000);
      await trade
        .getByRole("button", { name: "Refresh quote", exact: true })
        .waitFor();
      assert.equal(
        await trade
          .getByRole("button", { name: "Swap GENESIS for ETH", exact: true })
          .count(),
        0,
      );
      await page.getByLabel("You pay", { exact: true }).fill("2");
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
      await page.clock.resume();
    },
  );
  await record(
    "Quote reverts produce an inline error without broadcasting",
    async () => {
      state.revertQuote = true;
      await trade
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await trade
        .locator("#swap-error")
        .getByText(/reverted/)
        .waitFor();
      state.revertQuote = false;
    },
  );
  await record(
    "Transfer validates addresses, reviews full values, then confirms on chain",
    async () => {
      await tools.getByLabel("Recipient address").fill("0x0");
      await tools.getByLabel("Amount (GENESIS)").fill("25");
      await tools
        .getByRole("button", { name: "Review transfer", exact: true })
        .click();
      await tools.getByText("Enter a valid nonzero 0x address.").waitFor();
      await tools.getByLabel("Recipient address").fill(recipient);
      await tools
        .getByRole("button", { name: "Review transfer", exact: true })
        .click();
      await tools.getByRole("button", { name: "Confirm in wallet" }).click();
      await page
        .getByText("Send GENESIS: confirmed", { exact: true })
        .waitFor();
      const tx = decodeFunctionData({
        abi: tokenAbi,
        data: state.sendCalls.at(-1).data,
      });
      assert.equal(tx.functionName, "transfer");
      assert.equal(tx.args[0].toLowerCase(), recipient);
      assert.equal(tx.args[1], 25n * 10n ** 18n);
    },
  );
  await record(
    "Allowance tool enforces zero reset and can revoke",
    async () => {
      await tools
        .getByRole("button", { name: "Allowance", exact: true })
        .click();
      await tools.getByLabel("Spender address").fill(recipient);
      await tools.getByLabel("Amount (GENESIS)").fill("5");
      await tools
        .getByRole("button", { name: "Review allowance", exact: true })
        .click();
      await tools.getByText(/Reset this allowance to 0/).waitFor();
      await tools.getByLabel("Amount (GENESIS)").fill("0");
      await tools
        .getByRole("button", { name: "Review allowance", exact: true })
        .click();
      await tools.getByRole("button", { name: "Confirm in wallet" }).click();
      await page
        .getByText("Revoke allowance: confirmed", { exact: true })
        .waitFor();
      assert.equal(state.erc20Allowance, 0n);
    },
  );
  await record(
    "transferFrom checks owner allowance and uses the owner and recipient in calldata",
    async () => {
      await tools
        .getByRole("button", { name: "Transfer from", exact: true })
        .click();
      await tools.getByLabel("Token owner").fill(account);
      await tools.getByLabel("Recipient address").fill(recipient);
      await tools.getByLabel("Amount (GENESIS)").fill("3");
      await tools
        .getByRole("button", { name: "Review transfer", exact: true })
        .click();
      await tools.getByText(/owner has not approved enough/).waitFor();
      state.erc20Allowance = 100n * 10n ** 18n;
      await tools
        .getByRole("button", { name: "Review transfer", exact: true })
        .click();
      await tools.getByRole("button", { name: "Confirm in wallet" }).click();
      await page
        .getByText("Transfer approved GENESIS: confirmed", { exact: true })
        .waitFor();
      const call = decodeFunctionData({
        abi: tokenAbi,
        data: state.sendCalls.at(-1).data,
      });
      assert.equal(call.functionName, "transferFrom");
      assert.equal(call.args[0].toLowerCase(), account);
      assert.equal(call.args[1].toLowerCase(), recipient);
    },
  );
  await record(
    "Account disconnect clears balances and all transaction prerequisites",
    async () => {
      await page.evaluate(() => window.__changeAccount());
      await trade
        .getByRole("button", { name: "Connect wallet", exact: true })
        .waitFor();
      assert.equal(
        await tools
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
    },
  );
  await record(
    "Desktop and mobile reflow, accessible names, contrast, and reduced motion",
    async () => {
      // Clean page for final production screenshots; network reads are explicitly mocked.
      await page.reload();
      await page.getByText("1,000,000,000", { exact: false }).first().waitFor();
      for (const width of [1440, 960, 740, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `horizontal overflow at ${width}`,
        );
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        await writeFile(
          resolve(root, `docs/evidence/axe-${width}.json`),
          JSON.stringify(
            {
              width,
              violations: scan.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                description: v.description,
                nodes: v.nodes.map((n) => ({
                  target: n.target,
                  summary: n.failureSummary,
                })),
              })),
              passes: scan.passes.length,
            },
            null,
            2,
          ),
        );
        assert.equal(
          scan.violations.length,
          0,
          JSON.stringify(
            scan.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
          ),
        );
        if ([1440, 390, 320].includes(width))
          await page.screenshot({
            path: resolve(root, `docs/evidence/dashboard-${width}.png`),
            fullPage: true,
          });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).scrollBehavior,
        ),
        "auto",
      );
    },
  );
  await record(
    "Keyboard-only connection, network recovery and quote flow",
    async () => {
      const keyboardPage = await makePage();
      async function tabTo(selector) {
        for (let i = 0; i < 100; i++) {
          await keyboardPage.keyboard.press("Tab");
          if (
            await keyboardPage.evaluate(
              (s) => document.activeElement.matches(s),
              selector,
            )
          )
            return;
        }
        throw Error("Keyboard could not reach " + selector);
      }
      await tabTo("#trade button.primary");
      await keyboardPage.keyboard.press("Enter");
      await keyboardPage
        .locator("#trade")
        .getByRole("button", { name: "Switch to Sepolia", exact: true })
        .waitFor();
      await keyboardPage.keyboard.press("Enter");
      await keyboardPage
        .locator("#trade")
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
      await keyboardPage
        .getByText("12,500", { exact: false })
        .first()
        .waitFor();
      await tabTo("#swap-amount");
      await keyboardPage.keyboard.type("0.01");
      await tabTo("#trade button.primary");
      await keyboardPage.keyboard.press("Enter");
      await keyboardPage
        .locator("#trade")
        .getByRole("button", { name: "Swap ETH for GENESIS", exact: true })
        .waitFor();
      await tabTo("#trade button.primary");
      await keyboardPage.screenshot({
        path: resolve(root, "docs/evidence/keyboard-quote.png"),
        fullPage: false,
      });
      await keyboardPage.close();
    },
  );
  await record(
    "Configured RPC reporting another chain cannot enable transactions",
    async () => {
      state.wrongRpc = true;
      const wrongPage = await makePage(false);
      await wrongPage
        .getByText("The RPC reported the wrong network.")
        .waitFor();
      assert.equal(
        await wrongPage
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
      await wrongPage.close();
      state.wrongRpc = false;
    },
  );
  await record(
    "Measured contrast for the rendered solid surfaces",
    async () => {
      const pairs = await page.evaluate(() => {
        const linear = (x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (c) => {
          const a = c
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map(linear);
          return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
        };
        return [
          ".page-heading h1",
          ".metric p",
          ".swap-field label",
          "#trade button.primary",
          ".nav-item.current",
          ".feature-content p",
        ].map((selector) => {
          const el = document.querySelector(selector);
          let p = el;
          let background;
          while (p) {
            background = getComputedStyle(p).backgroundColor;
            if (!["rgba(0, 0, 0, 0)", "transparent"].includes(background))
              break;
            p = p.parentElement;
          }
          const foreground = getComputedStyle(el).color;
          const a = luminance(foreground),
            b = luminance(background);
          return {
            selector,
            foreground,
            background,
            ratio: Number(
              ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
            ),
          };
        });
      });
      assert.ok(pairs.every((p) => p.ratio >= 4.5));
      await writeFile(
        resolve(root, "docs/evidence/contrast.json"),
        JSON.stringify(pairs, null, 2),
      );
    },
  );
  await record("Missing wallet shows installation guidance", async () => {
    const noWallet = await makePage(false);
    await noWallet
      .locator("#trade")
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await noWallet.getByText(/No browser wallet found/).waitFor();
    await noWallet.close();
  });
  await record(
    "Missing contract code keeps transaction actions locked",
    async () => {
      state.missingCode = true;
      const failed = await makePage();
      await failed.getByText(/A configured contract has no code/).waitFor();
      assert.equal(
        await failed
          .getByRole("button", { name: "Review transfer", exact: true })
          .isDisabled(),
        true,
      );
      await failed.screenshot({
        path: resolve(root, "docs/evidence/missing-code.png"),
        fullPage: true,
      });
      await failed.close();
      state.missingCode = false;
    },
  );
  await record(
    "Tampered ABI is rejected before the app enables wallets",
    async () => {
      const tampered = await browser.newPage();
      await tampered.route("**/abi/LaunchToken.json", (route) =>
        route.fulfill({ json: [] }),
      );
      await tampered.goto(base);
      await tampered
        .getByText(
          "Contract ABI verification failed. Transactions are disabled.",
        )
        .waitFor();
      assert.equal(
        await tampered
          .getByRole("button", { name: "Connect wallet", exact: true })
          .count(),
        0,
      );
      await tampered.close();
    },
  );
  await record(
    "No browser exceptions or static-resource failures",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(resources, []);
    },
  );
  await writeFile(
    resolve(root, "docs/evidence/browser-results.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        browser: await browser.version(),
        fixture: "Mock wallet and RPC; no live transactions",
        subpath: "/preview/",
        checks,
        errors,
        resources,
        mockTransactions: state.sendCalls.length,
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  await page.screenshot({
    path: resolve(root, "docs/evidence/test-failure.png"),
    fullPage: true,
  });
  await writeFile(
    resolve(root, "docs/evidence/browser-failure.json"),
    JSON.stringify({ checks, error: e.message, errors, resources }, null, 2),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

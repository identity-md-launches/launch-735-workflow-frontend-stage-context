import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadDeployment } from "./config";
import { App } from "./App";
import "./style.css";
const root = ReactDOM.createRoot(document.getElementById("root")!);
class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="boot">
        <h1>Unable to display the dashboard</h1>
        <p>
          Reload the page to try again. No transaction was requested by this
          error.
        </p>
        <button onClick={() => location.reload()}>Reload dashboard</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
root.render(
  <main className="boot">
    <img src="./genesis.svg" width="48" height="48" alt="" />
    <h1>Genesis Protocol</h1>
    <p role="status">Verifying deployment configuration…</p>
  </main>,
);
loadDeployment()
  .then((runtime) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    });
    root.render(
      <Boundary>
        <WagmiProvider config={runtime.wagmi}>
          <QueryClientProvider client={queryClient}>
            <App runtime={runtime} />
          </QueryClientProvider>
        </WagmiProvider>
      </Boundary>,
    );
  })
  .catch((error) =>
    root.render(
      <main className="boot">
        <h1>Unable to verify this deployment</h1>
        <p role="alert">{error.message}</p>
        <button onClick={() => location.reload()}>Retry loading</button>
      </main>,
    ),
  );

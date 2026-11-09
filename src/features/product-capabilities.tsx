import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { SignedOut } from "../api/client";
import { appPath, loginHref } from "../app-path";
import {
  getProductCapabilities,
  NO_CAPABILITIES,
  type ProductCapabilities,
} from "./capabilities";

type Status = "loading" | "ready" | "unavailable" | "signed-out";
type State = { status: Status; capabilities: ProductCapabilities };
const CLOSED: State = { status: "loading", capabilities: NO_CAPABILITIES };
const ProductContext = createContext<State & { reload(): void }>({
  ...CLOSED,
  reload() {},
});

export function useProductCapabilities() {
  return useContext(ProductContext);
}

/** No persisted flags or URL overrides. Pending, missing and invalid reads stay off. */
export function ProductCapabilitiesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [{ attempt, background }, setCheck] = useState({
    attempt: 0,
    background: false,
  });
  const [result, setResult] = useState<State & { attempt: number }>({
    ...CLOSED,
    attempt: -1,
  });
  // An explicit retry closes the gate in the same render. A tab return checks
  // behind the current state, so an enabled page and its drafts stay mounted.
  const current: State =
    result.attempt === attempt || background ? result : CLOSED;
  useEffect(() => {
    const request = new AbortController();
    let disposed = false;
    // Only the server's own answer closes a feature that was open: a failed
    // tab-return check keeps it, and the next one tries again.
    const fail = (status: "unavailable" | "signed-out") =>
      setResult((previous) =>
        background && previous.status === "ready" && status === "unavailable"
          ? { ...previous, attempt }
          : { attempt, status, capabilities: NO_CAPABILITIES },
      );
    const deadline = window.setTimeout(() => {
      request.abort();
      if (!disposed) fail("unavailable");
    }, 8_000);
    getProductCapabilities(request.signal)
      .then(
        (capabilities) => {
          if (!disposed && !request.signal.aborted)
            setResult({ attempt, status: "ready", capabilities });
        },
        (error: unknown) => {
          if (!disposed)
            fail(error instanceof SignedOut ? "signed-out" : "unavailable");
        },
      )
      .finally(() => window.clearTimeout(deadline));
    return () => {
      disposed = true;
      window.clearTimeout(deadline);
      request.abort();
    };
  }, [attempt, background]);
  useEffect(() => {
    const refresh = () =>
      setCheck((check) => ({ attempt: check.attempt + 1, background: true }));
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return (
    <ProductContext.Provider
      value={{
        ...current,
        reload: () =>
          setCheck((check) => ({ attempt: check.attempt + 1, background: false })),
      }}
    >
      {children}
    </ProductContext.Provider>
  );
}

/** Children never mount, fetch or poll until the server admits the feature. */
export function ProductFeature({
  feature,
  children,
}: {
  feature: "flows" | "chief";
  children: ReactNode;
}) {
  const { status, capabilities, reload } = useProductCapabilities();
  if (status === "ready" && capabilities[feature]) return children;
  const label = feature === "flows" ? "Flows" : "Chief";
  return (
    <section className="card m-6" aria-label={`${label} availability`}>
      {status === "loading" ? (
        <p role="status">Checking availability…</p>
      ) : status === "signed-out" ? (
        <>
          <h1>Sign in to continue</h1>
          <a className="button" href={loginHref()}>
            Sign in
          </a>
        </>
      ) : status === "unavailable" ? (
        <>
          <h1>{label} is unavailable</h1>
          <p>We couldn’t check whether this feature is enabled.</p>
          <button type="button" onClick={reload}>
            Try again
          </button>
        </>
      ) : (
        <>
          <h1>{label} is not enabled on this installation</h1>
          <p>Contact your administrator if you need access.</p>
        </>
      )}
      <p>
        <a href={appPath()}>Back to sessions</a>
      </p>
    </section>
  );
}

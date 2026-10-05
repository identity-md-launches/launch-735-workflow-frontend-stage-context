import { useState, type ReactNode } from "react";
import { ArrowUpRight, Copy, Check, LoaderCircle } from "lucide-react";
import { getAddress } from "viem";
export function External({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={`external ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
export function AddressLink({
  address,
  explorer,
  full = false,
}: {
  address: string;
  explorer: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState(false);
  const checksum = getAddress(address);
  return (
    <span className="address">
      <External href={`${explorer}/address/${address}`}>
        <span title={checksum} className={full ? "mono wrap" : "mono"}>
          {full ? checksum : `${checksum.slice(0, 6)}…${checksum.slice(-4)}`}
        </span>
      </External>
      <button
        className="icon-button"
        aria-label={`Copy address ${checksum}`}
        onClick={() => {
          if (!navigator.clipboard) {
            setFailure(true);
            return;
          }
          navigator.clipboard
            .writeText(checksum)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => setFailure(true));
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Address copied" : ""}
      </span>
      {failure && (
        <small className="wrap">
          Copy unavailable. Select this address: {checksum}
        </small>
      )}
    </span>
  );
}
export function Busy({ label }: { label: string }) {
  return (
    <>
      <LoaderCircle className="spinner" size={16} aria-hidden="true" />
      {label}
    </>
  );
}
export function Metric({
  label,
  value,
  unit,
  detail,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="metric">
      <div className="metric-title">
        {label}
        {icon}
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <p>{detail}</p>
    </article>
  );
}
export function ErrorText({ message, id }: { message: string; id?: string }) {
  return (
    <p id={id} className="error" role={message ? "alert" : undefined}>
      {message}
    </p>
  );
}

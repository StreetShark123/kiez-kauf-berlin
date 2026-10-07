import { useId } from "react";

/**
 * Kiez Kiez mark: a map pin whose head is a tiny corner shop with a highlighter awning,
 * plus the handwritten wordmark. Same ink + wobble language as components/Doodle.tsx.
 */
export function LogoMark({ className }: { className?: string }) {
  const filterId = `logo-wobble-${useId().replace(/:/g, "")}`;
  const ink = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  return (
    <svg viewBox="0 0 48 56" className={className ?? "nb-logo-mark"} aria-hidden="true">
      <defs>
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {/* pin */}
        <path d="M24 53 C 18 46, 5 34, 5 21 A 19 19 0 0 1 43 21 C 43 34, 30 46, 24 53 Z" {...ink} />
        <path
          d="M24 53 C 18 46, 5 34, 5 21 A 19 19 0 0 1 43 21 C 43 34, 30 46, 24 53 Z"
          {...ink}
          strokeWidth={1.2}
          opacity={0.4}
          transform="translate(1 0.7)"
        />
        {/* awning */}
        <path className="nb-doodle-marker" d="M13 13 L 35 13 L 33 20 L 15 20 Z" />
        <path d="M12 13 L 36 13 L 34 20.5 L 14 20.5 Z" {...ink} strokeWidth={2.2} />
        <path d="M20 13 L 19.5 20.5 M 28 13 L 28.5 20.5" {...ink} strokeWidth={1.8} />
        {/* shop + door */}
        <path d="M15.5 20.5 L 15.5 33 L 32.5 33 L 32.5 20.5" {...ink} strokeWidth={2.2} />
        <path d="M25 33 L 25 25.5 L 30 25.5 L 30 33" {...ink} strokeWidth={1.8} />
        <path d="M18.5 25 L 22 25 L 22 29 L 18.5 29 Z" {...ink} strokeWidth={1.6} />
      </g>
    </svg>
  );
}

export function Logo({ name, tagline }: { name: string; tagline?: string }) {
  // "Kiez Kiez": the second word wears the highlighter.
  const [first, ...rest] = name.split(" ");
  return (
    <span className="nb-logo">
      <LogoMark />
      <span className="nb-logo-text">
        <span className="nb-logo-word">
          {first} {rest.length > 0 ? <mark className="nb-mark">{rest.join(" ")}</mark> : null}
        </span>
        {tagline ? <span className="nb-logo-tagline mono">{tagline}</span> : null}
      </span>
    </span>
  );
}

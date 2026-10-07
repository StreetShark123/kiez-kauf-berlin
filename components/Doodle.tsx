import { useId } from "react";

export type DoodleKind = "empty" | "searching" | "thanks" | "kiez";

/**
 * Small hand-drawn illustrations for the notebook UI.
 * Ink = currentColor, one highlighter blob = var(--marker). A turbulence filter wobbles the
 * strokes and every line is drawn twice, slightly offset, like a pen going over it again.
 */
export function Doodle({ kind, className, title }: { kind: DoodleKind; className?: string; title?: string }) {
  const filterId = `doodle-wobble-${useId().replace(/:/g, "")}`;
  const ink = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  return (
    <svg
      viewBox="0 0 160 120"
      className={`nb-doodle nb-doodle-${kind} ${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {kind === "empty" ? <EmptyBag ink={ink} /> : null}
        {kind === "searching" ? <Magnifier ink={ink} /> : null}
        {kind === "thanks" ? <Thanks ink={ink} /> : null}
        {kind === "kiez" ? <ShopFront ink={ink} /> : null}
      </g>
    </svg>
  );
}

type Ink = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
};

// Each path twice: a firm pass and a lighter, shifted "second go".
function Sketch({ d, ink, className }: { d: string; ink: Ink; className?: string }) {
  return (
    <g className={className}>
      <path d={d} {...ink} />
      <path d={d} {...ink} strokeWidth={1.2} opacity={0.45} transform="translate(1.2 0.8)" />
    </g>
  );
}

// "Nothing here yet": an empty paper bag, a magnifier peeking in, a scribbled question mark.
function EmptyBag({ ink }: { ink: Ink }) {
  return (
    <>
      <path className="nb-doodle-marker" d="M38 70 C 46 54, 92 50, 108 64 C 118 76, 104 98, 72 100 C 46 101, 30 88, 38 70 Z" />
      <Sketch ink={ink} d="M44 46 L 50 102 L 100 103 L 106 47 Z" />
      <Sketch ink={ink} d="M44 46 L 52 38 L 98 38 L 106 47" />
      <Sketch ink={ink} d="M60 56 C 60 46, 74 46, 74 56" />
      <Sketch ink={ink} d="M78 56 C 78 46, 92 46, 92 56" />
      <Sketch ink={ink} d="M58 76 C 62 72, 66 80, 70 76 C 74 72, 78 80, 82 76 C 86 72, 90 80, 94 76" />
      <Sketch ink={ink} d="M118 34 m -11 0 a 11 11 0 1 0 22 0 a 11 11 0 1 0 -22 0" />
      <Sketch ink={ink} d="M126 42 L 138 54" />
      <Sketch ink={ink} className="nb-doodle-wiggle" d="M24 26 C 24 18, 36 18, 35 26 C 34 31, 29 31, 29 36" />
      <circle cx="29" cy="42" r="1.8" fill="currentColor" />
      <Sketch ink={ink} d="M14 104 L 146 104" />
    </>
  );
}

// Loading: a magnifier sweeping over a couple of scribbled shop roofs.
function Magnifier({ ink }: { ink: Ink }) {
  return (
    <>
      <Sketch ink={ink} d="M18 96 L 18 74 L 34 62 L 50 74 L 50 96" />
      <Sketch ink={ink} d="M56 96 L 56 70 L 78 56 L 100 70 L 100 96" />
      <Sketch ink={ink} d="M106 96 L 106 78 L 122 68 L 140 78 L 140 96" />
      <Sketch ink={ink} d="M10 96 L 150 96" />
      <g className="nb-doodle-sweep">
        <path className="nb-doodle-marker" d="M70 44 m -18 0 a 18 18 0 1 0 36 0 a 18 18 0 1 0 -36 0" opacity={0.75} />
        <Sketch ink={ink} d="M70 44 m -18 0 a 18 18 0 1 0 36 0 a 18 18 0 1 0 -36 0" />
        <Sketch ink={ink} d="M83 57 L 98 72" />
        <Sketch ink={ink} d="M62 38 C 64 34, 68 32, 72 33" />
      </g>
    </>
  );
}

// After a crowd answer: a big tick in a wobbly circle with little sparkles.
function Thanks({ ink }: { ink: Ink }) {
  return (
    <>
      <path className="nb-doodle-marker" d="M54 60 C 54 36, 104 34, 106 58 C 108 84, 58 88, 54 60 Z" />
      <Sketch ink={ink} d="M80 26 C 104 24, 116 44, 112 64 C 108 86, 82 94, 64 86 C 46 78, 42 52, 54 38 C 60 31, 70 27, 80 26" />
      <Sketch ink={ink} className="nb-doodle-draw" d="M64 60 L 76 72 L 98 46" />
      <Sketch ink={ink} d="M126 30 L 126 42 M 120 36 L 132 36" />
      <Sketch ink={ink} d="M32 78 L 32 88 M 27 83 L 37 83" />
      <Sketch ink={ink} d="M130 84 L 136 90" />
      <Sketch ink={ink} d="M28 32 L 34 38" />
    </>
  );
}

// Home: a tiny Kiez shop with a striped awning.
function ShopFront({ ink }: { ink: Ink }) {
  return (
    <>
      <path className="nb-doodle-marker" d="M40 52 L 120 52 L 116 64 L 44 64 Z" />
      <Sketch ink={ink} d="M36 52 L 124 52 L 118 66 L 42 66 Z" />
      <Sketch ink={ink} d="M58 52 L 56 66 M 80 52 L 80 66 M 102 52 L 104 66" />
      <Sketch ink={ink} d="M44 66 L 44 104 M 116 66 L 116 104" />
      <Sketch ink={ink} d="M52 76 L 74 76 L 74 94 L 52 94 Z" />
      <Sketch ink={ink} d="M86 104 L 86 76 L 106 76 L 106 104" />
      <circle cx="101" cy="91" r="1.6" fill="currentColor" />
      <Sketch ink={ink} d="M48 36 C 58 28, 102 28, 112 36 L 112 46 L 48 46 Z" />
      <Sketch ink={ink} d="M60 41 L 100 41" />
      <Sketch ink={ink} d="M20 104 L 140 104" />
      <Sketch ink={ink} d="M128 104 C 128 92, 136 92, 136 82 C 140 92, 146 94, 144 104" />
    </>
  );
}

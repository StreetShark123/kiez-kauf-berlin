"use client";

import { useCallback, useEffect, useRef } from "react";

const PIXEL_SCALE = 4;
const CANVAS_MAX_WIDTH = 520;
const CANVAS_MAX_HEIGHT = 920;

type Point = { x: number; y: number };

function getPointFromEvent(event: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return {
    x: Math.max(0, Math.min(canvas.width - 1, x)),
    y: Math.max(0, Math.min(canvas.height - 1, y))
  };
}

function setupContext(canvas: HTMLCanvasElement, inkColor: string) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  ctx.strokeStyle = inkColor;
  ctx.fillStyle = inkColor;
  return ctx;
}

export function ErrorPixelNoteScreen({
  title,
  description,
  joke,
  hint,
  retryLabel,
  clearLabel,
  exitLabel,
  exitHref,
  onRetry
}: {
  title: string;
  description: string;
  joke: string;
  hint: string;
  retryLabel: string;
  clearLabel: string;
  exitLabel: string;
  exitHref: string;
  onRetry: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const isDrawingRef = useRef(false);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const resize = () => {
      const cssWidth = Math.min(window.innerWidth, CANVAS_MAX_WIDTH);
      const cssHeight = Math.min(window.innerHeight, CANVAS_MAX_HEIGHT);
      const pixelWidth = Math.max(120, Math.floor(cssWidth / PIXEL_SCALE));
      const pixelHeight = Math.max(180, Math.floor(cssHeight / PIXEL_SCALE));
      const inkColor =
        window.getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111111";
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      contextRef.current = setupContext(canvas, inkColor);
      clearCanvas();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const ctx = contextRef.current;
      if (!ctx) {
        return;
      }
      const next = getPointFromEvent(event, canvas);
      isDrawingRef.current = true;
      lastPointRef.current = next;
      ctx.fillRect(Math.round(next.x), Math.round(next.y), 1, 1);
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isDrawingRef.current) {
        return;
      }
      const ctx = contextRef.current;
      const last = lastPointRef.current;
      if (!ctx || !last) {
        return;
      }
      const next = getPointFromEvent(event, canvas);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      lastPointRef.current = next;
    };

    const stopDrawing = (event: PointerEvent) => {
      if (!isDrawingRef.current) {
        return;
      }
      isDrawingRef.current = false;
      lastPointRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    resize();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDrawing);
    canvas.addEventListener("pointercancel", stopDrawing);
    window.addEventListener("resize", resize);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDrawing);
      canvas.removeEventListener("pointercancel", stopDrawing);
      window.removeEventListener("resize", resize);
    };
  }, [clearCanvas]);

  return (
    <main className="pixel-note-error-shell">
      <canvas ref={canvasRef} className="pixel-note-canvas" aria-label={hint} />

      <header className="pixel-note-header" aria-live="polite">
        <p className="section-title">Error</p>
        <h1 className="pixel-note-title">{title}</h1>
        <p className="pixel-note-copy">{description}</p>
        <p className="pixel-note-copy">{joke}</p>
        <p className="pixel-note-copy">{hint}</p>
      </header>

      <nav className="pixel-note-actions" aria-label="error actions">
        <button type="button" onClick={clearCanvas} className="btn-ghost pixel-note-btn">
          {clearLabel}
        </button>
        <button type="button" onClick={onRetry} className="btn-primary pixel-note-btn">
          {retryLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.assign(exitHref);
          }}
          className="btn-secondary pixel-note-btn"
        >
          {exitLabel}
        </button>
      </nav>
    </main>
  );
}

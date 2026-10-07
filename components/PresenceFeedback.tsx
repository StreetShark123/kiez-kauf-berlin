"use client";

import { useState } from "react";
import { track } from "@vercel/analytics";
import { Doodle } from "@/components/Doodle";
import type { Dictionary } from "@/lib/i18n";

type FeedbackState = "idle" | "sending" | "thanks" | "error";

/**
 * The cheapest crowd signal: "did they have it?". One tap writes one piece of evidence;
 * the server keeps one current vote per device, store and product type.
 */
export function PresenceFeedback({
  dictionary,
  storeId,
  productTypeId,
  productLabel,
  query,
  compact = false
}: {
  dictionary: Pick<
    Dictionary,
    "presenceQuestionTemplate" | "presenceYesAction" | "presenceNoAction" | "presenceThanks" | "presenceError" | "presenceHint"
  >;
  storeId: string;
  productTypeId: string;
  productLabel: string;
  query?: string;
  // Inline yes/no for long lists (store page).
  compact?: boolean;
}) {
  const [state, setState] = useState<FeedbackState>("idle");
  const [answer, setAnswer] = useState<boolean | null>(null);

  async function send(found: boolean) {
    setAnswer(found);
    setState("sending");
    try {
      const response = await fetch("/api/presence/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, productTypeId, found, query: query || null })
      });
      if (!response.ok) {
        throw new Error(`feedback ${response.status}`);
      }
      setState("thanks");
      track("presence_feedback", { found, product_type: productTypeId });
    } catch {
      setState("error");
    }
  }

  if (compact) {
    const question = dictionary.presenceQuestionTemplate.replace("{product}", productLabel);
    return (
      <span className="inline-flex items-center gap-1" role="group" aria-label={question}>
        {state === "thanks" ? (
          <span className="status-text text-[0.68rem]" role="status">
            {answer ? "✓" : "✗"}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="nb-chip"
              disabled={state === "sending"}
              aria-label={`${question} ${dictionary.presenceYesAction}`}
              title={dictionary.presenceYesAction}
              onClick={() => void send(true)}
            >
              ✓
            </button>
            <button
              type="button"
              className="nb-chip"
              disabled={state === "sending"}
              aria-label={`${question} ${dictionary.presenceNoAction}`}
              title={dictionary.presenceNoAction}
              onClick={() => void send(false)}
            >
              ✗
            </button>
            {state === "error" ? (
              <span className="status-text text-[0.66rem]" role="alert">
                !
              </span>
            ) : null}
          </>
        )}
      </span>
    );
  }

  if (state === "thanks") {
    return (
      <div className="nb-feedback-thanks-wrap" role="status">
        <Doodle kind="thanks" />
        <p className="nb-feedback-thanks">{dictionary.presenceThanks}</p>
      </div>
    );
  }

  return (
    <div className="nb-feedback">
      <p className="nb-feedback-question">{dictionary.presenceQuestionTemplate.replace("{product}", productLabel)}</p>
      <div className="nb-actions">
        <button
          type="button"
          className={`nb-btn nb-btn-small ${answer === true ? "is-active" : ""}`}
          disabled={state === "sending"}
          onClick={() => void send(true)}
        >
          ✓ {dictionary.presenceYesAction}
        </button>
        <button
          type="button"
          className={`nb-btn nb-btn-small ${answer === false ? "is-active" : ""}`}
          disabled={state === "sending"}
          onClick={() => void send(false)}
        >
          ✗ {dictionary.presenceNoAction}
        </button>
      </div>
      <p className="nb-feedback-hint" role={state === "error" ? "alert" : undefined}>
        {state === "error" ? dictionary.presenceError : dictionary.presenceHint}
      </p>
    </div>
  );
}

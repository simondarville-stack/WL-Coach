/**
 * FieldReviewScreen — the Review feed inside the coach mobile app (/coach).
 *
 * Full-viewport reels scroller: one athlete item per swipe, auto-clearing
 * as you dwell, bottom tab bar left visible. Reuses the same ReviewScroller
 * as desktop /review — the phone is its native habitat.
 */
import { ReviewScroller } from '../../components/review/ReviewScroller';

export function FieldReviewScreen() {
  // FieldLayout pads the page bottom by 5rem (pb-20) for the fixed tab bar;
  // filling exactly the remaining viewport makes each card one full swipe.
  return (
    <div className="h-[calc(100dvh-5rem)] overflow-hidden">
      <ReviewScroller />
    </div>
  );
}

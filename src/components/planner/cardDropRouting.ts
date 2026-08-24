// Where a drop on a training-unit card goes.
//
// Two card shapes accept drops — the full DayCard and the scheduled week's
// DayCardCondensed — and they must accept exactly the same things. This routing
// lived inside DayCard, so the condensed card silently swallowed every drag: the
// coach could pull a day out of a parked week and nothing happened.

export interface CardDropTargets {
  /** Index of the unit being dropped ON. */
  dayIndex: number;
  onClipboardItemDrop?: (clipboardItemId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockExerciseDrop?: (exerciseId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDrop?: (templateId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDayDrop?: (templateDayId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDayDrop?: (sourceDay: number, destDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  onExerciseDrop?: (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  /** Card REORDER, which moves the card's position and never its contents. */
  onReorderDay?: (fromDayIndex: number, toDayIndex: number) => void;
}

/**
 * Dispatch one `text/plain` drag payload. Returns true when the payload was
 * recognised, so a caller can decide what an unknown drop means.
 */
export async function routeCardDrop(
  data: string,
  isCopy: boolean,
  isReplace: boolean,
  t: CardDropTargets,
): Promise<boolean> {
  if (!data) return false;
  const { dayIndex } = t;

  // Reordering moves the CARD, never its contents — handled before anything
  // that would touch exercises, and a drop on itself is a no-op.
  if (data.startsWith('DAYORDER:')) {
    const from = parseInt(data.slice('DAYORDER:'.length), 10);
    if (!Number.isNaN(from) && from !== dayIndex) t.onReorderDay?.(from, dayIndex);
    return true;
  }

  // Slices of a parked week, dragged out of its preview panel.
  if (data.startsWith('CLIPBOARD:week-day:')) {
    const rest = data.slice('CLIPBOARD:week-day:'.length);
    if (rest && t.onClipboardItemDrop) await t.onClipboardItemDrop(`week-day:${rest}`, dayIndex, isReplace);
    return true;
  }
  if (data.startsWith('CLIPBOARD:week-ex:')) {
    const rest = data.slice('CLIPBOARD:week-ex:'.length);
    if (rest && t.onClipboardItemDrop) await t.onClipboardItemDrop(`week-ex:${rest}`, dayIndex, isReplace);
    return true;
  }
  if (data.startsWith('CLIPBOARD:week:')) {
    const weekId = data.slice('CLIPBOARD:week:'.length);
    if (weekId && t.onClipboardItemDrop) await t.onClipboardItemDrop(`week:${weekId}`, dayIndex, isReplace);
    return true;
  }

  // Accept both prefixes during the rename window — a card already on screen
  // when the bundle reloads might still emit the legacy CANVAS: marker.
  if (
    data.startsWith('CLIPBOARD:exercise:') ||
    data.startsWith('CLIPBOARD:day:') ||
    data.startsWith('CANVAS:exercise:') ||
    data.startsWith('CANVAS:day:')
  ) {
    const clipboardId = data.slice(data.lastIndexOf(':') + 1);
    if (clipboardId && t.onClipboardItemDrop) await t.onClipboardItemDrop(clipboardId, dayIndex, isReplace);
    return true;
  }

  if (data.startsWith('DOCK:exercise:')) {
    const exerciseId = data.slice('DOCK:exercise:'.length);
    if (exerciseId && t.onDockExerciseDrop) await t.onDockExerciseDrop(exerciseId, dayIndex, isReplace);
    return true;
  }
  if (data.startsWith('DOCK:template-day:')) {
    const templateDayId = data.slice('DOCK:template-day:'.length);
    if (templateDayId && t.onDockTemplateDayDrop) await t.onDockTemplateDayDrop(templateDayId, dayIndex, isReplace);
    return true;
  }
  if (data.startsWith('DOCK:template:')) {
    const templateId = data.slice('DOCK:template:'.length);
    if (templateId && t.onDockTemplateDrop) await t.onDockTemplateDrop(templateId, dayIndex, isReplace);
    return true;
  }

  if (data.startsWith('DAY:')) {
    const sourceDay = parseInt(data.slice(4), 10);
    if (Number.isNaN(sourceDay) || sourceDay === dayIndex) return true;
    if (t.onDayDrop) await t.onDayDrop(sourceDay, dayIndex, isCopy, isReplace);
    return true;
  }

  // "<dayIndex>:exercise:<plannedExId>"
  const parts = data.split(':');
  if (parts.length >= 3 && parts[1] === 'exercise') {
    const fromDay = parseInt(parts[0], 10);
    const itemId = parts[2];
    if (Number.isNaN(fromDay) || fromDay === dayIndex || !itemId) return true;
    if (t.onExerciseDrop) await t.onExerciseDrop(fromDay, itemId, dayIndex, isCopy, isReplace);
    return true;
  }

  return false;
}

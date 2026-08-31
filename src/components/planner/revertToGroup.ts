/**
 * requestRevertToGroup — the UI conversation around revertRowToGroup.
 *
 * One entry point for every surface that shows the clickable "I" badge
 * (DayCard rows, DayEditor rows), so the confirm copy and the edge-case
 * handling stay identical everywhere:
 *
 * - normal case  → confirm, revert, refresh.
 * - logged row   → explain that a logged prescription is protected (same
 *                  rule as the sync) and change nothing.
 * - slot gone    → the group plan no longer trains this exercise here, so
 *                  the honest revert is removal — asked as its own,
 *                  explicitly destructive question.
 */
import { confirmDialog, alertDialog } from '../ui/ConfirmDialog';
import { describeError } from '../../lib/errorMessage';
import { revertRowToGroup } from '../../lib/groupSyncService';

export async function requestRevertToGroup(
  plannedExerciseId: string,
  exerciseLabel: string,
  onRefresh: () => Promise<void> | void,
): Promise<void> {
  const ok = await confirmDialog({
    title: `Revert “${exerciseLabel}” to the group version?`,
    message: 'The individual edits on this exercise are replaced by the group plan’s current prescription. The row goes back to “G” and follows future group syncs again.',
    confirmLabel: 'Revert to group',
    tone: 'danger',
  });
  if (!ok) return;

  try {
    const result = await revertRowToGroup(plannedExerciseId);
    switch (result) {
      case 'reverted':
        await onRefresh();
        return;
      case 'logged':
        await alertDialog({
          title: 'Protected by a log',
          message: 'The athlete has already logged against this exercise. Logged prescriptions are records and are never replaced — by revert or by sync.',
        });
        return;
      case 'not-in-group': {
        const remove = await confirmDialog({
          title: 'Not in the group plan anymore',
          message: `The group plan no longer contains “${exerciseLabel}” on this unit, so reverting means removing it from this athlete.`,
          confirmLabel: 'Remove exercise',
          tone: 'danger',
        });
        if (remove) {
          await revertRowToGroup(plannedExerciseId, { removeIfMissing: true });
          await onRefresh();
        }
        return;
      }
      case 'no-group-plan':
        // The badge only renders on group-linked plans; reaching this means
        // the link was removed since load. Refresh so the UI catches up.
        await onRefresh();
        return;
      case 'removed':
        // Only returned for removeIfMissing calls, handled above.
        await onRefresh();
        return;
    }
  } catch (err) {
    await alertDialog({ title: 'Couldn’t revert', message: describeError(err) });
  }
}

/**
 * guard-stale-main — refuse a commit on a `main` that is behind `origin/main`.
 *
 * Run by the husky pre-commit hook. On 04/09/2026 two sessions committed
 * 0.84.0–0.86.1 on a local `main` that was 45 commits behind the remote, and
 * the merge cost a day. This is the check that would have said so at the
 * first commit.
 *
 * Rules:
 *   - Only on `main`. A feature branch is supposed to be behind.
 *   - The fetch is quiet and bounded (6 s). Offline, slow, or no `origin`:
 *     say nothing and let the commit through — a guard that blocks on the
 *     network gets routed around within a week.
 *   - `EMOS_SKIP_MAIN_GUARD=1` skips it, for the one case (a rollback commit
 *     made behind on purpose) where being behind is the point.
 *
 * Exit 1 refuses the commit; every other path exits 0.
 */
import { spawnSync } from 'node:child_process';

const FETCH_TIMEOUT_MS = 6000;

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    ok: result.status === 0 && !result.error,
    out: (result.stdout ?? '').trim(),
  };
}

if (process.env.EMOS_SKIP_MAIN_GUARD === '1') process.exit(0);

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!branch.ok || branch.out !== 'main') process.exit(0);

// Quiet, bounded. A failure here is a network answer, not a git one.
const fetched = git(['fetch', 'origin', 'main', '--quiet'], { timeout: FETCH_TIMEOUT_MS });
if (!fetched.ok) process.exit(0);

const behind = git(['rev-list', '--count', 'HEAD..origin/main']);
if (!behind.ok) process.exit(0);
const count = Number(behind.out);
if (!Number.isFinite(count) || count <= 0) process.exit(0);

const s = count === 1 ? '' : 's';
process.stderr.write(
  [
    '',
    `✖ main is ${count} commit${s} behind origin/main — refusing to commit on a stale main.`,
    '',
    '  Bring main up to date first:',
    '      git fetch && git merge origin/main',
    '  or move this work to a branch:',
    '      git switch -c feature/<topic>',
    '',
    '  (EMOS_SKIP_MAIN_GUARD=1 skips this check, for a rollback made behind on purpose.)',
    '',
  ].join('\n'),
);
process.exit(1);

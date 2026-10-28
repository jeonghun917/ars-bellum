// Record checks for world.m1Followups, from the earlier version's root and save validators.
// Depends on nothing outside the ledger itself.
//
// checkFollowups runs after every transaction, so it does not recompute record digests (up to 8192
// records). checkFollowupDigests does; use it when loading a save. A record whose digest no longer
// matches is also quarantined the first time the daily run reaches it.
import { ok, fail } from '../../core/result.js';
import { digestOf, recordIssue, rootIssue } from './shared.js';

export function checkFollowups(state) {
  const root = state.world.m1Followups;
  const issue = rootIssue(root);
  if (issue) return fail('followups_invalid_root', { issue });
  const keys = Object.keys(root.records);
  if (keys.length > root.maxRecords) return fail('followups_too_many_records', { count: keys.length, maxRecords: root.maxRecords });
  for (const key of keys) {
    const problem = recordIssue(root.records[key], key);
    if (problem) return fail('followups_invalid_record', { key, issue: problem });
  }
  return ok();
}

export function checkFollowupDigests(state) {
  const basic = checkFollowups(state);
  if (!basic.ok) return basic;
  const { records } = state.world.m1Followups;
  for (const key of Object.keys(records)) {
    const record = records[key];
    // A quarantined record keeps whatever input was received, so its digest is not trusted.
    if (record.status !== 'quarantined' && digestOf(record.normalizedFollowupInput) !== record.inputDigest) {
      return fail('followups_digest_mismatch', { key });
    }
  }
  return ok();
}

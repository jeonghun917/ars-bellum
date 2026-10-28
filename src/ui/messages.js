// Turns the failures the game areas return ({ ok: false, error, detail }) into Korean sentences for
// the player. Every message keeps the failure code in parentheses, so a tester can report it exactly.
import { getBuilding } from '../domains/settlements/index.js';
import { formatAmount, resourceName } from './format.js';

const buildingName = (id) => getBuilding(id)?.name ?? id;

function missingText(detail) {
  const parts = [];
  if (detail?.missingGold > 0) parts.push(`금 ${formatAmount(detail.missingGold)}`);
  for (const [id, amount] of Object.entries(detail?.missingResources ?? {})) parts.push(`${resourceName(id)} ${formatAmount(amount)}`);
  return parts.join(', ');
}

function placementReason(reason) {
  if (reason.startsWith('needs_tag:')) return `필요한 지형·조건: ${reason.slice('needs_tag:'.length).split('|').join(' 또는 ')}`;
  if (reason.startsWith('type:')) return `지을 수 없는 거점 종류(${reason.slice('type:'.length)})`;
  return reason;
}

const causeOf = (detail) => (detail && typeof detail === 'object' && detail.cause && typeof detail.cause === 'object' ? detail.cause : null);

// Each entry: (detail, failure) -> sentence. Anything not listed falls back to a generic sentence.
const TEXT = {
  settlements_insufficient_cost: (d) => `건설 비용이 모자랍니다. 더 필요한 것: ${missingText(d) || '확인할 수 없음'}.`,
  settlements_placement_blocked: (d) => `${buildingName(d?.buildingId)}은(는) 이 거점에 지을 수 없습니다. ${(d?.reasons ?? []).map(placementReason).join(', ')}`.trim(),
  settlements_max_level: (d) => `${buildingName(d?.buildingId)}은(는) 이미 최고 단계(Lv ${d?.maxLevel})입니다.`,
  settlements_unknown_building: () => '알 수 없는 건물입니다.',
  settlements_unknown_settlement: () => '알 수 없는 거점입니다.',
  settlements_job_not_found: () => '취소할 건설 작업을 찾을 수 없습니다. 이미 끝났거나 취소되었습니다.',
  settlements_invalid_workforce: () => '건설 인원은 0 이상의 정수여야 합니다.',
  settlements_invalid_input: () => '입력이 올바르지 않습니다.',
  settlements_unknown_resource: (d) => `알 수 없는 자원입니다: ${d?.resourceId ?? ''}`,

  world_unknown_group: () => '이동할 부대를 찾을 수 없습니다.',
  world_unknown_node: () => '알 수 없는 거점입니다.',
  world_invalid_target: () => '목적지가 올바르지 않습니다.',
  world_invalid_order: () => '이동 명령이 올바르지 않습니다.',
  world_invalid_patch: () => '이동 결과를 기록할 수 없습니다.',
  world_unreachable: () => '도로로 갈 수 있는 경로가 없습니다.',
  world_no_start_road: () => '가까운 도로가 없어 도로 경로를 쓸 수 없습니다.',
  world_detour_too_long: () => '도로 경로가 직선보다 너무 멀리 돌아가서 쓰지 않습니다.',

  save_conflict: () => '다른 곳(다른 탭 등)에서 더 새로운 저장이 만들어져 있어 덮어쓰지 않았습니다. 이 화면의 진행은 저장되지 않았습니다.',
  save_older_than_stored: () => '저장된 게임이 이 화면보다 더 진행되어 있어 덮어쓰지 않았습니다.',
  save_refused_newer_version_stored: () => '저장된 게임이 더 새로운 버전의 게임에서 만든 것이라 덮어쓰지 않았습니다.',
  save_refused_stored_save_unreadable: () => '저장된 게임이 손상되어 있어 덮어쓰지 않았습니다. 메인 메뉴에서 새로 시작할 수 있습니다.',
  save_write_failed: (d) => `브라우저가 저장을 거부했습니다(저장 공간 부족이거나 저장이 막혀 있을 수 있습니다).${typeof d === 'string' && d ? ` ${d}` : ''}`,
  save_staging_readback_failed: () => '저장한 내용을 다시 읽어 확인하지 못했습니다. 저장된 게임은 바뀌지 않았습니다.',
  save_final_readback_failed: () => '저장한 내용을 다시 읽어 확인하지 못했습니다. 이전 저장을 되돌렸습니다.',
  save_state_invalid: () => '현재 게임 상태가 검사를 통과하지 못해 저장하지 않았습니다.',

  // Reading a stored save.
  save_not_json: () => '저장된 내용이 JSON이 아닙니다(파일이 잘렸거나 손상되었습니다).',
  save_wrong_format: () => '저장된 내용이 이 게임의 저장 형식이 아닙니다.',
  save_no_schema_version: () => '저장에 버전 표시가 없습니다.',
  save_from_newer_version: (d) => `더 새로운 버전(${d?.schemaVersion})의 게임에서 만든 저장입니다. 이 버전에서는 열 수 없고, 덮어쓰지도 않습니다.`,
  save_unknown_old_version: (d) => `알 수 없는 옛 버전(${d?.schemaVersion})의 저장입니다.`,
  save_no_state: () => '저장에 게임 상태가 없습니다.',
  save_digest_mismatch: () => '저장의 검증 값이 맞지 않습니다(내용이 바뀌었거나 손상되었습니다).',
  save_revision_mismatch: () => '저장의 개정 번호가 맞지 않습니다(손상되었습니다).',
  save_state_invalid_on_load: () => '저장된 게임 상태가 검사를 통과하지 못했습니다.',
  v1_save_not_json: () => '이전 버전 저장이 JSON이 아닙니다(손상되었습니다).',
  v1_key_holds_newer_version: () => '이전 버전 저장 자리에 더 새로운 버전의 저장이 있습니다. 덮어쓰지 않습니다.',
  v1_not_a_v1_save: () => '이전 버전 저장 형식이 아닙니다.',
  v1_game_state_missing: () => '이전 버전 저장에 게임 상태가 없습니다.',
  v1_migrated_state_invalid: () => '이전 버전 저장을 새 형식으로 바꾸는 중 검사에 실패했습니다.',
  campaign_settlement_seed_failed: () => '저장된 게임에 거점 정보를 채워 넣지 못했습니다.',
  storage_unavailable: (d) => `브라우저 저장소를 쓸 수 없습니다(시크릿 모드이거나 저장이 막혀 있을 수 있습니다).${typeof d === 'string' && d ? ` ${d}` : ''}`,

  battle_reward_not_saved: () => '승리 보상을 저장하지 못했습니다.',
  battle_result_invalid: (d) => `전투 결과를 읽을 수 없습니다(${d?.field ?? ''}). 아무것도 기록하지 않았습니다.`,
  battle_start_failed: (d) => `전투를 시작하지 못했습니다. ${typeof d === 'string' ? d : ''}`.trim(),
  daily_step_failed: (d) => `${d?.day}일의 하루 처리(${d?.step})가 실패했습니다.`,
  store_state_invalid: () => '이 동작의 결과가 게임 상태 검사를 통과하지 못해 취소되었습니다.',
  store_change_threw: (d) => `동작 중 오류가 나서 취소되었습니다. ${d?.message ?? ''}`.trim(),
  finance_invalid_amount: () => '금액이 올바르지 않습니다.',
  finance_metric_out_of_range: () => '인력이나 영지 수가 허용 범위를 벗어납니다.',
  finance_metrics_wrong_account: () => '인력·영지는 조종 중인 인물의 계좌에만 기록할 수 있습니다.',
  finance_account_missing: () => '보상을 받을 계좌를 찾을 수 없습니다.',
};

// Names the failure code plus, for wrapped failures, the code underneath ("daily_step_failed (finance_...)").
export function failureCodes(failure) {
  const codes = [];
  let current = failure;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth += 1) {
    if (typeof current.error === 'string') codes.push(current.error);
    current = causeOf(current.detail) ?? causeOf(current);
  }
  return codes;
}

export function describeFailure(failure) {
  if (failure === null || typeof failure !== 'object') return `알 수 없는 오류 (${String(failure)})`;
  const code = typeof failure.error === 'string' ? failure.error : 'unknown_error';
  const make = TEXT[code];
  const sentence = make ? make(failure.detail, failure) : '동작을 처리하지 못했습니다.';
  const inner = causeOf(failure.detail);
  const innerText = inner ? ` ${describeFailure(inner)}` : '';
  return `${sentence}${innerText} (${failureCodes(failure).join(' > ') || code})`;
}

// Why a stored save could not be read, for the main menu.
export function describeUnreadableSave(failure) {
  // save_state_invalid inside load() carries the issue list; name it differently from the save-time refusal.
  const code = failure?.error;
  if (code === 'save_state_invalid') {
    const issues = Array.isArray(failure.detail) ? failure.detail.slice(0, 3).join('; ') : '';
    return `${TEXT.save_state_invalid_on_load()}${issues ? ` ${issues}` : ''} (save_state_invalid)`;
  }
  return describeFailure(failure);
}

// A save from a newer game version is never overwritten, so starting new over it is not offered.
export const canStartNewOver = (failure) => !['save_from_newer_version', 'v1_key_holds_newer_version', 'storage_unavailable'].includes(failure?.error);

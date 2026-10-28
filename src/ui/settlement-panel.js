// The panel of the settlement the group stands in: people, stock, treasury, buildings and the
// construction queue. Every change goes through campaign.store.transact with the settlement rules,
// and every refusal is written out with its reason.
import {
  BUILDINGS, cancelConstruction, constructionLaborAvailable, enqueueConstruction, getBuilding,
  getSettlement, previewConstruction, setConstructionWorkforce,
} from '../domains/settlements/index.js';
import { el, fill, setText } from './dom.js';
import { formatAmount, formatCost, formatInt, resourceName } from './format.js';
import { describeFailure } from './messages.js';

const TYPE_NAMES = { village: '마을', town: '소도시', city: '도시', castle: '성', fort: '요새', port: '항구' };
const STATUS_NAMES = { queued: '대기', active: '진행 중' };

export function createSettlementPanel({ root, campaign, getNodeName }) {
  let currentId = null;
  let signature = '';
  const parts = {};

  const message = el('div', { id: 'sp-message', class: 'panel-message', role: 'status', 'aria-live': 'polite' });
  const select = el('select', { id: 'sp-building-select', 'aria-label': '지을 건물' },
    BUILDINGS.map((building) => el('option', { value: building.id, text: building.name })));
  const enqueueButton = el('button', { id: 'sp-enqueue', type: 'button', dataset: { action: 'enqueue' }, text: '건설 대기열에 추가' });
  const workforceInput = el('input', { id: 'sp-workforce', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': '건설 인원' });
  const workforceButton = el('button', { id: 'sp-workforce-set', type: 'button', dataset: { action: 'workforce' }, text: '인원 정하기' });

  parts.name = el('h2', { id: 'sp-name' });
  // The panel can be folded away so it does not hide the map.
  const toggle = el('button', { id: 'sp-toggle', type: 'button', class: 'small', 'aria-expanded': 'true', text: '접기' });
  toggle.addEventListener('click', () => {
    const folded = root.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!folded));
    setText(toggle, folded ? '펴기' : '접기');
  });
  parts.type = el('span', { id: 'sp-type' });
  parts.population = el('span', { id: 'sp-population' });
  parts.labor = el('span', { id: 'sp-labor' });
  parts.treasury = el('span', { id: 'sp-treasury' });
  parts.stock = el('ul', { id: 'sp-stock', class: 'plain-list' });
  parts.buildings = el('ul', { id: 'sp-buildings', class: 'plain-list' });
  parts.queue = el('ol', { id: 'sp-queue', class: 'plain-list' });
  parts.preview = el('div', { id: 'sp-preview', class: 'preview' });
  parts.crew = el('div', { id: 'sp-crew-info', class: 'preview' });
  parts.report = el('div', { id: 'sp-report', class: 'preview' });

  const row = (label, node) => el('div', { class: 'kv' }, el('dt', { text: label }), el('dd', {}, node));
  root.append(
    el('div', { class: 'panel-head' }, parts.name, toggle),
    el('dl', { class: 'kvs' }, row('종류', parts.type), row('인구', parts.population), row('노동력', parts.labor), row('금고', parts.treasury)),
    el('h3', { text: '비축 물자' }), parts.stock,
    el('h3', { text: '건물' }), parts.buildings,
    el('h3', { text: '건설 대기열' }), parts.queue,
    el('div', { class: 'form-row' }, select, enqueueButton), parts.preview,
    el('div', { class: 'form-row' }, el('label', { for: 'sp-workforce', text: '건설 인원' }), workforceInput, workforceButton), parts.crew,
    message,
    el('h3', { text: '지난 하루' }), parts.report,
  );
  root.hidden = true;

  const say = (kind, text) => {
    message.dataset.kind = kind;
    message.textContent = text;
  };

  function levelLine(settlement, building) {
    const level = settlement.buildings[building.id]?.level ?? 0;
    return `${building.name} (Lv ${level}/${building.maxLevel})`;
  }

  function renderPreview(state, settlement) {
    const plan = previewConstruction(state, { settlementId: settlement.id, buildingId: select.value });
    if (!plan.ok) {
      parts.preview.dataset.kind = 'error';
      setText(parts.preview, `지금은 지을 수 없습니다: ${describeFailure(plan)}`);
      return;
    }
    parts.preview.dataset.kind = 'ok';
    const warn = plan.warnings.length ? ` / 참고: ${plan.warnings.join(', ')}` : '';
    setText(parts.preview, `Lv ${plan.targetLevel} 건설: 비용 ${formatCost(plan.cost)} / 작업량 ${formatInt(plan.requiredWork)} / 최소 ${plan.minimumDays}일${warn}`);
  }

  function render(state, settlement) {
    setText(parts.name, getNodeName(settlement.id));
    setText(parts.type, TYPE_NAMES[settlement.type] ?? settlement.type);
    const people = settlement.population;
    setText(parts.population, `${formatInt(people.current)} / ${formatInt(people.effectiveCapacity)}`);
    setText(parts.labor, `일할 수 있는 사람 ${formatInt(people.labor.workforce)} (일자리 있음 ${formatInt(people.labor.employed)}, 없음 ${formatInt(people.labor.unemployed)})`);
    setText(parts.treasury, `금 ${formatAmount(settlement.money.treasury)}`);

    const stock = Object.entries(settlement.inventory).sort(([a], [b]) => a.localeCompare(b));
    fill(parts.stock, stock.length
      ? stock.map(([id, amount]) => el('li', { dataset: { resource: id } }, `${resourceName(id)} ${formatAmount(amount)}`))
      : el('li', { class: 'muted', text: '비어 있음' }));

    const built = Object.entries(settlement.buildings).filter(([, b]) => b.level > 0).sort(([a], [b]) => a.localeCompare(b));
    fill(parts.buildings, built.length
      ? built.map(([id, b]) => el('li', { dataset: { building: id, level: b.level } }, `${levelLine(settlement, getBuilding(id) ?? { id, name: id, maxLevel: '?' })}${b.enabled ? '' : ' - 가동 중지'}`))
      : el('li', { class: 'muted', text: '지은 건물이 없습니다' }));

    const queue = settlement.construction.queue;
    fill(parts.queue, queue.length
      ? queue.map((job) => {
        const building = getBuilding(job.buildingId);
        const refund = job.status === 'queued' ? '전액' : '절반';
        return el(
          'li',
          { dataset: { jobId: job.id, status: job.status } },
          el('span', { class: 'job-text', text: `${building?.name ?? job.buildingId} Lv ${job.fromLevel}→${job.targetLevel} · ${STATUS_NAMES[job.status] ?? job.status} · 작업 ${formatAmount(job.progressWork)}/${formatAmount(job.requiredWork)} · ${job.workedDays}/${job.minimumDays}일 · 지불한 비용 ${formatCost(job.cost)}` }),
          el('button', { type: 'button', class: 'small', dataset: { action: 'cancel', jobId: job.id }, title: `취소하면 비용의 ${refund}을 돌려받습니다`, text: `취소 (${refund} 환급)` }),
        );
      })
      : el('li', { class: 'muted', text: '대기 중인 건설이 없습니다' }));

    for (const building of BUILDINGS) {
      const option = select.querySelector(`option[value="${building.id}"]`);
      setText(option, levelLine(settlement, building));
    }
    renderPreview(state, settlement);

    const construction = settlement.construction;
    if (document.activeElement !== workforceInput) workforceInput.value = String(construction.workforce);
    setText(parts.crew, `정한 인원 ${formatInt(construction.workforce)}명 / 일할 수 있는 인원 ${formatInt(constructionLaborAvailable(settlement))}명 / 지난번 배정 ${formatInt(construction.assigned)}명 (인원이 0이면 공사가 진행되지 않습니다)`);

    const report = settlement.economy.report;
    setText(parts.report, report.day > 0
      ? `${report.day}일차: 세금 ${formatAmount(report.taxesCollected)}, 임금 ${formatAmount(report.wagesPaid)}, 식량 소비 ${formatAmount(report.foodEaten)}, 생산 가치 ${formatAmount(report.productionValue)}`
      : '아직 하루가 지나지 않았습니다.');
  }

  // state: the current game state. settlementId: the settlement the group stands in, or null.
  function update(state, settlementId) {
    if (settlementId === null || !getSettlement(state, settlementId)) {
      if (!root.hidden) root.hidden = true;
      currentId = null;
      signature = '';
      return;
    }
    const settlement = getSettlement(state, settlementId);
    const next = JSON.stringify(settlement);
    if (currentId !== settlementId) {
      currentId = settlementId;
      signature = '';
      root.classList.remove('collapsed');
      toggle.setAttribute('aria-expanded', 'true');
      setText(toggle, '접기');
      workforceInput.value = String(settlement.construction.workforce);
      say('', '');
    }
    root.hidden = false;
    if (next === signature) return;
    signature = next;
    render(state, settlement);
  }

  function run(label, change, success) {
    const result = campaign.store.transact(label, change);
    if (result.ok) say('ok', success(result));
    else say('error', describeFailure(result));
    // Redraw at once instead of waiting for the next frame.
    signature = '';
    update(campaign.getState(), currentId);
    return result;
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || currentId === null) return;
    const settlementId = currentId;
    if (target.dataset.action === 'enqueue') {
      const buildingId = select.value;
      run('enqueue construction', (draft) => enqueueConstruction(draft, { settlementId, buildingId }),
        (r) => `${getBuilding(buildingId).name} Lv ${r.job.targetLevel} 건설을 대기열에 넣었습니다. 비용 ${formatCost(r.job.cost)}을(를) 지불했습니다.`);
    } else if (target.dataset.action === 'cancel') {
      const jobId = target.dataset.jobId;
      run('cancel construction', (draft) => cancelConstruction(draft, { settlementId, jobId }),
        (r) => `건설을 취소했습니다. 돌려받은 것: ${formatCost(r.refunded)}${r.cancelled.length > 1 ? ` (뒤따르는 단계 ${r.cancelled.length - 1}건도 함께 취소)` : ''}`);
    } else if (target.dataset.action === 'workforce') {
      const text = workforceInput.value.trim();
      const workforce = text === '' ? Number.NaN : Number(text);
      run('set construction workforce', (draft) => setConstructionWorkforce(draft, { settlementId, workforce }),
        (r) => `건설 인원을 ${formatInt(r.workforce)}명으로 정했습니다.`);
    }
  });
  select.addEventListener('change', () => {
    if (currentId !== null) renderPreview(campaign.getState(), getSettlement(campaign.getState(), currentId));
  });

  return { update, say };
}

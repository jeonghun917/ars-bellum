// The enemy lord's spoken lines. Cosmetic only: the decision is already made (see diplomacy.js)
// and a generated line that contradicts it is thrown away for the stock line.
//
// Generated lines are OFF unless the caller passes an API key. There is no key in this code.

const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const STOCK_LINES = Object.freeze({
  attack: '협상은 끝났다. 전열을 가다듬어라.',
  negotiated_retreat: '대가는 충분하다. 오늘은 물러나지.',
  strategic_retreat: '오늘의 싸움은 여기까지다. 후퇴한다.',
  negotiate: '아직 조건이 마음에 들지 않는군.',
});

export function defaultDialogue(decision, failed) {
  return { emotion: failed ? '침묵' : '냉정', dialogue: STOCK_LINES[decision.action] || STOCK_LINES.negotiate };
}

function amountsIn(text) {
  const found = { gold: [], food: [] };
  for (const match of String(text || '').matchAll(/(금화|식량)\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*(금화|식량)/g)) {
    const resource = match[1] || match[4];
    const value = Number((match[2] || match[3]).replace(/,/g, ''));
    (resource === '금화' ? found.gold : found.food).push(value);
  }
  return found;
}

// Accepts the model's JSON only if its line fits the decision; otherwise the stock line is used.
export function normalizeAiDialogue(raw, decision) {
  const fallback = defaultDialogue(decision, false);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const emotion = typeof raw.emotion === 'string' ? raw.emotion.trim().slice(0, 30) : fallback.emotion;
  const dialogue = typeof raw.dialogue === 'string' ? raw.dialogue.trim().slice(0, 500) : fallback.dialogue;
  let conflict = /(스파이|이중첩자|속이고|기만)/.test(dialogue);
  if (decision.action === 'attack') {
    conflict = conflict || /(후퇴|물러나|거래.*성사)/.test(dialogue);
  } else if (decision.action === 'strategic_retreat') {
    conflict = conflict || /(받았다|금화|식량|거래.*성사|공격|기습)/.test(dialogue);
  } else if (decision.action === 'negotiate') {
    conflict = conflict || /(받았다|거래.*성사|물러나겠다|후퇴한다|공격한다|기습)/.test(dialogue);
  } else if (decision.action === 'negotiated_retreat') {
    const amounts = amountsIn(dialogue);
    const offeredGold = decision.offer.gold || 0;
    const offeredFood = decision.offer.food || 0;
    const amountMismatch = amounts.gold.some((value) => value !== offeredGold)
      || amounts.food.some((value) => value !== offeredFood)
      || (amounts.gold.length > 0 && offeredGold === 0)
      || (amounts.food.length > 0 && offeredFood === 0);
    const directionReversed = /(주겠다|돌려주겠다|지급하겠다|넘기겠다)/.test(dialogue);
    conflict = conflict || amountMismatch || directionReversed || /(공격|기습|더 내라)/.test(dialogue);
  }
  if (conflict) return fallback;
  return { emotion: emotion || fallback.emotion, dialogue: dialogue || fallback.dialogue };
}

export function buildPrompt(decision, history) {
  const recent = history.map((entry) => `${entry.role}: ${entry.text}`).join('\n');
  return `[시스템] 내부 판정은 이미 확정됐다. 행동을 바꾸지 말고 감정과 대사만 JSON으로 답하라.\n확정 행동: ${decision.action}\n판정 사유: ${decision.reason}\n제안 금화: ${decision.offer.gold || 0}\n제안 식량: ${decision.offer.food || 0}\n거래 성립: ${decision.action === 'negotiated_retreat'}\n응답 형식: {"emotion":"문자열","dialogue":"문자열"}\n최근 대화:\n${recent}`;
}

// Asks the model for the lord's line. Rejects on any failure; the caller then uses the stock line.
// apiKey travels in a request header, never in the address. fetchImpl and signal are for tests and dispose.
export async function requestLordDialogue({ apiKey, decision, history, fetchImpl, signal }) {
  const body = {
    contents: [{ parts: [{ text: buildPrompt(decision, history) }] }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
  const data = await response.json();
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
    && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('invalid_ai_response');
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  return normalizeAiDialogue(JSON.parse(cleaned), decision);
}

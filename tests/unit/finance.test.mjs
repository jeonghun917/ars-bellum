import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState, PLAYER_ACCOUNT_ID, PLAYER_CHARACTER_ID, PLAYER_GROUP_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import { runDueDays } from '../../src/game/daily.js';
import {
  changeAccountOwner, changeCampaignMetrics, checkFinance, createAccount, createDebt, dailySteps, getCampaignMetrics,
  markDebtOverdue, mintFunds, moveCampaignMetrics, payDebt, recordBattleVictory, recordDebtPayment, renegotiateDebt,
  setAccountFrozen, setAuthorizedSpenders, spendFunds, transferFunds,
} from '../../src/domains/finance/index.js';

const v1NewGame = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));

const PLAYER = PLAYER_ACCOUNT_ID;
const PARTY = 'party_funds';
const CLAN = 'clan_funds';
const BOB = 'bob_purse';
const SILVER = 'bob_silver';
const BOB_ID = 'npc_bob';
const CLAN_ID = 'clan_a';

// A state with a second character, a clan, and four extra accounts holding known sums:
// the player 500 gold, the party 1000 gold, the clan 0 gold, Bob 200 gold and 50 silver.
function setup() {
  const state = newGameState();
  state.world.characters[BOB_ID] = newCharacter({ id: BOB_ID, name: 'Bob', personalAccountId: BOB });
  state.world.clans[CLAN_ID] = { id: CLAN_ID };
  const store = createStore(state, { validate: () => ({ ok: true }) });
  const opened = store.transact('open accounts', (draft) => {
    const accounts = [
      { id: PARTY, accountTypeId: 'party', ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } },
      { id: CLAN, accountTypeId: 'clan', ownerRef: { type: 'clan', id: CLAN_ID } },
      { id: BOB, accountTypeId: 'personal', ownerRef: { type: 'character', id: BOB_ID } },
      { id: SILVER, accountTypeId: 'personal', ownerRef: { type: 'character', id: BOB_ID }, currencyId: 'silver' },
    ];
    for (const account of accounts) {
      const created = createAccount(draft, account);
      if (!created.ok) return created;
    }
    for (const [accountId, amount, currencyId] of [[PARTY, 1000], [BOB, 200], [SILVER, 50]]) {
      const minted = mintFunds(draft, { accountId, amount, reasonTypeId: 'test_setup', currencyId });
      if (!minted.ok) return minted;
    }
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  // From here every transaction is checked with the real state checks, as the game does.
  return createStore(clone(store.getState()), { validate: validateState });
}

const money = (store, id) => store.getState().world.finance.accounts[id].balance;
const total = (store, currencyId = 'gold') => Object.values(store.getState().world.finance.accounts)
  .filter((account) => account.currencyId === currencyId)
  .reduce((sum, account) => sum + account.balance, 0);

// A rule that fails must leave the draft it was given exactly as it was, and the store unchanged.
function refuses(store, rule, code) {
  const before = clone(store.getState());
  let draftChanged = false;
  const result = store.transact('refused', (draft) => {
    const snapshot = clone(draft);
    const outcome = rule(draft);
    draftChanged = JSON.stringify(draft) !== JSON.stringify(snapshot);
    return outcome;
  });
  assert.equal(result.ok, false, `expected a failure, got ${JSON.stringify(result)}`);
  if (code) assert.equal(result.error, code, JSON.stringify(result));
  assert.equal(draftChanged, false, 'the failed rule changed its draft');
  assert.deepEqual(store.getState(), before);
  return result;
}

function succeeds(store, rule) {
  const result = store.transact('rule', rule);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

// ------------------------------------------------------------------ stored records

test('[finance.records.new-game-valid] the new-game finance records pass the finance check', () => {
  const state = newGameState();
  assert.deepEqual(checkFinance(state), { ok: true });
  assert.deepEqual(validateState(state), { ok: true });
  assert.deepEqual(getCampaignMetrics(state, PLAYER), { manpower: 0, territory: 0 });
});

test('[finance.records.v1-save-valid] the finance records of an earlier-version save pass the finance check unchanged', () => {
  const stored = v1NewGame.gameState.world.finance;
  assert.deepEqual(stored.accounts[PLAYER].customData, { m18CampaignMetrics: { manpower: 0, territory: 0, version: 1 } });
  const migrated = migrateV1Envelope(clone(v1NewGame));
  assert.equal(migrated.ok, true);
  assert.deepEqual(migrated.state.world.finance, stored);
  assert.deepEqual(checkFinance(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
});

test('[finance.records.bad-records-refused] records the earlier version would not save are refused', () => {
  const broken = (change) => {
    const state = setup().getState();
    const copy = clone(state);
    change(copy.world.finance, copy);
    return checkFinance(copy);
  };
  const cases = {
    'negative balance': (f) => { f.accounts[BOB].balance = -1; },
    'fractional balance': (f) => { f.accounts[BOB].balance = 1.5; },
    'unknown account type': (f) => { f.accounts[BOB].accountTypeId = 'secret'; },
    'owner type not allowed for the account type': (f) => { f.accounts[BOB].accountTypeId = 'clan'; },
    'owner record missing': (f) => { f.accounts[BOB].ownerRef = { type: 'character', id: 'nobody' }; },
    'unknown legal regime': (f) => { f.accounts[BOB].legalRegimeId = 'anarchy'; },
    'duplicate spenders': (f) => { f.accounts[BOB].authorizedSpenders = ['npc_bob', 'npc_bob']; },
    'frozen not a boolean': (f) => { f.accounts[BOB].frozen = 'no'; },
    'record id differs from its key': (f) => { f.accounts[BOB].id = 'someone_else'; },
    'extra campaign metrics holder': (f) => { f.accounts[BOB].customData.m18CampaignMetrics = { version: 1, manpower: 0, territory: 0 }; },
    'bad campaign metrics shape': (f) => { f.accounts[PLAYER].customData.m18CampaignMetrics.extra = 1; },
    'player account without campaign metrics': (f) => { delete f.accounts[PLAYER].customData.m18CampaignMetrics; },
    'transfer with an unknown account': (f) => { f.transfers.t1 = { ...transferRecord(), toAccountId: 'ghost' }; },
    'transfer with no endpoint': (f) => { f.transfers.t1 = { ...transferRecord(), fromAccountId: null, toAccountId: null }; },
    'transfer to the same account': (f) => { f.transfers.t1 = { ...transferRecord(), fromAccountId: BOB, toAccountId: BOB }; },
    'transfer currency differs from its account': (f) => { f.transfers.t1 = { ...transferRecord(), currencyId: 'silver' }; },
    'transfer of zero': (f) => { f.transfers.t1 = { ...transferRecord(), amount: 0 }; },
    'emergency transfer without audit': (f) => { f.transfers.t1 = { ...transferRecord(), emergency: true, audit: null }; },
    'account of a newer version': (f) => { f.accounts[BOB].version = 2; },
    'transfer of a newer version': (f) => { f.transfers.t1 = { ...transferRecord(), version: 2 }; },
    'debt of a newer version': (f) => { f.debts.d1 = { ...debtRecord(), version: 2 }; },
    'two transfers sharing an idempotency key': (f) => {
      f.transfers.t1 = { ...transferRecord(), idempotencyKey: 'same' };
      f.transfers.t2 = { ...transferRecord(), id: 't2', idempotencyKey: 'same' };
    },
    'debt paid with money outstanding': (f) => { f.debts.d1 = { ...debtRecord(), status: 'paid' }; },
    'debt with unknown debtor': (f) => { f.debts.d1 = { ...debtRecord(), debtorRef: { type: 'character', id: 'nobody' } }; },
    'debt payment naming a missing transfer': (f) => { f.debts.d1 = { ...debtRecord(), paymentTransactionIds: ['t9'] }; },
  };
  assert.deepEqual(broken(() => {}), { ok: true });
  for (const [name, change] of Object.entries(cases)) {
    assert.equal(broken(change).ok, false, `${name} should be refused`);
  }
});

function transferRecord() {
  return {
    id: 't1', version: 1, revision: 0, fromAccountId: PARTY, toAccountId: BOB, currencyId: 'gold', amount: 5,
    reasonTypeId: 'test', sourceRef: null, customData: {}, emergency: false, audit: null, idempotencyKey: null, createdDay: null,
  };
}

function debtRecord() {
  return {
    id: 'd1', version: 1, revision: 0, creditorRef: { type: 'character', id: BOB_ID }, debtorRef: { type: 'character', id: PLAYER_CHARACTER_ID },
    guarantors: [], collateral: [], principal: 100, outstandingPrincipal: 100, currencyId: 'gold', interestRate: 0, dueDay: null,
    status: 'active', purposeId: null, debtTypeId: 'currency_debt', settlementMethodId: 'currency_transfer', obligationTerms: {},
    customData: {}, paymentTransactionIds: [],
  };
}

// ------------------------------------------------------------------ accounts

test('[finance.account.create] an account opens empty for an owner that exists and may hold it', () => {
  const store = setup();
  const result = succeeds(store, (d) => createAccount(d, { id: 'bob_second', accountTypeId: 'personal', ownerRef: { type: 'character', id: BOB_ID }, reserveTarget: 20 }));
  assert.equal(result.accountId, 'bob_second');
  const account = store.getState().world.finance.accounts.bob_second;
  assert.equal(account.balance, 0);
  assert.equal(account.currencyId, 'gold');
  assert.equal(account.reserveTarget, 20);
  assert.equal(account.frozen, false);
  assert.deepEqual(account.authorizedSpenders, []);
  assert.equal(account.revision, 0);
});

test('[finance.account.create-refused] a bad account is refused and nothing changes', () => {
  const store = setup();
  const good = { id: 'bob_second', accountTypeId: 'personal', ownerRef: { type: 'character', id: BOB_ID } };
  refuses(store, (d) => createAccount(d, null), 'finance_invalid_input');
  refuses(store, (d) => createAccount(d, { ...good, id: 'Bad Id' }), 'finance_invalid_account_id');
  refuses(store, (d) => createAccount(d, { ...good, id: BOB }), 'finance_duplicate_account_id');
  refuses(store, (d) => createAccount(d, { ...good, accountTypeId: 'secret' }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, accountTypeId: 'clan' }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, ownerRef: { type: 'character', id: 'nobody' } }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, ownerRef: { type: 'title', id: 'x' } }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, ownerRef: 'bob' }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, currencyId: 'Gold Coins' }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, reserveTarget: -1 }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, reserveTarget: 1.5 }), 'finance_invalid_account');
  refuses(store, (d) => createAccount(d, { ...good, legalRegimeId: 'anarchy' }), 'finance_invalid_account');
});

test('[finance.account.owner-change] ownership moves only to an existing record that may own an account of that type', () => {
  const store = setup();
  succeeds(store, (d) => changeAccountOwner(d, { accountId: PARTY, ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } }) && createAccount(d, { id: 'spare', accountTypeId: 'personal', ownerRef: { type: 'character', id: BOB_ID } }));
  succeeds(store, (d) => changeAccountOwner(d, { accountId: 'spare', ownerRef: { type: 'character', id: PLAYER_CHARACTER_ID } }));
  assert.deepEqual(store.getState().world.finance.accounts.spare.ownerRef, { id: PLAYER_CHARACTER_ID, type: 'character' });
  assert.equal(store.getState().world.finance.accounts.spare.revision, 1);
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'spare', ownerRef: { type: 'character', id: PLAYER_CHARACTER_ID } }), 'finance_no_change');
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'nope', ownerRef: { type: 'character', id: BOB_ID } }), 'finance_account_missing');
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'spare', ownerRef: { type: 'character', id: 'nobody' } }), 'finance_owner_missing');
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'spare', ownerRef: { type: 'title', id: 'x' } }), 'finance_invalid_owner');
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'spare', ownerRef: { type: 'clan', id: CLAN_ID } }), 'finance_invalid_account');
  refuses(store, (d) => changeAccountOwner(d, { accountId: 'spare' }), 'finance_invalid_owner');
});

test('[finance.account.frozen] a frozen account neither pays nor receives until it is unfrozen', () => {
  const store = setup();
  succeeds(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: true }));
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 5, reasonTypeId: 'wages' }), 'finance_account_frozen');
  refuses(store, (d) => transferFunds(d, { fromAccountId: BOB, toAccountId: PARTY, amount: 5, reasonTypeId: 'gift' }), 'finance_account_frozen');
  refuses(store, (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: BOB, amount: 5, reasonTypeId: 'gift' }), 'finance_account_frozen');
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: 5, reasonTypeId: 'loot' }), 'finance_account_frozen');
  refuses(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: true }), 'finance_no_change');
  refuses(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: 'yes' }), 'finance_invalid_input');
  refuses(store, (d) => setAccountFrozen(d, { accountId: 'nope', frozen: true }), 'finance_account_missing');
  succeeds(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: false }));
  succeeds(store, (d) => spendFunds(d, { accountId: BOB, amount: 5, reasonTypeId: 'wages' }));
  assert.equal(money(store, BOB), 195);
});

test('[finance.account.spenders] only the owner or an authorized spender may move money out of an account', () => {
  const store = setup();
  refuses(store, (d) => spendFunds(d, { accountId: PARTY, amount: 10, reasonTypeId: 'wages', spenderId: BOB_ID }), 'finance_spender_not_authorized');
  succeeds(store, (d) => setAuthorizedSpenders(d, { accountId: PARTY, spenderIds: [BOB_ID, PLAYER_CHARACTER_ID] }));
  assert.deepEqual(store.getState().world.finance.accounts[PARTY].authorizedSpenders, [PLAYER_CHARACTER_ID, BOB_ID].sort());
  succeeds(store, (d) => spendFunds(d, { accountId: PARTY, amount: 10, reasonTypeId: 'wages', spenderId: BOB_ID }));
  // The owner of a personal account may always spend from it; a stranger may not.
  succeeds(store, (d) => spendFunds(d, { accountId: BOB, amount: 10, reasonTypeId: 'wages', spenderId: BOB_ID }));
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 10, reasonTypeId: 'wages', spenderId: PLAYER_CHARACTER_ID }), 'finance_spender_not_authorized');
  refuses(store, (d) => transferFunds(d, { fromAccountId: BOB, toAccountId: PARTY, amount: 10, reasonTypeId: 'gift', spenderId: PLAYER_CHARACTER_ID }), 'finance_spender_not_authorized');
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 10, reasonTypeId: 'wages', spenderId: 'Not An Id' }), 'finance_invalid_input');
  // Receiving money needs no permission.
  succeeds(store, (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: BOB, amount: 10, reasonTypeId: 'gift', spenderId: BOB_ID }));
  refuses(store, (d) => setAuthorizedSpenders(d, { accountId: PARTY, spenderIds: ['nobody'] }), 'finance_spender_missing');
  refuses(store, (d) => setAuthorizedSpenders(d, { accountId: PARTY, spenderIds: [BOB_ID, BOB_ID] }), 'finance_invalid_input');
  refuses(store, (d) => setAuthorizedSpenders(d, { accountId: PARTY, spenderIds: 'bob' }), 'finance_invalid_input');
  refuses(store, (d) => setAuthorizedSpenders(d, { accountId: 'nope', spenderIds: [] }), 'finance_account_missing');
});

// ------------------------------------------------------------------ transfers

test('[finance.transfer.moves-money] a transfer moves the amount, keeps the total and leaves one record', () => {
  const store = setup();
  const before = total(store);
  const result = succeeds(store, (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: CLAN, amount: 300, reasonTypeId: 'tribute', sourceRef: { type: 'character', id: BOB_ID } }));
  assert.equal(money(store, PARTY), 700);
  assert.equal(money(store, CLAN), 300);
  assert.equal(total(store), before);
  const record = store.getState().world.finance.transfers[result.transferId];
  assert.deepEqual(record, {
    id: result.transferId, version: 1, revision: 0, fromAccountId: PARTY, toAccountId: CLAN, currencyId: 'gold', amount: 300,
    reasonTypeId: 'tribute', sourceRef: { id: BOB_ID, type: 'character' }, customData: {}, emergency: false, audit: null,
    idempotencyKey: null, createdDay: 1,
  });
  const { accounts } = store.getState().world.finance;
  assert.equal(accounts[PARTY].lastTransactionId, result.transferId);
  assert.equal(accounts[CLAN].lastTransactionId, result.transferId);
  assert.equal(accounts[PARTY].revision, 2);
  // Two transfers never share an id.
  const second = succeeds(store, (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: CLAN, amount: 1, reasonTypeId: 'tribute' }));
  assert.notEqual(second.transferId, result.transferId);
});

test('[finance.transfer.all-or-nothing] a transfer that cannot complete changes no account and writes no record', () => {
  const store = setup();
  const send = (extra) => (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: CLAN, amount: 10, reasonTypeId: 'tribute', ...extra });
  const invalidAmount = 'finance_invalid_amount';
  refuses(store, send({ amount: 0 }), invalidAmount);
  refuses(store, send({ amount: -5 }), invalidAmount);
  refuses(store, send({ amount: 1.5 }), invalidAmount);
  refuses(store, send({ amount: Number.NaN }), invalidAmount);
  refuses(store, send({ amount: Number.POSITIVE_INFINITY }), invalidAmount);
  refuses(store, send({ amount: '10' }), invalidAmount);
  refuses(store, send({ amount: Number.MAX_SAFE_INTEGER + 2 }), invalidAmount);
  refuses(store, send({ amount: undefined }), invalidAmount);
  refuses(store, send({ reasonTypeId: undefined }), 'finance_invalid_reason');
  refuses(store, send({ reasonTypeId: 'Not A Reason' }), 'finance_invalid_reason');
  refuses(store, send({ toAccountId: null }), 'finance_missing_endpoint');
  refuses(store, send({ fromAccountId: undefined }), 'finance_missing_endpoint');
  refuses(store, send({ toAccountId: PARTY }), 'finance_same_account');
  refuses(store, send({ toAccountId: 'ghost' }), 'finance_account_missing');
  refuses(store, send({ fromAccountId: 'ghost' }), 'finance_account_missing');
  refuses(store, send({ amount: 1001 }), 'finance_insufficient_balance');
  refuses(store, send({ toAccountId: SILVER }), 'finance_currency_mismatch');
  refuses(store, send({ currencyId: 'silver' }), 'finance_currency_mismatch');
  refuses(store, send({ emergency: 'yes' }), 'finance_invalid_input');
  refuses(store, send({ sourceRef: 'battle' }), 'finance_invalid_input');
  refuses(store, send({ customData: [] }), 'finance_invalid_input');
  refuses(store, send({ idempotencyKey: '' }), 'finance_invalid_input');
  refuses(store, send({ transferId: 'Bad Id' }), 'finance_invalid_input');
  refuses(store, (d) => transferFunds(d, null), 'finance_invalid_input');
  succeeds(store, send({ transferId: 'fixed_id' }));
  refuses(store, send({ transferId: 'fixed_id' }), 'finance_duplicate_transfer_id');
  // Only the three set-up deposits and the one accepted transfer are on record.
  assert.equal(Object.keys(store.getState().world.finance.transfers).length, 4);
});

test('[finance.transfer.no-negative-balance] an account can pay out everything it has but never more', () => {
  const store = setup();
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 201, reasonTypeId: 'wages' }), 'finance_insufficient_balance');
  refuses(store, (d) => transferFunds(d, { fromAccountId: BOB, toAccountId: PARTY, amount: 201, reasonTypeId: 'gift' }), 'finance_insufficient_balance');
  succeeds(store, (d) => spendFunds(d, { accountId: BOB, amount: 200, reasonTypeId: 'wages' }));
  assert.equal(money(store, BOB), 0);
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 1, reasonTypeId: 'wages' }), 'finance_insufficient_balance');
});

test('[finance.transfer.currency-match] money never moves between accounts of different currencies', () => {
  const store = setup();
  refuses(store, (d) => transferFunds(d, { fromAccountId: BOB, toAccountId: SILVER, amount: 5, reasonTypeId: 'exchange' }), 'finance_currency_mismatch');
  refuses(store, (d) => transferFunds(d, { fromAccountId: SILVER, toAccountId: BOB, amount: 5, reasonTypeId: 'exchange' }), 'finance_currency_mismatch');
  succeeds(store, (d) => spendFunds(d, { accountId: SILVER, amount: 5, reasonTypeId: 'toll', currencyId: 'silver' }));
  refuses(store, (d) => spendFunds(d, { accountId: SILVER, amount: 5, reasonTypeId: 'toll', currencyId: 'gold' }), 'finance_currency_mismatch');
  assert.equal(total(store, 'silver'), 45);
  assert.equal(total(store, 'gold'), 1700);
});

test('[finance.transfer.reserve-emergency] an account keeps its reserve unless the payment is marked an emergency', () => {
  const store = setup();
  succeeds(store, (d) => {
    const next = d.world.finance.accounts[PARTY];
    next.reserveTarget = 900;
  });
  refuses(store, (d) => spendFunds(d, { accountId: PARTY, amount: 101, reasonTypeId: 'wages' }), 'finance_reserve_violation');
  succeeds(store, (d) => spendFunds(d, { accountId: PARTY, amount: 100, reasonTypeId: 'wages' }));
  const emergency = succeeds(store, (d) => spendFunds(d, { accountId: PARTY, amount: 50, reasonTypeId: 'ransom', emergency: true }));
  const record = store.getState().world.finance.transfers[emergency.transferId];
  assert.equal(record.emergency, true);
  assert.deepEqual(record.audit, { required: true, status: 'pending' });
  assert.equal(money(store, PARTY), 850);
  // An emergency can dip below the reserve but still cannot overdraw.
  refuses(store, (d) => spendFunds(d, { accountId: PARTY, amount: 851, reasonTypeId: 'ransom', emergency: true }), 'finance_insufficient_balance');
});

test('[finance.transfer.idempotent] repeating a request with the same key pays once, a different request under that key is refused', () => {
  const store = setup();
  const plan = { fromAccountId: PARTY, toAccountId: CLAN, amount: 40, reasonTypeId: 'tribute', idempotencyKey: 'tribute:day1' };
  const first = succeeds(store, (d) => transferFunds(d, plan));
  const revision = store.getState().revision;
  const again = succeeds(store, (d) => transferFunds(d, plan));
  assert.equal(again.replayed, true);
  assert.equal(again.transferId, first.transferId);
  assert.equal(money(store, CLAN), 40);
  assert.equal(Object.keys(store.getState().world.finance.transfers).length, 4);
  assert.equal(store.getState().revision, revision + 1);
  refuses(store, (d) => transferFunds(d, { ...plan, amount: 41 }), 'finance_idempotency_conflict');
  refuses(store, (d) => transferFunds(d, { ...plan, toAccountId: BOB }), 'finance_idempotency_conflict');
});

test('[finance.transfer.budget-policy] a budget policy given by the caller can refuse a payment, and a failing policy refuses it too', () => {
  const store = setup();
  succeeds(store, (d) => { d.world.finance.accounts[PARTY].budgetPolicyId = 'no_wages'; });
  const reject = { budgetPolicies: { no_wages: (account, plan) => (plan.reasonTypeId === 'wages' ? 'wages_frozen' : true) } };
  const throwing = { budgetPolicies: { no_wages: () => { throw new Error('policy broke'); } } };
  refuses(store, (d) => spendFunds(d, { accountId: PARTY, amount: 5, reasonTypeId: 'wages' }, reject), 'finance_policy_rejected');
  refuses(store, (d) => spendFunds(d, { accountId: PARTY, amount: 5, reasonTypeId: 'wages' }, throwing), 'finance_policy_failed');
  succeeds(store, (d) => spendFunds(d, { accountId: PARTY, amount: 5, reasonTypeId: 'supplies' }, reject));
  // The policy only judges money going out.
  succeeds(store, (d) => mintFunds(d, { accountId: PARTY, amount: 5, reasonTypeId: 'wages' }, reject));
});

test('[finance.transfer.overflow-refused] an account cannot be pushed past the largest whole number', () => {
  const store = setup();
  succeeds(store, (d) => { d.world.finance.accounts[CLAN].balance = Number.MAX_SAFE_INTEGER - 5; });
  refuses(store, (d) => mintFunds(d, { accountId: CLAN, amount: 6, reasonTypeId: 'loot' }), 'finance_balance_overflow');
  refuses(store, (d) => transferFunds(d, { fromAccountId: PARTY, toAccountId: CLAN, amount: 6, reasonTypeId: 'gift' }), 'finance_balance_overflow');
  succeeds(store, (d) => mintFunds(d, { accountId: CLAN, amount: 5, reasonTypeId: 'loot' }));
});

// ------------------------------------------------------------------ minting and spending

test('[finance.mint.reason-recorded] minted and spent money leaves a record naming its reason and the account', () => {
  const store = setup();
  const minted = succeeds(store, (d) => mintFunds(d, { accountId: BOB, amount: 25, reasonTypeId: 'ransom', sourceRef: { type: 'character', id: PLAYER_CHARACTER_ID } }));
  const spent = succeeds(store, (d) => spendFunds(d, { accountId: BOB, amount: 5, reasonTypeId: 'wages' }));
  const { transfers } = store.getState().world.finance;
  assert.equal(transfers[minted.transferId].fromAccountId, null);
  assert.equal(transfers[minted.transferId].toAccountId, BOB);
  assert.equal(transfers[minted.transferId].reasonTypeId, 'ransom');
  assert.equal(transfers[spent.transferId].fromAccountId, BOB);
  assert.equal(transfers[spent.transferId].toAccountId, null);
  assert.equal(transfers[spent.transferId].reasonTypeId, 'wages');
  assert.equal(money(store, BOB), 220);
});

test('[finance.mint.invalid-refused] minting or spending without a valid account, amount or reason changes nothing', () => {
  const store = setup();
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: 5 }), 'finance_invalid_reason');
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: 5, reasonTypeId: '' }), 'finance_invalid_reason');
  refuses(store, (d) => mintFunds(d, { amount: 5, reasonTypeId: 'loot' }), 'finance_missing_endpoint');
  refuses(store, (d) => mintFunds(d, { accountId: 'ghost', amount: 5, reasonTypeId: 'loot' }), 'finance_account_missing');
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: 0, reasonTypeId: 'loot' }), 'finance_invalid_amount');
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: 2.5, reasonTypeId: 'loot' }), 'finance_invalid_amount');
  refuses(store, (d) => mintFunds(d, { accountId: BOB, amount: -5, reasonTypeId: 'loot' }), 'finance_invalid_amount');
  refuses(store, (d) => mintFunds(d, null), 'finance_missing_endpoint');
  refuses(store, (d) => spendFunds(d, { accountId: BOB, amount: 5 }), 'finance_invalid_reason');
  refuses(store, (d) => spendFunds(d, { amount: 5, reasonTypeId: 'wages' }), 'finance_missing_endpoint');
  refuses(store, (d) => spendFunds(d, { accountId: 'ghost', amount: 5, reasonTypeId: 'wages' }), 'finance_account_missing');
});

// ------------------------------------------------------------------ campaign metrics

test('[finance.metrics.change] manpower and territory change by whole numbers, never below zero, in the stored shape', () => {
  const store = setup();
  const result = succeeds(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: 7, territoryDelta: 2 }));
  assert.deepEqual([result.manpower, result.territory], [7, 2]);
  assert.deepEqual(store.getState().world.finance.accounts[PLAYER].customData, { m18CampaignMetrics: { manpower: 7, territory: 2, version: 1 } });
  succeeds(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: -7 }));
  assert.deepEqual(getCampaignMetrics(store.getState(), PLAYER), { manpower: 0, territory: 2 });
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: -1 }), 'finance_metric_out_of_range');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: 3, territoryDelta: -3 }), 'finance_metric_out_of_range');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: 1.5 }), 'finance_invalid_metric_delta');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: Number.NaN }), 'finance_invalid_metric_delta');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, territoryDelta: '1' }), 'finance_invalid_metric_delta');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER }), 'finance_no_change');
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: 'ghost', manpowerDelta: 1 }), 'finance_account_missing');
  refuses(store, (d) => changeCampaignMetrics(d, null), 'finance_invalid_input');
  // Only the account of the character the player controls carries the metrics.
  refuses(store, (d) => changeCampaignMetrics(d, { accountId: BOB, manpowerDelta: 1 }), 'finance_metrics_wrong_account');
});

test('[finance.metrics.follow-control] when control passes to another character the metrics move to that character\'s account', () => {
  const store = setup();
  succeeds(store, (d) => changeCampaignMetrics(d, { accountId: PLAYER, manpowerDelta: 4, territoryDelta: 1 }));
  // Without the move the state would be refused: the controlled character's account has none.
  const unmoved = store.transact('switch only', (d) => { d.playerControl.currentCharacterId = BOB_ID; });
  assert.equal(unmoved.error, 'store_state_invalid');
  assert.equal(store.getState().playerControl.currentCharacterId, PLAYER_CHARACTER_ID);
  succeeds(store, (d) => {
    d.playerControl.currentCharacterId = BOB_ID;
    return moveCampaignMetrics(d, { fromAccountId: PLAYER, toAccountId: BOB });
  });
  assert.deepEqual(getCampaignMetrics(store.getState(), BOB), { manpower: 4, territory: 1 });
  assert.equal(getCampaignMetrics(store.getState(), PLAYER), null);
  refuses(store, (d) => moveCampaignMetrics(d, { fromAccountId: PLAYER, toAccountId: BOB }), 'finance_metrics_missing');
  refuses(store, (d) => moveCampaignMetrics(d, { fromAccountId: BOB, toAccountId: BOB }), 'finance_same_account');
  refuses(store, (d) => moveCampaignMetrics(d, { fromAccountId: BOB, toAccountId: 'ghost' }), 'finance_account_missing');
  refuses(store, (d) => moveCampaignMetrics(d, { fromAccountId: 'ghost', toAccountId: BOB }), 'finance_account_missing');
  refuses(store, (d) => moveCampaignMetrics(d, null), 'finance_invalid_input');
});

test('[finance.victory.all-or-nothing] a battle victory adds loot, manpower and territory together or not at all', () => {
  const store = setup();
  const result = succeeds(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 1700, manpower: 12, territory: 1, sourceRef: { type: 'character', id: PLAYER_CHARACTER_ID } }));
  const state = store.getState();
  assert.equal(money(store, PLAYER), 2200);
  assert.deepEqual(getCampaignMetrics(state, PLAYER), { manpower: 12, territory: 1 });
  assert.equal(state.world.finance.transfers[result.transferId].reasonTypeId, 'battle_victory');
  assert.equal(state.world.finance.transfers[result.transferId].amount, 1700);
  assert.equal(state.world.finance.accounts[PLAYER].lastTransactionId, result.transferId);
  // Gold is minted through the ledger, but the whole victory is one step for the account.
  assert.equal(state.world.finance.accounts[PLAYER].revision, 1);
  const goldOnly = succeeds(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 5 }));
  assert.equal(store.getState().world.finance.transfers[goldOnly.transferId].amount, 5);
  const metricsOnly = succeeds(store, (d) => recordBattleVictory(d, { accountId: PLAYER, territory: 1 }));
  assert.equal(metricsOnly.transferId, null);
  assert.deepEqual(getCampaignMetrics(store.getState(), PLAYER), { manpower: 12, territory: 2 });

  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER }), 'finance_no_change');
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: -1 }), 'finance_invalid_amount');
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 1.5 }), 'finance_invalid_amount');
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, manpower: Number.NaN }), 'finance_invalid_amount');
  refuses(store, (d) => recordBattleVictory(d, { accountId: 'ghost', gold: 5 }), 'finance_account_missing');
  refuses(store, (d) => recordBattleVictory(d, { accountId: BOB, gold: 5 }), 'finance_metrics_wrong_account');
  refuses(store, (d) => recordBattleVictory(d, null), 'finance_invalid_input');
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 5, sourceRef: 'x' }), 'finance_invalid_input');
  // Metrics that would pass the largest whole number refuse the whole victory, loot included.
  succeeds(store, (d) => { d.world.finance.accounts[PLAYER].customData.m18CampaignMetrics.manpower = Number.MAX_SAFE_INTEGER - 1; });
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 100, manpower: 5 }), 'finance_metric_out_of_range');
  succeeds(store, (d) => { d.world.finance.accounts[PLAYER].customData.m18CampaignMetrics.manpower = 12; });
  // Loot that cannot be banked (frozen account) must not leave the manpower or territory behind.
  succeeds(store, (d) => setAccountFrozen(d, { accountId: PLAYER, frozen: true }));
  refuses(store, (d) => recordBattleVictory(d, { accountId: PLAYER, gold: 100, manpower: 3, territory: 1 }), 'finance_account_frozen');
  assert.deepEqual(getCampaignMetrics(store.getState(), PLAYER), { manpower: 12, territory: 2 });
});

// ------------------------------------------------------------------ debts

const owes = (extra = {}) => ({
  id: 'debt_one', creditorRef: { type: 'character', id: BOB_ID }, debtorRef: { type: 'character', id: PLAYER_CHARACTER_ID }, principal: 300, ...extra,
});

test('[finance.debt.create] a debt records who owes whom and how much, and starts unpaid', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ dueDay: 5, interestRate: 0.1, purposeId: 'equipment' })));
  const debt = store.getState().world.finance.debts.debt_one;
  assert.equal(debt.outstandingPrincipal, 300);
  assert.equal(debt.status, 'active');
  assert.equal(debt.currencyId, 'gold');
  assert.equal(debt.dueDay, 5);
  assert.deepEqual(debt.paymentTransactionIds, []);
  assert.equal(debt.debtTypeId, 'currency_debt');
});

test('[finance.debt.create-refused] a debt with a bad amount, party or type is refused and nothing changes', () => {
  const store = setup();
  refuses(store, (d) => createDebt(d, null), 'finance_invalid_input');
  refuses(store, (d) => createDebt(d, owes({ id: 'Bad Id' })), 'finance_invalid_debt_id');
  refuses(store, (d) => createDebt(d, owes({ principal: 0 })), 'finance_invalid_amount');
  refuses(store, (d) => createDebt(d, owes({ principal: 10.5 })), 'finance_invalid_amount');
  refuses(store, (d) => createDebt(d, owes({ principal: -1 })), 'finance_invalid_amount');
  refuses(store, (d) => createDebt(d, owes({ creditorRef: { type: 'character', id: 'nobody' } })), 'finance_invalid_debt');
  refuses(store, (d) => createDebt(d, owes({ debtorRef: null })), 'finance_invalid_debt');
  refuses(store, (d) => createDebt(d, owes({ debtorRef: { type: 'character', id: BOB_ID } })), 'finance_debt_self_owed');
  refuses(store, (d) => createDebt(d, owes({ debtTypeId: 'barter' })), 'finance_invalid_debt');
  refuses(store, (d) => createDebt(d, owes({ settlementMethodId: 'barter' })), 'finance_invalid_debt');
  refuses(store, (d) => createDebt(d, owes({ interestRate: -0.5 })), 'finance_invalid_debt');
  refuses(store, (d) => createDebt(d, owes({ dueDay: -1 })), 'finance_invalid_debt');
  succeeds(store, (d) => createDebt(d, owes()));
  refuses(store, (d) => createDebt(d, owes()), 'finance_duplicate_debt_id');
});

test('[finance.debt.payment] paying a debt moves the money and lowers what is owed; the last payment marks it paid', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes()));
  const partial = succeeds(store, (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 100 }));
  assert.equal(partial.outstandingPrincipal, 200);
  assert.equal(partial.status, 'active');
  assert.equal(money(store, PLAYER), 400);
  assert.equal(money(store, BOB), 300);
  const transfer = store.getState().world.finance.transfers[partial.transferId];
  assert.equal(transfer.reasonTypeId, 'debt_payment');
  assert.deepEqual(transfer.sourceRef, { id: 'debt_one', type: 'debt' });
  assert.deepEqual(store.getState().world.finance.debts.debt_one.paymentTransactionIds, [partial.transferId]);
  succeeds(store, (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 200 }));
  const debt = store.getState().world.finance.debts.debt_one;
  assert.equal(debt.outstandingPrincipal, 0);
  assert.equal(debt.status, 'paid');
  assert.equal(debt.revision, 2);
  refuses(store, (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 1 }), 'finance_invalid_payment_amount');
});

test('[finance.debt.payment-all-or-nothing] a payment that cannot be both made and recorded changes neither the accounts nor the debt', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes()));
  const pay = (extra) => (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 100, ...extra });
  refuses(store, pay({ amount: 301 }), 'finance_invalid_payment_amount');
  refuses(store, pay({ amount: 0 }), 'finance_invalid_amount');
  refuses(store, pay({ amount: 2.5 }), 'finance_invalid_amount');
  refuses(store, pay({ debtId: 'nope' }), 'finance_debt_missing');
  refuses(store, pay({ toAccountId: CLAN }), 'finance_payment_wrong_parties');
  refuses(store, pay({ fromAccountId: BOB, toAccountId: PLAYER }), 'finance_payment_wrong_parties');
  refuses(store, pay({ fromAccountId: PARTY }), 'finance_payment_wrong_parties');
  refuses(store, pay({ fromAccountId: 'ghost' }), 'finance_account_missing');
  refuses(store, pay({ toAccountId: SILVER }), 'finance_currency_mismatch');
  succeeds(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: true }));
  refuses(store, pay({}), 'finance_account_frozen');
  succeeds(store, (d) => setAccountFrozen(d, { accountId: BOB, frozen: false }));
  succeeds(store, (d) => spendFunds(d, { accountId: PLAYER, amount: 450, reasonTypeId: 'spree' }));
  refuses(store, pay({}), 'finance_insufficient_balance');
  assert.deepEqual(store.getState().world.finance.debts.debt_one.paymentTransactionIds, []);
  refuses(store, (d) => payDebt(d, null), 'finance_invalid_input');
});

test('[finance.debt.payment-parties] a guarantor may pay for the debtor, and a debt held in an account is paid from that account', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ id: 'guarded', guarantors: [{ type: 'character', id: BOB_ID }], creditorRef: { type: 'mobile_group', id: PLAYER_GROUP_ID }, debtorRef: { type: 'clan', id: CLAN_ID } })));
  refuses(store, (d) => payDebt(d, { debtId: 'guarded', fromAccountId: PLAYER, toAccountId: PARTY, amount: 10 }), 'finance_payment_wrong_parties');
  succeeds(store, (d) => payDebt(d, { debtId: 'guarded', fromAccountId: BOB, toAccountId: PARTY, amount: 10 }));
  assert.equal(store.getState().world.finance.debts.guarded.outstandingPrincipal, 290);
});

test('[finance.debt.record-payment] an earlier transfer counts as a payment once, for the right parties and currency', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes()));
  succeeds(store, (d) => createDebt(d, owes({ id: 'debt_two' })));
  const made = succeeds(store, (d) => transferFunds(d, { fromAccountId: PLAYER, toAccountId: BOB, amount: 50, reasonTypeId: 'repayment' }));
  const stray = succeeds(store, (d) => transferFunds(d, { fromAccountId: PLAYER, toAccountId: CLAN, amount: 50, reasonTypeId: 'gift' }));
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: stray.transferId }), 'finance_payment_wrong_parties');
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: 'nope' }), 'finance_transfer_missing');
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'nope', transferId: made.transferId }), 'finance_debt_missing');
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: made.transferId, amount: 51 }), 'finance_invalid_payment_amount');
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: made.transferId, amount: 0 }), 'finance_invalid_payment_amount');
  succeeds(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: made.transferId, amount: 20 }));
  assert.equal(store.getState().world.finance.debts.debt_one.outstandingPrincipal, 280);
  // Recording the same payment on the same debt again changes nothing; using it for another debt is refused.
  const revision = store.getState().revision;
  const replay = succeeds(store, (d) => recordDebtPayment(d, { debtId: 'debt_one', transferId: made.transferId }));
  assert.equal(replay.replayed, true);
  assert.equal(store.getState().world.finance.debts.debt_one.outstandingPrincipal, 280);
  assert.equal(store.getState().revision, revision + 1);
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'debt_two', transferId: made.transferId }), 'finance_transfer_already_used');
});

test('[finance.debt.currency-match] a debt is paid only in its own currency', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ id: 'silver_debt', currencyId: 'silver', creditorRef: { type: 'character', id: BOB_ID }, debtorRef: { type: 'character', id: PLAYER_CHARACTER_ID } })));
  succeeds(store, (d) => createAccount(d, { id: 'player_silver', accountTypeId: 'personal', ownerRef: { type: 'character', id: PLAYER_CHARACTER_ID }, currencyId: 'silver' }));
  succeeds(store, (d) => mintFunds(d, { accountId: 'player_silver', amount: 100, reasonTypeId: 'test_setup' }));
  // Gold accounts cannot pay a silver debt, whether the money moves with the payment or before it.
  refuses(store, (d) => payDebt(d, { debtId: 'silver_debt', fromAccountId: PLAYER, toAccountId: BOB, amount: 50 }), 'finance_currency_mismatch');
  const gold = succeeds(store, (d) => transferFunds(d, { fromAccountId: PLAYER, toAccountId: BOB, amount: 50, reasonTypeId: 'repayment' }));
  refuses(store, (d) => recordDebtPayment(d, { debtId: 'silver_debt', transferId: gold.transferId }), 'finance_currency_mismatch');
  succeeds(store, (d) => payDebt(d, { debtId: 'silver_debt', fromAccountId: 'player_silver', toAccountId: SILVER, amount: 50 }));
  assert.equal(store.getState().world.finance.debts.silver_debt.outstandingPrincipal, 250);
});

test('[finance.debt.overdue] a debt becomes overdue only after its due day, and a paid debt never does', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ dueDay: 3 })));
  succeeds(store, (d) => createDebt(d, owes({ id: 'no_due_day' })));
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }), 'finance_debt_not_overdue');
  succeeds(store, (d) => { d.calendar.day = 3; });
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }), 'finance_debt_not_overdue');
  succeeds(store, (d) => { d.calendar.day = 4; });
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'no_due_day' }), 'finance_debt_not_overdue');
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'nope' }), 'finance_debt_missing');
  succeeds(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }));
  assert.equal(store.getState().world.finance.debts.debt_one.status, 'overdue');
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }), 'finance_debt_not_overdue');
  // Paying an overdue debt in full settles it.
  succeeds(store, (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 300 }));
  assert.equal(store.getState().world.finance.debts.debt_one.status, 'paid');
  refuses(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }), 'finance_debt_not_overdue');
});

test('[finance.debt.renegotiate] only the terms of an unpaid debt can change', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ dueDay: 3 })));
  succeeds(store, (d) => { d.calendar.day = 10; });
  succeeds(store, (d) => markDebtOverdue(d, { debtId: 'debt_one' }));
  // A new due day still in the past leaves it overdue; one in the future makes it current again.
  succeeds(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', dueDay: 8, interestRate: 0.2 }));
  assert.equal(store.getState().world.finance.debts.debt_one.status, 'overdue');
  succeeds(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', dueDay: 20, obligationTerms: { grace: true } }));
  const debt = store.getState().world.finance.debts.debt_one;
  assert.equal(debt.status, 'active');
  assert.equal(debt.interestRate, 0.2);
  assert.deepEqual(debt.obligationTerms, { grace: true });
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', principal: 1 }), 'finance_invalid_input');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', status: 'paid' }), 'finance_invalid_input');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', outstandingPrincipal: 0 }), 'finance_invalid_input');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one' }), 'finance_no_change');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', dueDay: -4 }), 'finance_invalid_debt');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', interestRate: -1 }), 'finance_invalid_debt');
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'nope', dueDay: 5 }), 'finance_debt_missing');
  succeeds(store, (d) => payDebt(d, { debtId: 'debt_one', fromAccountId: PLAYER, toAccountId: BOB, amount: 300 }));
  refuses(store, (d) => renegotiateDebt(d, { debtId: 'debt_one', dueDay: 30 }), 'finance_debt_paid');
});

test('[finance.debt.daily-overdue] the daily step marks debts overdue once their due day has ended', () => {
  const store = setup();
  succeeds(store, (d) => createDebt(d, owes({ dueDay: 2 })));
  succeeds(store, (d) => createDebt(d, owes({ id: 'next_day', dueDay: 3 })));
  succeeds(store, (d) => createDebt(d, owes({ id: 'later', dueDay: 6 })));
  succeeds(store, (d) => createDebt(d, owes({ id: 'open_ended' })));
  // It is day 3: days 1 and 2 have ended, so only the debt due on day 2 is late.
  succeeds(store, (d) => { d.calendar.day = 3; });
  assert.deepEqual(runDueDays(store, dailySteps).processed, [1, 2]);
  const status = () => Object.fromEntries(Object.values(store.getState().world.finance.debts).map((debt) => [debt.id, debt.status]));
  assert.deepEqual(status(), { debt_one: 'overdue', next_day: 'active', later: 'active', open_ended: 'active' });
  // A debt paid in full before its day ended is left alone.
  succeeds(store, (d) => payDebt(d, { debtId: 'later', fromAccountId: PLAYER, toAccountId: BOB, amount: 300 }));
  succeeds(store, (d) => { d.calendar.day = 9; });
  runDueDays(store, dailySteps);
  assert.deepEqual(status(), { debt_one: 'overdue', next_day: 'overdue', later: 'paid', open_ended: 'active' });
});

// ------------------------------------------------------------------ definitions

// A custom definition is saved in world.customDefinitions; it counts only once approved.
const customAccountType = (definitionData, approvalStatus) => ({
  domainId: 'account_type', definitionId: 'guild_chest', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
  approvalStatus, approvedByRef: null, definitionData: { id: 'guild_chest', ...definitionData }, revision: 0,
});

test('[finance.definitions.custom-account-type] an approved custom account type can be used, a merely proposed one cannot', () => {
  const store = setup();
  const data = { allowedOwnerTypeIds: ['clan'], capabilityTags: ['guild'] };
  succeeds(store, (d) => { d.world.customDefinitions.records['account_type:guild_chest'] = customAccountType(data, 'pending'); });
  const open = (d) => createAccount(d, { id: 'guild_one', accountTypeId: 'guild_chest', ownerRef: { type: 'clan', id: CLAN_ID } });
  refuses(store, open, 'finance_invalid_account');
  succeeds(store, (d) => { d.world.customDefinitions.records['account_type:guild_chest'].approvalStatus = 'approved'; });
  succeeds(store, open);
  assert.equal(store.getState().world.finance.accounts.guild_one.accountTypeId, 'guild_chest');
  // The custom type only allows the owner types it names.
  refuses(store, (d) => createAccount(d, { id: 'guild_two', accountTypeId: 'guild_chest', ownerRef: { type: 'character', id: BOB_ID } }), 'finance_invalid_account');
  // A custom type naming an owner type that does not exist is not a valid save.
  const bad = store.transact('bad type', (d) => { d.world.customDefinitions.records['account_type:guild_chest'] = customAccountType({ allowedOwnerTypeIds: ['ghost'] }, 'approved'); });
  assert.equal(bad.error, 'store_state_invalid');
});

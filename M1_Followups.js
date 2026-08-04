// Ars Bellum M1-7 - Persistent event follow-up ledger and single daily orchestration
(function () {
    "use strict";

    const VERSION = 1;
    const INPUT_SCHEMA = "m17.followup_input.v1";
    const SEMANTIC_SCHEMA = "m17.semantic_delta.v1";
    const FOLLOWUP_DAILY_BUDGET = 64;
    const NPC_DAILY_BUDGET = 128;
    const CATCH_UP_DAY_LIMIT = 30;
    const HANDLERS = Object.freeze(["m17.relationship", "m17.memory", "m17.activity", "m17.no_handler"]);
    const EVENT_PAIRS = Object.freeze([
        ["clan_state_changed", "m17.followup.clan_state_changed"],
        ["faction_state_changed", "m17.followup.faction_state_changed"],
        ["title_state_changed", "m17.followup.title_state_changed"],
        ["settlement_rights_changed", "m17.followup.settlement_rights_changed"],
        ["succession_resolved", "m17.followup.succession_resolved"],
        ["player_control_changed", "m17.followup.player_control_changed"]
    ]);
    const runtime = { initialized: false, coordinatorPairs: [], clockUnsubscribe: null, blockingError: null };
    const M17_FOLLOWUP_FAILURE_INJECTION = {
        memoryAfterFirstEffect: false,
        activityAfterProfileBeforeCursor: false,
        afterEffectBeforeLedgerApplied: false,
        ledgerVerifyMismatch: false,
        rollbackFail: false,
        initListenerNumber: 0,
        initClockSubscribe: false
    };
    let initializationError = null;

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function validId(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value); }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function inputDigest(value) { return "sha256:" + window.ArsM1AtomicCoordinator._sha256(canonical(value)); }
    function world() { return window.ArsGameState.getState().world; }
    function root() { return world().m1Followups; }
    function fail(error, detail) { return { ok: false, error: error, detail: detail == null ? null : clone(detail) }; }
    function success(value) { return Object.assign({ ok: true }, value || {}); }
    function isEmptyObject(value) { return plain(value) && Object.keys(value).length === 0; }
    function sortedUnique(values) { return Array.from(new Set((Array.isArray(values) ? values : []).filter(validId))).sort(); }
    function defaultOrchestration() {
        return { lastOrchestratedDay: 0, catchUpTargetDay: null, cursorDay: null, cursorPhase: null, followupCursorKey: null, activityProcessedCharacterIds: [] };
    }
    function emptyRoot() { return { version: VERSION, revision: 0, maxRecords: 8192, records: {}, orchestration: defaultOrchestration() }; }
    function recordKey(sourceEventId, handlerId) { return sourceEventId + "::" + handlerId; }
    function cursorKey(record) { return canonical([record.nextAttemptDay, record.sourceEventId, record.handlerId]); }
    function parseCursorKey(value) {
        if (typeof value !== "string") { return null; }
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed) || parsed.length !== 3 || !Number.isInteger(parsed[0]) || parsed[0] < 0 || !validId(parsed[1]) || HANDLERS.indexOf(parsed[2]) < 0 || canonical(parsed) !== value) { return null; }
            return parsed;
        } catch (ignored) { return null; }
    }
    function recordAfterCursor(record, value) {
        if (value === null) { return true; }
        const parsed = parseCursorKey(value);
        if (!parsed) { return false; }
        return record.nextAttemptDay > parsed[0] ||
            (record.nextAttemptDay === parsed[0] && record.sourceEventId > parsed[1]) ||
            (record.nextAttemptDay === parsed[0] && record.sourceEventId === parsed[1] && record.handlerId > parsed[2]);
    }

    function validateOrchestration(value) {
        if (!plain(value) || !Number.isInteger(value.lastOrchestratedDay) || value.lastOrchestratedDay < 0) { return false; }
        for (const key of ["catchUpTargetDay", "cursorDay"]) {
            if (value[key] !== null && (!Number.isInteger(value[key]) || value[key] < 0)) { return false; }
        }
        if ([null, "followups", "activity"].indexOf(value.cursorPhase) < 0) { return false; }
        if (value.followupCursorKey !== null && !parseCursorKey(value.followupCursorKey)) { return false; }
        if (!Array.isArray(value.activityProcessedCharacterIds) || canonical(value.activityProcessedCharacterIds) !== canonical(sortedUnique(value.activityProcessedCharacterIds))) { return false; }
        const active = value.cursorDay !== null || value.catchUpTargetDay !== null || value.cursorPhase !== null;
        if (active && (value.cursorDay === null || value.catchUpTargetDay === null || value.cursorPhase === null || value.cursorDay > value.catchUpTargetDay)) { return false; }
        if (!active && (value.followupCursorKey !== null || value.activityProcessedCharacterIds.length !== 0)) { return false; }
        return true;
    }
    function validateRecord(record, key, verifyDigest) {
        if (!plain(record) || key !== recordKey(record.sourceEventId, record.handlerId)) { return false; }
        if (!validId(record.sourceEventId) || !validId(record.sourceEventType) || !validId(record.transactionId) || typeof record.planDigest !== "string" || !Number.isInteger(record.sequence) || record.sequence < 0) { return false; }
        if (HANDLERS.indexOf(record.handlerId) < 0 || record.handlerSchemaVersion !== 1 || ["pending", "applied", "failed", "quarantined"].indexOf(record.status) < 0) { return false; }
        if (!Number.isInteger(record.attemptCount) || record.attemptCount < 0 || !Number.isInteger(record.nextAttemptDay) || record.nextAttemptDay < 0) { return false; }
        if (!plain(record.normalizedFollowupInput) || typeof record.inputDigest !== "string" || !Number.isInteger(record.createdDay) || record.createdDay < 0 || !Number.isInteger(record.updatedDay) || record.updatedDay < record.createdDay || !Number.isInteger(record.revision) || record.revision < 0) { return false; }
        if (verifyDigest && inputDigest(record.normalizedFollowupInput) !== record.inputDigest) { return false; }
        const source = record.normalizedFollowupInput.source || {};
        if (record.normalizedFollowupInput.eventDay !== record.createdDay || !Array.isArray(record.normalizedFollowupInput.expectedRefs) || !Array.isArray(record.normalizedFollowupInput.effects)) { return false; }
        if (source.eventId !== record.sourceEventId || source.eventType !== record.sourceEventType || source.transactionId !== record.transactionId || source.planDigest !== record.planDigest || source.sequence !== record.sequence) { return false; }
        if (record.status !== "quarantined" && !normalizedHeaderValid(record.normalizedFollowupInput)) { return false; }
        if (record.status === "pending" && record.resultCode !== null) { return false; }
        if (record.status === "failed" && (record.attemptCount < 1 || record.resultCode !== "handler_failed" || typeof record.lastError !== "string")) { return false; }
        if (record.status === "applied" && typeof record.resultCode !== "string") { return false; }
        if (record.status === "quarantined" && (typeof record.resultCode !== "string" || typeof record.lastError !== "string")) { return false; }
        if (record.handlerId === "m17.no_handler" && record.status === "applied" && (record.resultCode !== "no_handler" || record.attemptCount !== 0 || record.normalizedFollowupInput.effects.length !== 0)) { return false; }
        return true;
    }
    function validateRoot(value, verifyDigests) {
        if (!plain(value) || value.version !== VERSION || !Number.isInteger(value.revision) || value.revision < 0 || !Number.isInteger(value.maxRecords) || value.maxRecords < 1 || !plain(value.records) || !validateOrchestration(value.orchestration)) { return false; }
        const keys = Object.keys(value.records);
        if (keys.length > value.maxRecords) { return false; }
        return keys.every(function (key) { const record=value.records[key]; return validateRecord(record, key, verifyDigests !== false && record.status !== "quarantined"); });
    }
    function ensureRoot() {
        const existing = root();
        if (existing == null || isEmptyObject(existing)) {
            world().m1Followups = emptyRoot(); initializationError = null; return success({ followupRoot: clone(root()) });
        }
        if (!plain(existing)) { initializationError = "m17_followup_unknown_root"; return fail(initializationError); }
        if (Number.isInteger(existing.version) && existing.version > VERSION) { initializationError = "m17_followup_unsupported_future_version"; return fail(initializationError); }
        if (!validateRoot(existing, false)) { initializationError = "m17_followup_unknown_root"; return fail(initializationError); }
        initializationError = null; return success({ followupRoot: clone(existing) });
    }
    function ready() {
        if (runtime.blockingError) { return fail(runtime.blockingError, { blocking: true }); }
        return initializationError ? fail(initializationError) : success();
    }

    function get(sourceEventId, handlerId) {
        const key = recordKey(sourceEventId, handlerId);
        return ready().ok && root().records[key] ? clone(root().records[key]) : null;
    }
    function getSnapshot() { return ready().ok ? clone(root()) : null; }

    function deltaField(delta, field) {
        const changes = delta && Array.isArray(delta.changes) ? delta.changes : [];
        if (!changes.length) { return { before: null, after: null }; }
        const change = changes[0] || {};
        return {
            before: change.before && Object.prototype.hasOwnProperty.call(change.before, field) ? clone(change.before[field]) : null,
            after: change.after && Object.prototype.hasOwnProperty.call(change.after, field) ? clone(change.after[field]) : null
        };
    }
    function characterRefId(value) { return value && value.type === "character" && validId(value.id) ? value.id : null; }
    function semanticHeaderValid(event, delta) {
        if (!plain(delta) || delta.schemaVersion !== SEMANTIC_SCHEMA || !validId(delta.domainId) || !validId(delta.command) || !plain(delta.targetRef) || !validId(delta.targetRef.type) || !validId(delta.targetRef.id) || !Array.isArray(delta.changes)) { return false; }
        const payload = event.payload || {};
        const targetFields = {
            clan_state_changed: ["clan", "clanId"],
            faction_state_changed: ["faction", "factionId"],
            title_state_changed: ["title", "titleId"],
            settlement_rights_changed: ["land_right", "landRightId"],
            player_control_changed: ["player_control", null]
        };
        const targetContract = targetFields[event.eventType] || null;
        if (targetContract && (delta.domainId !== targetContract[0] || delta.targetRef.type !== targetContract[0])) { return false; }
        if (targetContract && targetContract[1] && payload[targetContract[1]] !== delta.targetRef.id) { return false; }
        if (event.eventType === "player_control_changed" && delta.targetRef.id !== "singleton") { return false; }
        if (Object.prototype.hasOwnProperty.call(payload, "command") && payload.command !== delta.command) { return false; }
        if (Object.prototype.hasOwnProperty.call(payload, "beforeRevision") && payload.beforeRevision !== delta.beforeRevision) { return false; }
        if (Object.prototype.hasOwnProperty.call(payload, "afterRevision") && payload.afterRevision !== delta.afterRevision) { return false; }
        return true;
    }
    function normalizedHeaderValid(normalized) {
        if (!plain(normalized) || normalized.schemaVersion !== INPUT_SCHEMA || !plain(normalized.source) || !plain(normalized.semanticDelta)) { return false; }
        const source = normalized.source, delta = normalized.semanticDelta;
        if (delta.schemaVersion !== SEMANTIC_SCHEMA || !validId(delta.domainId) || !validId(delta.command) || !plain(delta.targetRef) || !validId(delta.targetRef.type) || !validId(delta.targetRef.id) || !Array.isArray(delta.changes)) { return false; }
        return source.command === delta.command && canonical(source.targetRef) === canonical(delta.targetRef) && source.beforeRevision === delta.beforeRevision && source.afterRevision === delta.afterRevision;
    }
    function validateEvent(event) {
        return plain(event) && validId(event.eventId) && validId(event.eventType) && validId(event.transactionId) && typeof event.planDigest === "string" && Number.isInteger(event.sequence) && event.sequence >= 0 && plain(event.payload || {});
    }
    function inferHandler(normalized) {
        const effects = normalized && Array.isArray(normalized.effects) ? normalized.effects : [];
        if (!effects.length) { return "m17.no_handler"; }
        const types = sortedUnique(effects.map(function (effect) { return effect && effect.type; }));
        if (types.length !== 1) { return null; }
        if (types[0] === "memory_create") { return "m17.memory"; }
        if (types[0] === "activity_roles") { return "m17.activity"; }
        if (types[0] === "relationship_delta") { return "m17.relationship"; }
        return null;
    }
    function expectedRefsForEffects(effects, sourceEventId, eventDay) {
        if (!Array.isArray(effects)) { return fail("m17_followup_header_mismatch"); }
        const refsByKey = {};
        function addRef(type, id) {
            if (!validId(type) || !validId(id)) { return false; }
            refsByKey[type + ":" + id] = { type: type, id: id };
            return true;
        }
        for (const effect of effects) {
            if (!plain(effect) || effect.sourceEventId !== sourceEventId || effect.eventDay !== eventDay) { return fail("m17_followup_header_mismatch"); }
            if (effect.type === "activity_roles") {
                if (!Array.isArray(effect.effects) || !effect.effects.length) { return fail("m17_followup_header_mismatch"); }
                for (const item of effect.effects) {
                    if (!plain(item) || !addRef("character", item.characterId) || !Array.isArray(item.addRoleKeys) || !Array.isArray(item.removeRoleKeys)) { return fail("m17_followup_header_mismatch"); }
                }
            } else if (effect.type === "memory_create") {
                if (!addRef("character", effect.ownerCharacterId) || !Array.isArray(effect.targetCharacterIds)) { return fail("m17_followup_header_mismatch"); }
                for (const id of effect.targetCharacterIds) { if (!addRef("character", id)) { return fail("m17_followup_header_mismatch"); } }
            } else if (effect.type === "relationship_delta") {
                if (!addRef("character", effect.fromCharacterId) || !addRef("character", effect.toCharacterId) || !plain(effect.deltas) || !validId(effect.reasonId)) { return fail("m17_followup_header_mismatch"); }
            } else { return fail("m17_followup_header_mismatch"); }
        }
        return success({ expectedRefs: Object.keys(refsByKey).sort().map(function (key) { return refsByKey[key]; }) });
    }

    function buildEffects(event, handlerId, eventDay, delta) {
        const payload = event.payload || {};
        const effects = [];
        if (handlerId === "m17.no_handler") { return effects; }
        if (handlerId === "m17.activity") {
            let oldId = null, newId = null, roleKey = null;
            if (event.eventType === "clan_state_changed") {
                const field = deltaField(delta, "headCharacterId"); oldId = field.before; newId = field.after; roleKey = "role:clan_head:" + delta.targetRef.id;
            } else if (event.eventType === "faction_state_changed") {
                const field = deltaField(delta, "rulerCharacterId"); oldId = field.before; newId = field.after; roleKey = "role:faction_ruler:" + delta.targetRef.id;
            } else if (event.eventType === "title_state_changed") {
                const field = deltaField(delta, "holderRef"); oldId = characterRefId(field.before); newId = characterRefId(field.after); roleKey = "role:title_holder:" + delta.targetRef.id;
            } else if (event.eventType === "player_control_changed") {
                const field = deltaField(delta, "currentCharacterId"); oldId = field.before; newId = field.after; roleKey = "role:player_control:campaign";
            }
            if (oldId !== newId && roleKey) {
                const byCharacter = {};
                if (validId(oldId)) { byCharacter[oldId] = { characterId: oldId, addRoleKeys: [], removeRoleKeys: [roleKey] }; }
                if (validId(newId)) {
                    if (!byCharacter[newId]) { byCharacter[newId] = { characterId: newId, addRoleKeys: [], removeRoleKeys: [] }; }
                    byCharacter[newId].addRoleKeys.push(roleKey);
                }
                const roleEffects = Object.keys(byCharacter).sort().map(function (id) {
                    byCharacter[id].addRoleKeys = sortedUnique(byCharacter[id].addRoleKeys);
                    byCharacter[id].removeRoleKeys = sortedUnique(byCharacter[id].removeRoleKeys);
                    return byCharacter[id];
                });
                if (roleEffects.length) { effects.push({ type: "activity_roles", sourceEventId: event.eventId, eventDay: eventDay, effects: roleEffects }); }
            }
        } else if (handlerId === "m17.memory" && event.eventType === "title_state_changed") {
            const field = deltaField(delta, "holderRef");
            const oldId = characterRefId(field.before), newId = characterRefId(field.after);
            if (oldId !== newId) {
                if (oldId) { effects.push({ type: "memory_create", ownerCharacterId: oldId, targetCharacterIds: newId ? [newId] : [], memoryTypeId: "title_revoked", eventDay: eventDay, importance: 800, knowledge: "public", decayPolicyId: "permanent", sourceEventId: event.eventId, payload: { titleId: delta.targetRef.id } }); }
                if (newId) { effects.push({ type: "memory_create", ownerCharacterId: newId, targetCharacterIds: oldId ? [oldId] : [], memoryTypeId: "title_granted", eventDay: eventDay, importance: 800, knowledge: "public", decayPolicyId: "permanent", sourceEventId: event.eventId, payload: { titleId: delta.targetRef.id } }); }
            }
        }
        return effects;
    }
    function handlersForEvent(event, eventDay) {
        if (event.eventType === "settlement_rights_changed" || event.eventType === "succession_resolved") { return ["m17.no_handler"]; }
        const delta = event.payload && event.payload.semanticDelta;
        if (!semanticHeaderValid(event, delta)) { return ["m17.no_handler"]; }
        const handlers = [];
        if (["clan_state_changed", "faction_state_changed", "title_state_changed", "player_control_changed"].indexOf(event.eventType) >= 0) {
            if (buildEffects(event, "m17.activity", eventDay, delta).length) { handlers.push("m17.activity"); }
        }
        if (event.eventType === "title_state_changed" && buildEffects(event, "m17.memory", eventDay, delta).length) { handlers.push("m17.memory"); }
        return handlers.length ? handlers.sort() : ["m17.no_handler"];
    }
    function normalizeFromEvent(event, handlerId, eventDay) {
        if (!validateEvent(event) || HANDLERS.indexOf(handlerId) < 0 || !Number.isInteger(eventDay) || eventDay < 0) { return fail("m17_followup_invalid_event"); }
        const payload = event.payload || {};
        let delta = payload.semanticDelta || null;
        if (event.eventType === "succession_resolved") {
            delta = {
                schemaVersion: SEMANTIC_SCHEMA,
                domainId: "succession",
                command: "succession.resolve",
                targetRef: { type: "character", id: String(payload.decedentCharacterId || "resolution") },
                beforeRevision: null,
                afterRevision: null,
                changes: [],
                successionPayload: clone({ cause: payload.cause, currentDay: payload.currentDay, decedentCharacterId: payload.decedentCharacterId, resultTagIds: payload.resultTagIds || [], resolution: payload.resolution || {} })
            };
        }
        if (handlerId !== "m17.no_handler" && !semanticHeaderValid(event, delta)) { return fail("m17_followup_header_mismatch"); }
        if (!delta) {
            delta = { schemaVersion: SEMANTIC_SCHEMA, domainId: "event", command: String(payload.command || event.eventType), targetRef: { type: "event", id: event.eventId }, beforeRevision: null, afterRevision: null, changes: [] };
        }
        const effects = buildEffects(event, handlerId, eventDay, delta);
        if (handlerId !== "m17.no_handler" && effects.length === 0) { return fail("m17_followup_invalid_input"); }
        const expected = expectedRefsForEffects(effects, event.eventId, eventDay);
        if (!expected.ok) { return expected; }
        const normalized = {
            schemaVersion: INPUT_SCHEMA,
            eventDay: eventDay,
            source: {
                eventId: event.eventId,
                eventType: event.eventType,
                transactionId: event.transactionId,
                planDigest: event.planDigest,
                sequence: event.sequence,
                command: String(delta.command || payload.command || event.eventType),
                targetRef: clone(delta.targetRef),
                beforeRevision: Object.prototype.hasOwnProperty.call(payload, "beforeRevision") ? payload.beforeRevision : (Object.prototype.hasOwnProperty.call(delta, "beforeRevision") ? delta.beforeRevision : null),
                afterRevision: Object.prototype.hasOwnProperty.call(payload, "afterRevision") ? payload.afterRevision : (Object.prototype.hasOwnProperty.call(delta, "afterRevision") ? delta.afterRevision : null)
            },
            semanticKind: event.eventType.replace(/_state_changed$/, "_changed"),
            semanticDelta: clone(delta),
            expectedRefs: expected.expectedRefs,
            effects: clone(effects)
        };
        return success({ normalizedFollowupInput: normalized, inputDigest: inputDigest(normalized), handlerId: handlerId });
    }

    function immutableMatches(record, normalized, digestValue, handlerId) {
        const source = normalized.source || {};
        return record.sourceEventId === source.eventId && record.sourceEventType === source.eventType && record.transactionId === source.transactionId && record.planDigest === source.planDigest && record.sequence === source.sequence && record.handlerId === handlerId && record.handlerSchemaVersion === 1 && record.inputDigest === digestValue && canonical(record.normalizedFollowupInput) === canonical(normalized) && record.createdDay === normalized.eventDay;
    }
    function enqueueNormalized(normalizedFollowupInput, suppliedDigest, eventDay, explicitHandlerId) {
        const r = ready(); if (!r.ok) { return r; }
        const normalized = clone(normalizedFollowupInput || {});
        if (!plain(normalized) || normalized.schemaVersion !== INPUT_SCHEMA || normalized.eventDay !== eventDay || !Number.isInteger(eventDay) || eventDay < 0 || inputDigest(normalized) !== suppliedDigest) { return fail("m17_followup_digest_mismatch"); }
        if (!normalizedHeaderValid(normalized)) { return fail("m17_followup_header_mismatch"); }
        const handlerId = explicitHandlerId || inferHandler(normalized);
        if (HANDLERS.indexOf(handlerId) < 0) { return fail("m17_followup_invalid_input"); }
        const source = normalized.source || {};
        if (!validId(source.eventId) || !validId(source.eventType) || !validId(source.transactionId) || typeof source.planDigest !== "string" || !Number.isInteger(source.sequence)) { return fail("m17_followup_invalid_input"); }
        if (inferHandler(normalized) !== handlerId) { return fail("m17_followup_header_mismatch"); }
        const expected = expectedRefsForEffects(normalized.effects, source.eventId, eventDay);
        if (!expected.ok || canonical(expected.expectedRefs) !== canonical(normalized.expectedRefs)) { return fail("m17_followup_header_mismatch"); }
        const key = recordKey(source.eventId, handlerId), existing = root().records[key] || null;
        if (existing) {
            if (immutableMatches(existing, normalized, suppliedDigest, handlerId)) { return success({ record: clone(existing), idempotent: true, recordKey: key }); }
            const beforeRoot = clone(root()), nextRoot = clone(root()), record = nextRoot.records[key];
            if (["pending", "failed"].indexOf(record.status) >= 0) {
                record.status = "quarantined"; record.resultCode = "immutable_conflict"; record.lastError = "m17_followup_header_mismatch"; record.updatedDay = eventDay; record.revision += 1; nextRoot.revision += 1;
                world().m1Followups = nextRoot;
                if (!validateRoot(root(), false)) { world().m1Followups = beforeRoot; return fail("m17_followup_root_invariant_failed"); }
                return success({ record: clone(root().records[key]), quarantined: true, errorCode: "m17_followup_header_mismatch", recordKey: key });
            }
            return fail("m17_followup_header_mismatch", { recordKey: key, existingStatus: record.status });
        }
        if (Object.keys(root().records).length >= root().maxRecords) { return fail("m17_followup_capacity_exceeded"); }
        const noHandler = handlerId === "m17.no_handler";
        const record = {
            sourceEventId: source.eventId,
            sourceEventType: source.eventType,
            transactionId: source.transactionId,
            planDigest: source.planDigest,
            sequence: source.sequence,
            handlerId: handlerId,
            handlerSchemaVersion: 1,
            status: noHandler ? "applied" : "pending",
            resultCode: noHandler ? "no_handler" : null,
            attemptCount: 0,
            nextAttemptDay: eventDay,
            lastError: null,
            normalizedFollowupInput: normalized,
            inputDigest: suppliedDigest,
            createdDay: eventDay,
            updatedDay: eventDay,
            revision: 0
        };
        const beforeRoot = clone(root()), nextRoot = clone(root());
        nextRoot.records[key] = record; nextRoot.revision += 1;
        world().m1Followups = nextRoot;
        if (!validateRoot(root(), true)) { world().m1Followups = beforeRoot; return fail("m17_followup_root_invariant_failed"); }
        return success({ record: clone(record), idempotent: false, recordKey: key, rootRevisionBefore: beforeRoot.revision, rootRevisionAfter: nextRoot.revision });
    }

    function quarantineIncomingEvent(event, eventDay, errorCode) {
        const payload = event.payload || {}, delta = plain(payload.semanticDelta) ? clone(payload.semanticDelta) : {
            schemaVersion: SEMANTIC_SCHEMA,
            domainId: "event",
            command: String(payload.command || event.eventType),
            targetRef: { type: "event", id: event.eventId },
            beforeRevision: Object.prototype.hasOwnProperty.call(payload, "beforeRevision") ? payload.beforeRevision : null,
            afterRevision: Object.prototype.hasOwnProperty.call(payload, "afterRevision") ? payload.afterRevision : null,
            changes: []
        };
        const normalized = {
            schemaVersion: INPUT_SCHEMA,
            eventDay: eventDay,
            source: {
                eventId: event.eventId,
                eventType: event.eventType,
                transactionId: event.transactionId,
                planDigest: event.planDigest,
                sequence: event.sequence,
                command: String(payload.command || delta.command || event.eventType),
                targetRef: plain(delta.targetRef) ? clone(delta.targetRef) : { type: "event", id: event.eventId },
                beforeRevision: Object.prototype.hasOwnProperty.call(payload, "beforeRevision") ? payload.beforeRevision : (Object.prototype.hasOwnProperty.call(delta, "beforeRevision") ? delta.beforeRevision : null),
                afterRevision: Object.prototype.hasOwnProperty.call(payload, "afterRevision") ? payload.afterRevision : (Object.prototype.hasOwnProperty.call(delta, "afterRevision") ? delta.afterRevision : null)
            },
            semanticKind: event.eventType.replace(/_state_changed$/, "_changed"),
            semanticDelta: delta,
            expectedRefs: [],
            effects: []
        };
        const handlerId = "m17.no_handler", key = recordKey(event.eventId, handlerId), digestValue = inputDigest(normalized), existing = root().records[key] || null;
        if (existing) {
            if (immutableMatches(existing, normalized, digestValue, handlerId) && existing.status === "quarantined") { return success({ record: clone(existing), idempotent: true, quarantined: true, recordKey: key }); }
            return fail("m17_followup_header_mismatch", { recordKey: key, existingStatus: existing.status });
        }
        if (Object.keys(root().records).length >= root().maxRecords) { return fail("m17_followup_capacity_exceeded"); }
        const record = {
            sourceEventId: event.eventId,
            sourceEventType: event.eventType,
            transactionId: event.transactionId,
            planDigest: event.planDigest,
            sequence: event.sequence,
            handlerId: handlerId,
            handlerSchemaVersion: 1,
            status: "quarantined",
            resultCode: "quarantined",
            attemptCount: 0,
            nextAttemptDay: eventDay,
            lastError: errorCode,
            normalizedFollowupInput: normalized,
            inputDigest: digestValue,
            createdDay: eventDay,
            updatedDay: eventDay,
            revision: 0
        };
        const beforeRoot = clone(root()), nextRoot = clone(root());
        nextRoot.records[key] = record; nextRoot.revision += 1;
        world().m1Followups = nextRoot;
        if (!validateRoot(root(), false)) { world().m1Followups = beforeRoot; return fail("m17_followup_root_invariant_failed"); }
        return success({ record: clone(record), idempotent: false, quarantined: true, recordKey: key, rootRevisionBefore: beforeRoot.revision, rootRevisionAfter: nextRoot.revision });
    }

    function dueRecords(cursorDay, followupCursorKey) {
        return Object.keys(root().records).map(function (key) { return root().records[key]; }).filter(function (record) {
            return ["pending", "failed"].indexOf(record.status) >= 0 && record.nextAttemptDay <= cursorDay && recordAfterCursor(record, followupCursorKey);
        }).sort(function (a, b) {
            return a.nextAttemptDay - b.nextAttemptDay || a.sourceEventId.localeCompare(b.sourceEventId) || a.handlerId.localeCompare(b.handlerId);
        });
    }
    function collectDue(cursorDay, budget, followupCursorKey) {
        if (!ready().ok || !Number.isInteger(cursorDay) || cursorDay < 0 || !Number.isInteger(budget) || budget < 0 || (followupCursorKey !== null && typeof followupCursorKey !== "string")) { return []; }
        return dueRecords(cursorDay, followupCursorKey).slice(0, budget).map(clone);
    }

    function buildRootPlan(type, sourceEventId, mutate) {
        const current = root(), next = clone(current);
        const changedRecordIds = [];
        mutate(next, changedRecordIds);
        const changed = canonical(current) !== canonical(next);
        if (changed) { next.revision = current.revision + 1; }
        return { type: type, sourceEventId: sourceEventId, rootRevisionBefore: current.revision, beforeRoot: clone(current), plannedRoot: next, changedRecordIds: changedRecordIds.sort(), idempotent: !changed };
    }
    function validateRootPlanTransition(plan) {
        if (!plain(plan) || ["followup_orchestration", "followup_status"].indexOf(plan.type) < 0 || !plain(plan.beforeRoot) || !plain(plan.plannedRoot)) { return false; }
        if (plan.beforeRoot.version !== plan.plannedRoot.version || plan.beforeRoot.maxRecords !== plan.plannedRoot.maxRecords || plan.plannedRoot.revision !== plan.beforeRoot.revision + (plan.idempotent ? 0 : 1)) { return false; }
        if (!validateRoot(plan.plannedRoot, plan.type === "followup_status")) { return false; }
        if (plan.type === "followup_orchestration") { return canonical(plan.beforeRoot.records) === canonical(plan.plannedRoot.records); }
        if (canonical(Object.keys(plan.beforeRoot.records).sort()) !== canonical(Object.keys(plan.plannedRoot.records).sort())) { return false; }
        const immutable = ["sourceEventId", "sourceEventType", "transactionId", "planDigest", "sequence", "handlerId", "handlerSchemaVersion", "normalizedFollowupInput", "inputDigest", "createdDay"];
        const allowedTransitions = {
            pending: ["applied", "failed", "quarantined"],
            failed: ["applied", "failed", "quarantined"],
            applied: [],
            quarantined: []
        };
        let changedCount = 0;
        for (const key of Object.keys(plan.beforeRoot.records)) {
            const before = plan.beforeRoot.records[key], after = plan.plannedRoot.records[key];
            if (canonical(before) === canonical(after)) { continue; }
            changedCount += 1;
            if (immutable.some(function (field) { return canonical(before[field]) !== canonical(after[field]); })) { return false; }
            if (allowedTransitions[before.status].indexOf(after.status) < 0 || after.revision !== before.revision + 1) { return false; }
        }
        return changedCount === (plan.changedRecordIds || []).length && (plan.changedRecordIds || []).every(function (key) { return plan.beforeRoot.records[key] && canonical(plan.beforeRoot.records[key]) !== canonical(plan.plannedRoot.records[key]); });
    }
    function _planOrchestrationPatch(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const input = clone(raw || {}), patch = input.patch || {};
        if (!validId(input.sourceEventId) || !plain(patch)) { return fail("m17_followup_invalid_input"); }
        const allowed = ["lastOrchestratedDay", "catchUpTargetDay", "cursorDay", "cursorPhase", "followupCursorKey", "activityProcessedCharacterIds"];
        if (Object.keys(patch).some(function (key) { return allowed.indexOf(key) < 0; })) { return fail("m17_followup_invalid_input"); }
        const plan = buildRootPlan("followup_orchestration", input.sourceEventId, function (next) {
            Object.keys(patch).forEach(function (key) { next.orchestration[key] = clone(patch[key]); });
            next.orchestration.activityProcessedCharacterIds = sortedUnique(next.orchestration.activityProcessedCharacterIds);
        });
        if (!validateOrchestration(plan.plannedRoot.orchestration)) { return fail("m17_followup_invalid_input"); }
        return success({ plan: plan });
    }
    function planRecordStatus(key, patch, orchestrationPatch, cursorDay) {
        return buildRootPlan("followup_status", "followup-status:" + key + ":" + cursorDay, function (next, changedRecordIds) {
            const record = next.records[key];
            if (!record) { return; }
            Object.keys(patch).forEach(function (field) { record[field] = clone(patch[field]); });
            record.revision += 1;
            changedRecordIds.push(key);
            Object.keys(orchestrationPatch || {}).forEach(function (field) { next.orchestration[field] = clone(orchestrationPatch[field]); });
            next.orchestration.activityProcessedCharacterIds = sortedUnique(next.orchestration.activityProcessedCharacterIds);
        });
    }
    function commitStatus(plan, expectedRevision) {
        const r = ready(); if (!r.ok) { return r; }
        if (!plain(plan) || !plain(plan.plannedRoot) || root().revision !== expectedRevision || root().revision !== plan.rootRevisionBefore || canonical(root()) !== canonical(plan.beforeRoot)) { return fail("m17_followup_revision_conflict"); }
        if (!validateRootPlanTransition(plan)) { return fail("m17_followup_invalid_transition"); }
        const beforeRoot = clone(root());
        if (!plan.idempotent) { world().m1Followups = clone(plan.plannedRoot); }
        const verified = M17_FOLLOWUP_FAILURE_INJECTION.ledgerVerifyMismatch && plan.type === "followup_status" ? fail("m17_followup_root_invariant_failed", { failureInjection: "FI-FU-LEDGER-VERIFY-MISMATCH" }) : _verifyCommitted(plan);
        if (!verified.ok) { world().m1Followups = beforeRoot; return fail("m17_followup_root_invariant_failed"); }
        return success({
            receipt: {
                sourceEventId: plan.sourceEventId,
                changedRecordIds: clone(plan.changedRecordIds || []),
                createdRecordIds: [],
                rootRevisionBefore: beforeRoot.revision,
                rootRevisionAfter: plan.idempotent ? beforeRoot.revision : plan.plannedRoot.revision,
                recordRevisions: (plan.changedRecordIds || []).map(function (key) { return { recordId: key, beforeRevision: beforeRoot.records[key] ? beforeRoot.records[key].revision : null, afterRevision: plan.plannedRoot.records[key] ? plan.plannedRoot.records[key].revision : null }; }),
                idempotent: Boolean(plan.idempotent)
            },
            rollbackToken: { beforeRoot: beforeRoot }
        });
    }
    function _commitOrchestration(plan, expectedRevision) { return commitStatus(plan, expectedRevision); }
    function _rollbackCommitted(token) {
        if (!plain(token) || !plain(token.beforeRoot)) { return fail("m17_followup_rollback_failed"); }
        world().m1Followups = clone(token.beforeRoot);
        return canonical(root()) === canonical(token.beforeRoot) ? success() : fail("m17_followup_rollback_failed");
    }
    function _verifyCommitted(plan) {
        return plain(plan) && plain(plan.plannedRoot) && canonical(root()) === canonical(plan.plannedRoot) && validateRoot(root(), plan.type === "followup_status") ? success() : fail("m17_followup_root_invariant_failed");
    }

    function validateStoredRecord(record) {
        if (!record || record.normalizedFollowupInput.schemaVersion !== INPUT_SCHEMA || record.handlerSchemaVersion !== 1) { return fail("m17_followup_schema_unsupported"); }
        if (inputDigest(record.normalizedFollowupInput) !== record.inputDigest) { return fail("m17_followup_digest_mismatch"); }
        if (!validateRecord(record, recordKey(record.sourceEventId, record.handlerId), true)) { return fail("m17_followup_header_mismatch"); }
        if (!normalizedHeaderValid(record.normalizedFollowupInput)) { return fail("m17_followup_header_mismatch"); }
        if (inferHandler(record.normalizedFollowupInput) !== record.handlerId) { return fail("m17_followup_header_mismatch"); }
        const expected = expectedRefsForEffects(record.normalizedFollowupInput.effects, record.sourceEventId, record.createdDay);
        if (!expected.ok || canonical(expected.expectedRefs) !== canonical(record.normalizedFollowupInput.expectedRefs)) { return fail("m17_followup_header_mismatch"); }
        for (const ref of record.normalizedFollowupInput.expectedRefs || []) {
            if (!plain(ref) || !validId(ref.type) || !validId(ref.id)) { return fail("m17_followup_header_mismatch"); }
            const checked = window.ArsRefRegistry.validateRef(ref, null); if (!checked.ok) { return fail("m17_followup_header_mismatch", checked.error); }
        }
        return success();
    }
    function applyEffects(record) {
        const committed = [];
        const effects = record.normalizedFollowupInput.effects || [];
        function rollbackAll() {
            const failures = [];
            if (M17_FOLLOWUP_FAILURE_INJECTION.rollbackFail) { return ["FI-FU-ROLLBACK-FAIL"]; }
            for (let i = committed.length - 1; i >= 0; i -= 1) {
                const item = committed[i];
                const rolled = item.system._rollbackCommitted(item.token);
                if (!rolled || !rolled.ok) { failures.push(item.type); }
            }
            return failures;
        }
        for (const effect of effects) {
            let system, planned, committedResult;
            if (effect.type === "relationship_delta") {
                system = window.ArsRelationshipSystem; planned = system.planDelta(effect);
            } else if (effect.type === "memory_create") {
                system = window.ArsMemorySystem; planned = system.planCreate(effect);
            } else if (effect.type === "activity_roles") {
                system = window.ArsNpcActivitySystem; planned = system._planRoleEffects(effect);
            } else {
                const failures = rollbackAll(); return fail(failures.length ? "m17_followup_rollback_failed" : "m17_followup_invalid_input", { rollbackFailures: failures });
            }
            if (!planned.ok) { const failures = rollbackAll(); return fail(failures.length ? "m17_followup_rollback_failed" : planned.error, { rollbackFailures: failures }); }
            const plan = planned.plan;
            if (effect.type === "activity_roles") { committedResult = system._commitRoleEffects(plan, plan.rootRevisionBefore); }
            else { committedResult = system.commit(plan, plan.rootRevisionBefore); }
            if (!committedResult.ok) { const failures = rollbackAll(); return fail(failures.length ? "m17_followup_rollback_failed" : committedResult.error, { rollbackFailures: failures }); }
            const verified = system._verifyCommitted(plan);
            if (!verified.ok) {
                const ownRollback = system._rollbackCommitted(committedResult.rollbackToken);
                const failures = ownRollback.ok ? rollbackAll() : [effect.type].concat(rollbackAll());
                return fail(failures.length ? "m17_followup_rollback_failed" : "m17_followup_root_invariant_failed", { rollbackFailures: failures });
            }
            committed.push({ type: effect.type, system: system, token: committedResult.rollbackToken });
            if (M17_FOLLOWUP_FAILURE_INJECTION.memoryAfterFirstEffect && effect.type === "memory_create" && committed.length === 1) {
                const failures = rollbackAll();
                return fail(failures.length ? "m17_followup_rollback_failed" : "m17_memory_verify_failed", { failureInjection: "FI-MEM-AFTER-FIRST-EFFECT", rollbackFailures: failures });
            }
        }
        return success({ committed: committed, rollbackAll: rollbackAll });
    }
    function commitOutcome(key, patch, cursorValue, cursorDay) {
        const plan = planRecordStatus(key, patch, { followupCursorKey: cursorValue }, cursorDay);
        return commitStatus(plan, plan.rootRevisionBefore);
    }
    function processRecord(record, cursorDay) {
        const key = recordKey(record.sourceEventId, record.handlerId), keyCursor = cursorKey(record);
        const validation = validateStoredRecord(record);
        if (!validation.ok) {
            const quarantined = commitOutcome(key, { status: "quarantined", resultCode: "quarantined", lastError: validation.error, updatedDay: cursorDay }, keyCursor, cursorDay);
            return quarantined.ok ? success({ status: "quarantined" }) : quarantined;
        }
        const effects = applyEffects(record);
        if (!effects.ok) {
            if (effects.error === "m17_followup_rollback_failed") {
                runtime.blockingError = "m17_followup_rollback_failed";
                return fail(runtime.blockingError, { blocking: true, cursorAdvanced: false });
            }
            const attempts = record.attemptCount + 1;
            const failed = commitOutcome(key, {
                status: "failed",
                resultCode: "handler_failed",
                attemptCount: attempts,
                nextAttemptDay: cursorDay + Math.min(Math.pow(2, attempts - 1), 30),
                lastError: effects.error,
                updatedDay: cursorDay
            }, keyCursor, cursorDay);
            return failed.ok ? success({ status: "failed" }) : failed;
        }
        if (M17_FOLLOWUP_FAILURE_INJECTION.afterEffectBeforeLedgerApplied) {
            const failures = effects.rollbackAll();
            if (failures.length) { runtime.blockingError = "m17_followup_rollback_failed"; return fail(runtime.blockingError, { blocking: true, cursorAdvanced: false }); }
            const attempts = record.attemptCount + 1;
            const injectedFailure = commitOutcome(key, { status: "failed", resultCode: "handler_failed", attemptCount: attempts, nextAttemptDay: cursorDay + Math.min(Math.pow(2, attempts - 1), 30), lastError: "FI-FU-AFTER-EFFECT-BEFORE-LEDGER-APPLIED", updatedDay: cursorDay }, keyCursor, cursorDay);
            return injectedFailure.ok ? success({ status: "failed", failureInjection: "FI-FU-AFTER-EFFECT-BEFORE-LEDGER-APPLIED" }) : injectedFailure;
        }
        const applied = commitOutcome(key, { status: "applied", resultCode: "applied", lastError: null, updatedDay: cursorDay }, keyCursor, cursorDay);
        if (!applied.ok) {
            const failures = effects.rollbackAll();
            if (failures.length) { runtime.blockingError = "m17_followup_rollback_failed"; return fail(runtime.blockingError, { blocking: true, cursorAdvanced: false }); }
            return fail(applied.error, { cursorAdvanced: false });
        }
        return success({ status: "applied" });
    }

    function runFollowupPhase(cursorDay) {
        let processed = 0;
        while (processed < FOLLOWUP_DAILY_BUDGET) {
            const orchestration = root().orchestration;
            const next = collectDue(cursorDay, 1, orchestration.followupCursorKey);
            if (!next.length) {
                const anyDue = collectDue(cursorDay, 1, null);
                if (anyDue.length && orchestration.followupCursorKey !== null) {
                    const reset = _planOrchestrationPatch({ sourceEventId: "orchestration-reset:" + cursorDay + ":" + root().revision, patch: { followupCursorKey: null } });
                    if (!reset.ok) { return reset; }
                    const committed = _commitOrchestration(reset.plan, reset.plan.rootRevisionBefore); if (!committed.ok) { return committed; }
                    continue;
                }
                const phase = _planOrchestrationPatch({ sourceEventId: "orchestration-activity:" + cursorDay + ":" + root().revision, patch: { cursorPhase: "activity", followupCursorKey: null } });
                if (!phase.ok) { return phase; }
                return _commitOrchestration(phase.plan, phase.plan.rootRevisionBefore);
            }
            const result = processRecord(next[0], cursorDay); if (!result.ok) { return result; }
            processed += 1;
        }
        return success({ budgetExhausted: collectDue(cursorDay, 1, null).length > 0, processed: processed });
    }
    function processActivityProfile(profile, cursorDay) {
        const planResult = window.ArsNpcActivitySystem._planProcessCharacter({ characterId: profile.characterId, currentDay: cursorDay });
        if (!planResult.ok) { return planResult; }
        const activityCommit = window.ArsNpcActivitySystem._commitProcessCharacter(planResult.plan, planResult.plan.rootRevisionBefore);
        if (!activityCommit.ok) { return activityCommit; }
        if (M17_FOLLOWUP_FAILURE_INJECTION.activityAfterProfileBeforeCursor) {
            const rolled = window.ArsNpcActivitySystem._rollbackCommitted(activityCommit.rollbackToken);
            if (!rolled.ok) { runtime.blockingError = "m17_followup_rollback_failed"; return fail(runtime.blockingError, { blocking: true }); }
            return fail("m17_followup_root_invariant_failed", { failureInjection: "FI-ACT-AFTER-PROFILE-BEFORE-CURSOR" });
        }
        const processedIds = sortedUnique(root().orchestration.activityProcessedCharacterIds.concat([profile.characterId]));
        const orch = _planOrchestrationPatch({ sourceEventId: "orchestration-processed:" + cursorDay + ":" + profile.characterId + ":" + root().revision, patch: { activityProcessedCharacterIds: processedIds } });
        if (!orch.ok) {
            const rolled = window.ArsNpcActivitySystem._rollbackCommitted(activityCommit.rollbackToken);
            if (!rolled.ok) { runtime.blockingError = "m17_followup_rollback_failed"; return fail(runtime.blockingError, { blocking: true }); }
            return orch;
        }
        const orchCommit = _commitOrchestration(orch.plan, orch.plan.rootRevisionBefore);
        if (!orchCommit.ok) {
            const rolled = window.ArsNpcActivitySystem._rollbackCommitted(activityCommit.rollbackToken);
            if (!rolled.ok) { runtime.blockingError = "m17_followup_rollback_failed"; return fail(runtime.blockingError, { blocking: true }); }
            return orchCommit;
        }
        return success();
    }
    function runActivityPhase(cursorDay) {
        let processed = 0;
        while (processed < NPC_DAILY_BUDGET) {
            const processedIds = root().orchestration.activityProcessedCharacterIds;
            const due = window.ArsNpcActivitySystem.collectDueCharacters(cursorDay, Number.MAX_SAFE_INTEGER).filter(function (profile) { return processedIds.indexOf(profile.characterId) < 0; });
            if (!due.length) { return success({ complete: true, processed: processed }); }
            const result = processActivityProfile(due[0], cursorDay); if (!result.ok) { return result; }
            processed += 1;
        }
        const remaining = window.ArsNpcActivitySystem.collectDueCharacters(cursorDay, Number.MAX_SAFE_INTEGER).some(function (profile) { return root().orchestration.activityProcessedCharacterIds.indexOf(profile.characterId) < 0; });
        return success({ complete: !remaining, budgetExhausted: remaining, processed: processed });
    }
    function completeDay(cursorDay) {
        const orchestration = root().orchestration;
        const patch = { lastOrchestratedDay: cursorDay, followupCursorKey: null, activityProcessedCharacterIds: [] };
        if (cursorDay < orchestration.catchUpTargetDay) {
            patch.cursorDay = cursorDay + 1; patch.cursorPhase = "followups";
        } else {
            patch.catchUpTargetDay = null; patch.cursorDay = null; patch.cursorPhase = null;
        }
        const plan = _planOrchestrationPatch({ sourceEventId: "orchestration-complete:" + cursorDay + ":" + root().revision, patch: patch });
        if (!plan.ok) { return plan; }
        return _commitOrchestration(plan.plan, plan.plan.rootRevisionBefore);
    }
    function startOrExtend(currentDay) {
        const orchestration = root().orchestration;
        if (orchestration.cursorDay === null) {
            if (currentDay <= orchestration.lastOrchestratedDay) { return success({ idempotent: true }); }
            const start = _planOrchestrationPatch({ sourceEventId: "orchestration-start:" + currentDay + ":" + root().revision, patch: {
                cursorDay: orchestration.lastOrchestratedDay + 1,
                catchUpTargetDay: currentDay,
                cursorPhase: "followups",
                followupCursorKey: null,
                activityProcessedCharacterIds: []
            } });
            if (!start.ok) { return start; }
            return _commitOrchestration(start.plan, start.plan.rootRevisionBefore);
        }
        if (currentDay > orchestration.catchUpTargetDay) {
            const extend = _planOrchestrationPatch({ sourceEventId: "orchestration-extend:" + currentDay + ":" + root().revision, patch: { catchUpTargetDay: currentDay } });
            if (!extend.ok) { return extend; }
            return _commitOrchestration(extend.plan, extend.plan.rootRevisionBefore);
        }
        return success({ idempotent: true });
    }
    function runOrchestration() {
        let completedDays = 0;
        while (root().orchestration.cursorDay !== null && completedDays < CATCH_UP_DAY_LIMIT) {
            const day = root().orchestration.cursorDay;
            if (root().orchestration.cursorPhase === "followups") {
                const followups = runFollowupPhase(day); if (!followups.ok) { return followups; }
                if (root().orchestration.cursorPhase === "followups") { return success({ incomplete: true, phase: "followups", completedDays: completedDays }); }
            }
            if (root().orchestration.cursorPhase === "activity") {
                const activity = runActivityPhase(day); if (!activity.ok) { return activity; }
                if (!activity.complete) { return success({ incomplete: true, phase: "activity", completedDays: completedDays }); }
                const finished = completeDay(day); if (!finished.ok) { return finished; }
                completedDays += 1;
            }
        }
        return success({ completedDays: completedDays, incomplete: root().orchestration.cursorDay !== null });
    }
    function drain(cursorDay) {
        const r = ready(); if (!r.ok) { return r; }
        if (!Number.isInteger(cursorDay) || cursorDay < 0) { return fail("m17_followup_invalid_input"); }
        const started = startOrExtend(cursorDay); if (!started.ok) { return started; }
        return runOrchestration();
    }

    function listener(event) {
        if (!validateEvent(event)) { throw new Error("m17_followup_invalid_event"); }
        let eventDay;
        if (event.eventType === "succession_resolved") { eventDay = event.payload.currentDay; }
        else { eventDay = window.ArsGameClock.getState().day; }
        if (!Number.isInteger(eventDay) || eventDay < 0) { throw new Error("m17_followup_invalid_event"); }
        if (event.eventType !== "succession_resolved" && !semanticHeaderValid(event, event.payload && event.payload.semanticDelta)) {
            const quarantined = quarantineIncomingEvent(event, eventDay, "m17_followup_header_mismatch");
            if (!quarantined.ok) { throw new Error(quarantined.error); }
            return;
        }
        const handlers = handlersForEvent(event, eventDay);
        handlers.forEach(function (handlerId) {
            const normalized = normalizeFromEvent(event, handlerId, eventDay);
            if (!normalized.ok) { throw new Error(normalized.error); }
            const enqueued = enqueueNormalized(normalized.normalizedFollowupInput, normalized.inputDigest, eventDay, handlerId);
            if (!enqueued.ok) { throw new Error(enqueued.error); }
        });
    }
    function clockListener(event) {
        if (!event || event.type !== "day") { return; }
        if (!Number.isInteger(event.currentDay) || event.currentDay < 0) { return; }
        const result = drain(event.currentDay);
        if (!result.ok && result.detail && result.detail.blocking) { runtime.blockingError = result.error; }
    }
    function dependencyError() {
        const required = [
            ["ArsM1AtomicCoordinator", window.ArsM1AtomicCoordinator], ["ArsGameClock", window.ArsGameClock],
            ["ArsRelationshipState", window.ArsRelationshipState], ["ArsRelationshipSystem", window.ArsRelationshipSystem],
            ["ArsMemoryState", window.ArsMemoryState], ["ArsMemorySystem", window.ArsMemorySystem],
            ["ArsNpcActivityState", window.ArsNpcActivityState], ["ArsNpcActivitySystem", window.ArsNpcActivitySystem]
        ];
        const missing = required.filter(function (item) { return !item[1]; }).map(function (item) { return item[0]; });
        return missing.length ? missing : null;
    }
    function initialize() {
        if (runtime.initialized) { return success({ initialized: true, coordinatorListeners: runtime.coordinatorPairs.length, gameClockListeners: runtime.clockUnsubscribe ? 1 : 0, newlyRegistered: 0 }); }
        const missing = dependencyError(); if (missing) { return fail("m17_followup_dependency_missing", missing); }
        const registered = [];
        try {
            EVENT_PAIRS.forEach(function (pair, index) {
                if (M17_FOLLOWUP_FAILURE_INJECTION.initListenerNumber === index + 1) { throw new Error("FI-INIT-LISTENER-" + String(index + 1)); }
                const result = window.ArsM1AtomicCoordinator.subscribe(pair[0], pair[1], listener);
                if (!result || !result.ok) { throw new Error(result && result.error || "coordinator_subscribe_failed"); }
                registered.push(pair);
            });
            if (M17_FOLLOWUP_FAILURE_INJECTION.initClockSubscribe) { throw new Error("FI-INIT-CLOCK-SUBSCRIBE"); }
            const unsubscribe = window.ArsGameClock.subscribe(clockListener);
            if (typeof unsubscribe !== "function") { throw new Error("clock_subscribe_failed"); }
            runtime.coordinatorPairs = registered.slice(); runtime.clockUnsubscribe = unsubscribe; runtime.initialized = true;
            return success({ initialized: true, coordinatorListeners: 6, gameClockListeners: 1, newlyRegistered: 7 });
        } catch (error) {
            if (runtime.clockUnsubscribe) { try { runtime.clockUnsubscribe(); } catch (ignored) {} }
            for (let i = registered.length - 1; i >= 0; i -= 1) { try { window.ArsM1AtomicCoordinator.unsubscribe(registered[i][0], registered[i][1]); } catch (ignored) {} }
            runtime.coordinatorPairs = []; runtime.clockUnsubscribe = null; runtime.initialized = false;
            return fail("m17_followup_initialization_failed", String(error && error.message || error));
        }
    }
    function diagnostics() {
        const issues = [];
        if (initializationError) { issues.push(initializationError); }
        if (runtime.blockingError) { issues.push(runtime.blockingError); }
        if (!initializationError && !validateRoot(root(), true)) { issues.push("m17_followup_root_invariant_failed"); }
        return {
            ok: issues.length === 0,
            issues: issues,
            recordCount: initializationError ? null : Object.keys(root().records).length,
            initialized: runtime.initialized,
            coordinatorListenerCount: runtime.coordinatorPairs.length,
            gameClockListenerCount: runtime.clockUnsubscribe ? 1 : 0,
            orchestration: initializationError ? null : clone(root().orchestration),
            constants: { FOLLOWUP_DAILY_BUDGET: FOLLOWUP_DAILY_BUDGET, NPC_DAILY_BUDGET: NPC_DAILY_BUDGET, CATCH_UP_DAY_LIMIT: CATCH_UP_DAY_LIMIT },
            activeFailureInjectionCount: Object.keys(M17_FOLLOWUP_FAILURE_INJECTION).filter(function (key) { return Boolean(M17_FOLLOWUP_FAILURE_INJECTION[key]); }).length
        };
    }

    ensureRoot();
    window.ArsM1FollowupState = Object.freeze({ VERSION: VERSION, ensure: ensureRoot, get: get, getSnapshot: getSnapshot });
    window.ArsM1FollowupSystem = Object.freeze({
        initialize: initialize,
        normalizeFromEvent: normalizeFromEvent,
        enqueueNormalized: enqueueNormalized,
        collectDue: collectDue,
        commitStatus: commitStatus,
        drain: drain,
        _planOrchestrationPatch: _planOrchestrationPatch,
        _commitOrchestration: _commitOrchestration,
        _rollbackCommitted: _rollbackCommitted,
        _verifyCommitted: _verifyCommitted
    });
    window.ArsM1FollowupDiagnostics = Object.freeze({ run: diagnostics });
    const initialization = initialize();
    if (!initialization.ok) { throw new Error(initialization.error + ":" + String(initialization.detail || "")); }
})();

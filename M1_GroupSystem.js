// Ars Bellum M1 - Cross-state MobileGroup relationships and atomic split
(function () {
    "use strict";
    const listeners = new Set();
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function emit(event) {
        const warnings = [];
        listeners.forEach(function (fn) { try { fn(clone(event)); } catch (e) { warnings.push(String(e && e.message || e)); } });
        return warnings;
    }
    function rollback(committed) {
        const failures = [];
        for (let i = committed.length - 1; i >= 0; i -= 1) {
            try { committed[i].restore(); } catch (e) { failures.push(String(e && e.message || e)); }
        }
        return failures;
    }
    function linkCharacter(plan) {
        const p = plan || {}, group = window.ArsMobileGroupState.getSnapshot(p.groupId), character = window.ArsCharacterState.getSnapshot(p.characterId);
        if (!group || !character) { return { ok: false, error: "missing_link_target" }; }
        if (group.revision !== p.expectedGroupRevision || character.revision !== p.expectedCharacterRevision) { return { ok: false, error: "revision_conflict" }; }
        if (character.location.mobileGroupId && character.location.mobileGroupId !== group.id) { return { ok: false, error: "character_already_in_group" }; }
        if (group.memberCharacterIds.indexOf(character.id) >= 0) {
            if (character.location.mobileGroupId !== group.id) { return { ok: false, error: "relationship_mismatch" }; }
            return { ok: true, replayed: true, group: group, character: character };
        }
        const groupNext = clone(group), characterNext = clone(character);
        groupNext.memberCharacterIds.push(character.id);
        characterNext.location.mobileGroupId = group.id; characterNext.location.mode = "mobile_group";
        const characterErrors = window.ArsCharacterState.validate(characterNext), groupErrors = window.ArsMobileGroupState.validate(groupNext);
        if (characterErrors.length || groupErrors.length) { return { ok: false, error: "invalid_relationship_plan", errors: characterErrors.concat(groupErrors) }; }
        const committed = [];
        let result = window.ArsCharacterState._atomicCommit(character.id, character.revision, characterNext, false);
        if (!result.ok) { return result; }
        committed.push({ restore: function () { window.ArsCharacterState._atomicRestore(character.id, character); } });
        result = window.ArsMobileGroupState._atomicCommit(group.id, group.revision, groupNext, false);
        if (!result.ok) { const failures = rollback(committed); return failures.length ? { ok: false, error: "rollback_failed", failures: failures } : result; }
        return { ok: true, group: window.ArsMobileGroupState.getSnapshot(group.id), character: window.ArsCharacterState.getSnapshot(character.id), warnings: emit({ type: "group_character_linked", groupId: group.id, characterId: character.id }) };
    }
    function unlinkCharacter(plan) {
        const p = plan || {}, group = window.ArsMobileGroupState.getSnapshot(p.groupId), character = window.ArsCharacterState.getSnapshot(p.characterId);
        if (!group || !character) { return { ok: false, error: "missing_link_target" }; }
        if (group.revision !== p.expectedGroupRevision || character.revision !== p.expectedCharacterRevision) { return { ok: false, error: "revision_conflict" }; }
        if (group.memberCharacterIds.indexOf(character.id) < 0 || character.location.mobileGroupId !== group.id) { return { ok: false, error: "relationship_mismatch" }; }
        if (group.legalCommanderRef && group.legalCommanderRef.type === "character" && group.legalCommanderRef.id === character.id) { return { ok: false, error: "cannot_remove_legal_commander" }; }
        if (group.actingCommanderRef && group.actingCommanderRef.type === "character" && group.actingCommanderRef.id === character.id) { return { ok: false, error: "cannot_remove_acting_commander" }; }
        const groupNext = clone(group), characterNext = clone(character);
        groupNext.memberCharacterIds = groupNext.memberCharacterIds.filter(function (id) { return id !== character.id; });
        characterNext.location.mobileGroupId = null; characterNext.location.mode = "settlement";
        const characterErrors = window.ArsCharacterState.validate(characterNext), groupErrors = window.ArsMobileGroupState.validate(groupNext);
        if (characterErrors.length || groupErrors.length) { return { ok: false, error: "invalid_relationship_plan", errors: characterErrors.concat(groupErrors) }; }
        const committed = [];
        let result = window.ArsCharacterState._atomicCommit(character.id, character.revision, characterNext, false);
        if (!result.ok) { return result; }
        committed.push({ restore: function () { window.ArsCharacterState._atomicRestore(character.id, character); } });
        result = window.ArsMobileGroupState._atomicCommit(group.id, group.revision, groupNext, false);
        if (!result.ok) { const failures = rollback(committed); return failures.length ? { ok: false, error: "rollback_failed", failures: failures } : result; }
        return { ok: true, group: window.ArsMobileGroupState.getSnapshot(group.id), character: window.ArsCharacterState.getSnapshot(character.id), warnings: emit({ type: "group_character_unlinked", groupId: group.id, characterId: character.id }) };
    }
    function attachInventory(plan) {
        const p = plan || {}, group = window.ArsMobileGroupState.getSnapshot(p.groupId), inventory = window.ArsInventoryState.getSnapshot(p.inventoryId);
        if (!group || !inventory) { return { ok: false, error: "missing_link_target" }; }
        if (group.revision !== p.expectedGroupRevision || inventory.revision !== p.expectedInventoryRevision) { return { ok: false, error: "revision_conflict" }; }
        if (inventory.ownerRef.type !== "mobile_group" || inventory.ownerRef.id !== group.id) { return { ok: false, error: "inventory_owner_mismatch" }; }
        if (group.inventoryId === inventory.id) { return { ok: true, replayed: true, group: group, inventory: inventory }; }
        const next = clone(group); next.inventoryId = inventory.id;
        const result = window.ArsMobileGroupState._atomicCommit(group.id, group.revision, next, false);
        if (!result.ok) { return result; }
        return { ok: true, group: result.group, inventory: inventory, warnings: emit({ type: "group_inventory_attached", groupId: group.id, inventoryId: inventory.id }) };
    }
    function attachTreasury(plan) {
        const p = plan || {}, group = window.ArsMobileGroupState.getSnapshot(p.groupId), account = window.ArsFinanceState.getAccountSnapshot(p.accountId);
        if (!group || !account) { return { ok: false, error: "missing_link_target" }; }
        if (group.revision !== p.expectedGroupRevision || account.revision !== p.expectedAccountRevision) { return { ok: false, error: "revision_conflict" }; }
        if (account.ownerRef.type !== "mobile_group" || account.ownerRef.id !== group.id) { return { ok: false, error: "account_owner_mismatch" }; }
        if (group.treasuryAccountId === account.id) { return { ok: true, replayed: true, group: group, account: account }; }
        const next = clone(group); next.treasuryAccountId = account.id;
        const result = window.ArsMobileGroupState._atomicCommit(group.id, group.revision, next, false);
        if (!result.ok) { return result; }
        return { ok: true, group: result.group, account: account, warnings: emit({ type: "group_treasury_attached", groupId: group.id, accountId: account.id }) };
    }
    function moveRefs(source, requested) {
        const remain = clone(source || []), moved = [], seen = new Set();
        for (const request of (Array.isArray(requested) ? requested : [])) {
            const roleId = request.roleId == null ? null : String(request.roleId);
            const key = String(request.refTypeId) + "\u0000" + String(request.refId) + "\u0000" + String(roleId);
            if (seen.has(key)) { return { ok: false, error: "duplicate_ref_allocation" }; }
            seen.add(key);
            const index = remain.findIndex(function (item) { return item.refTypeId === request.refTypeId && item.refId === request.refId && item.roleId === roleId; });
            const quantity = Number(request.quantity);
            if (index < 0 || !Number.isFinite(quantity) || quantity <= 0 || quantity > remain[index].quantity) { return { ok: false, error: "invalid_ref_allocation" }; }
            const take = clone(remain[index]); take.quantity = quantity; moved.push(take);
            remain[index].quantity -= quantity; if (remain[index].quantity === 0) { remain.splice(index, 1); }
        }
        return { ok: true, remain: remain, moved: moved };
    }
    function splitGroup(plan) {
        const p = plan || {}, source = window.ArsMobileGroupState.getSnapshot(p.sourceGroupId);
        if (!source) { return { ok: false, error: "missing_source_group" }; }
        if (source.revision !== p.expectedGroupRevision) { return { ok: false, error: "revision_conflict" }; }
        const newSpec = p.newGroup || {};
        if (!newSpec.id || window.ArsMobileGroupState.getSnapshot(newSpec.id)) { return { ok: false, error: "duplicate_new_group_id" }; }
        if (!newSpec.groupTypeId || !window.ArsMobileGroupState.getGroupTypeDefinition(newSpec.groupTypeId)) { return { ok: false, error: "unregistered_group_type" }; }
        if (!newSpec.commandStructureId || !window.ArsMobileGroupState.getCommandStructureDefinition(newSpec.commandStructureId)) { return { ok: false, error: "explicit_command_structure_required" }; }
        const moves = Array.isArray(p.characterMoves) ? p.characterMoves : [];
        if (!moves.length && !(p.memberRefMoves || []).length && !(p.transportAssetMoves || []).length) { return { ok: false, error: "empty_split" }; }
        const movedIds = moves.map(function (move) { return move.characterId; });
        if (new Set(movedIds).size !== movedIds.length || movedIds.some(function (id) { return source.memberCharacterIds.indexOf(id) < 0; })) { return { ok: false, error: "invalid_character_allocation" }; }
        const characters = [];
        for (const move of moves) {
            const character = window.ArsCharacterState.getSnapshot(move.characterId);
            if (!character || character.revision !== move.expectedRevision || character.location.mobileGroupId !== source.id) { return { ok: false, error: "character_revision_or_membership" }; }
            characters.push(character);
        }
        const memberAllocation = moveRefs(source.memberRefs, p.memberRefMoves || []);
        if (!memberAllocation.ok) { return memberAllocation; }
        const transportAllocation = moveRefs(source.transport && source.transport.assetRefs, p.transportAssetMoves || []);
        if (!transportAllocation.ok) { return { ok: false, error: "invalid_transport_asset_allocation", cause: transportAllocation.error }; }
        const sourceNext = clone(source);
        const newGroup = window.ArsMobileGroupState.createDefault(Object.assign({}, newSpec, {
            memberCharacterIds: movedIds, memberRefs: memberAllocation.moved,
            inventoryId: null, treasuryAccountId: null,
            transport: Object.assign({}, newSpec.transport || {}, { assetRefs: transportAllocation.moved })
        }));
        sourceNext.memberCharacterIds = source.memberCharacterIds.filter(function (id) { return movedIds.indexOf(id) < 0; });
        sourceNext.memberRefs = memberAllocation.remain;
        sourceNext.transport.assetRefs = transportAllocation.remain;
        const commanders = [newGroup.legalCommanderRef, newGroup.actingCommanderRef].filter(Boolean);
        if (commanders.some(function (ref) { return ref.type === "character" && movedIds.indexOf(ref.id) < 0; })) { return { ok: false, error: "explicit_commander_not_moved" }; }
        if (sourceNext.legalCommanderRef && sourceNext.legalCommanderRef.type === "character" && movedIds.indexOf(sourceNext.legalCommanderRef.id) >= 0) { return { ok: false, error: "source_legal_commander_moved" }; }
        if (sourceNext.actingCommanderRef && sourceNext.actingCommanderRef.type === "character" && movedIds.indexOf(sourceNext.actingCommanderRef.id) >= 0) { return { ok: false, error: "source_acting_commander_moved" }; }

        let sourceInventory = null, sourceInventoryNext = null, newInventory = null;
        if (p.inventoryPlan) {
            const inventoryPlan = p.inventoryPlan;
            sourceInventory = window.ArsInventoryState.getSnapshot(inventoryPlan.sourceInventoryId);
            if (!sourceInventory || sourceInventory.id !== source.inventoryId || sourceInventory.revision !== inventoryPlan.expectedRevision) { return { ok: false, error: "inventory_revision_or_link" }; }
            if (!inventoryPlan.newInventory || !inventoryPlan.newInventory.id || window.ArsInventoryState.getSnapshot(inventoryPlan.newInventory.id)) { return { ok: false, error: "duplicate_new_inventory_id" }; }
            sourceInventoryNext = clone(sourceInventory);
            newInventory = window.ArsInventoryState.createDefault(Object.assign({}, inventoryPlan.newInventory, { ownerRef: { type: "mobile_group", id: newGroup.id }, bulkItems: {}, equipmentItems: [], assignedCargo: [] }));
            for (const id of Object.keys(inventoryPlan.bulkItems || {})) {
                const quantity = Number(inventoryPlan.bulkItems[id]);
                if (!Number.isFinite(quantity) || quantity < 0 || quantity > (sourceInventoryNext.bulkItems[id] || 0)) { return { ok: false, error: "invalid_bulk_allocation" }; }
                sourceInventoryNext.bulkItems[id] -= quantity; newInventory.bulkItems[id] = quantity;
            }
            const equipmentIds = Array.isArray(inventoryPlan.equipmentInstanceIds) ? inventoryPlan.equipmentInstanceIds : [];
            if (new Set(equipmentIds).size !== equipmentIds.length) { return { ok: false, error: "duplicate_equipment_allocation" }; }
            newInventory.equipmentItems = sourceInventoryNext.equipmentItems.filter(function (item) { return equipmentIds.indexOf(item.instanceId) >= 0; });
            if (newInventory.equipmentItems.length !== equipmentIds.length) { return { ok: false, error: "invalid_equipment_allocation" }; }
            sourceInventoryNext.equipmentItems = sourceInventoryNext.equipmentItems.filter(function (item) { return equipmentIds.indexOf(item.instanceId) < 0; });
            const cargoIds = Array.isArray(inventoryPlan.cargoIds) ? inventoryPlan.cargoIds : [];
            if (new Set(cargoIds).size !== cargoIds.length) { return { ok: false, error: "duplicate_cargo_allocation" }; }
            newInventory.assignedCargo = sourceInventoryNext.assignedCargo.filter(function (cargo) { return cargoIds.indexOf(cargo.cargoId) >= 0; });
            if (newInventory.assignedCargo.length !== cargoIds.length) { return { ok: false, error: "invalid_cargo_allocation" }; }
            sourceInventoryNext.assignedCargo = sourceInventoryNext.assignedCargo.filter(function (cargo) { return cargoIds.indexOf(cargo.cargoId) < 0; });
            newGroup.inventoryId = newInventory.id;
        }
        let sourceAccount = null, sourceAccountNext = null, newAccount = null;
        if (p.accountPlan) {
            const accountPlan = p.accountPlan;
            sourceAccount = window.ArsFinanceState.getAccountSnapshot(accountPlan.sourceAccountId);
            if (!sourceAccount || sourceAccount.id !== source.treasuryAccountId || sourceAccount.revision !== accountPlan.expectedRevision) { return { ok: false, error: "account_revision_or_link" }; }
            if (!accountPlan.newAccount || !accountPlan.newAccount.id || window.ArsFinanceState.getAccountSnapshot(accountPlan.newAccount.id)) { return { ok: false, error: "duplicate_new_account_id" }; }
            const amount = Number(accountPlan.amount);
            if (!Number.isFinite(amount) || amount < 0 || amount > sourceAccount.balance) { return { ok: false, error: "invalid_account_allocation" }; }
            sourceAccountNext = clone(sourceAccount); sourceAccountNext.balance -= amount;
            newAccount = window.ArsFinanceState.createDefault(Object.assign({}, accountPlan.newAccount, { ownerRef: { type: "mobile_group", id: newGroup.id }, balance: amount, currencyId: sourceAccount.currencyId }));
            newGroup.treasuryAccountId = newAccount.id;
        }
        const nextCharacters = characters.map(function (character) { const next = clone(character); next.location.mobileGroupId = newGroup.id; next.location.mode = "mobile_group"; return next; });
        const validationErrors = [];
        nextCharacters.forEach(function (character) { validationErrors.push.apply(validationErrors, window.ArsCharacterState.validate(character)); });
        validationErrors.push.apply(validationErrors, window.ArsMobileGroupState.validate(sourceNext));
        validationErrors.push.apply(validationErrors, window.ArsMobileGroupState.validate(newGroup));
        if (sourceInventory) { validationErrors.push.apply(validationErrors, window.ArsInventoryState.validate(sourceInventoryNext)); validationErrors.push.apply(validationErrors, window.ArsInventoryState.validate(newInventory)); }
        if (sourceAccount) { validationErrors.push.apply(validationErrors, window.ArsFinanceState.validate(sourceAccountNext)); validationErrors.push.apply(validationErrors, window.ArsFinanceState.validate(newAccount)); }
        if (validationErrors.length) { return { ok: false, error: "invalid_split_plan", errors: validationErrors }; }

        const committed = [];
        function commit(api, id, revision, next, create, snapshot) {
            const result = api._atomicCommit(id, revision, next, create);
            if (!result.ok) { throw { result: result }; }
            committed.push({ restore: function () { api._atomicRestore(id, snapshot); } });
        }
        try {
            nextCharacters.forEach(function (next, index) { const old = characters[index]; commit(window.ArsCharacterState, old.id, old.revision, next, false, old); });
            if (sourceInventory) { commit(window.ArsInventoryState, sourceInventory.id, sourceInventory.revision, sourceInventoryNext, false, sourceInventory); commit(window.ArsInventoryState, newInventory.id, null, newInventory, true, null); }
            if (sourceAccount) { commit(window.ArsFinanceState, sourceAccount.id, sourceAccount.revision, sourceAccountNext, false, sourceAccount); commit(window.ArsFinanceState, newAccount.id, null, newAccount, true, null); }
            commit(window.ArsMobileGroupState, source.id, source.revision, sourceNext, false, source);
            commit(window.ArsMobileGroupState, newGroup.id, null, newGroup, true, null);
        } catch (e) {
            const failures = rollback(committed);
            if (failures.length) { return { ok: false, error: "rollback_failed", failures: failures }; }
            return e.result || { ok: false, error: "atomic_split_failed", detail: String(e && e.message || e) };
        }
        return { ok: true, sourceGroup: window.ArsMobileGroupState.getSnapshot(source.id), newGroup: window.ArsMobileGroupState.getSnapshot(newGroup.id), warnings: emit({ type: "group_split", sourceGroupId: source.id, newGroupId: newGroup.id }) };
    }
    window.ArsMobileGroupSystem = Object.freeze({
        subscribe: function (fn) { if (typeof fn !== "function") { return function () {}; } listeners.add(fn); return function () { listeners.delete(fn); }; },
        linkCharacter: linkCharacter, unlinkCharacter: unlinkCharacter,
        attachInventory: attachInventory, attachTreasury: attachTreasury,
        splitGroup: splitGroup, split: splitGroup
    });
})();

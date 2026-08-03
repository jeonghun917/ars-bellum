// Ars Bellum M1-5/6 - Runtime typed reference registry
// Resolver functions are read-only runtime adapters. No persistent root is created here.
(function () {
    "use strict";

    const resolvers = Object.create(null);

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function validId(value) {
        return typeof value === "string" && /^[a-z][a-z0-9_.:-]*$/.test(value);
    }

    function validRef(ref) {
        return Boolean(ref) && typeof ref === "object" && !Array.isArray(ref) && validId(ref.type) && typeof ref.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(ref.id);
    }

    function isThenable(value) {
        return Boolean(value) && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
    }

    function registerResolver(typeId, resolver) {
        if (!validId(typeId)) {
            return { ok: false, error: "m156_invalid_resolver_type" };
        }
        if (resolvers[typeId]) {
            return { ok: false, error: "m156_duplicate_resolver:" + typeId };
        }
        if (!resolver || typeof resolver.exists !== "function" || typeof resolver.getSnapshot !== "function") {
            return { ok: false, error: "m156_invalid_resolver" };
        }
        resolvers[typeId] = Object.freeze({
            exists: resolver.exists,
            getSnapshot: resolver.getSnapshot
        });
        return { ok: true, typeId: typeId };
    }

    function hasResolver(typeId) {
        return Boolean(resolvers[typeId]);
    }

    function capabilityResult(ref, capabilityTag) {
        if (!capabilityTag) {
            return { ok: true };
        }
        if (!validId(capabilityTag)) {
            return { ok: false, error: "m156_invalid_capability_tag" };
        }
        const registry = window.ArsDefinitionRegistry;
        if (!registry || !registry.hasDefinition("owner_ref_type", ref.type)) {
            return { ok: false, error: "m156_missing_ref_type_definition", details: ref.type };
        }
        const definition = registry.getDefinition("owner_ref_type", ref.type) || {};
        const tags = Array.isArray(definition.capabilityTags) ? definition.capabilityTags : [];
        if (tags.indexOf(capabilityTag) < 0) {
            return { ok: false, error: "m156_ref_capability_denied", details: ref.type + ":" + capabilityTag };
        }
        return { ok: true };
    }

    function validateRef(ref, capabilityTag) {
        if (!validRef(ref)) {
            return { ok: false, error: "m156_invalid_ref" };
        }
        const resolver = resolvers[ref.type];
        if (!resolver) {
            return { ok: false, error: "m156_missing_resolver:" + ref.type };
        }
        const capability = capabilityResult(ref, capabilityTag);
        if (!capability.ok) {
            return capability;
        }
        let exists;
        try {
            exists = resolver.exists(ref.id);
        } catch (error) {
            return { ok: false, error: "m156_resolver_failed", details: String(error && error.message || error) };
        }
        if (isThenable(exists)) {
            return { ok: false, error: "m156_unsupported_async_resolver" };
        }
        if (exists !== true) {
            return { ok: false, error: "m156_missing_ref_target", details: ref.type + ":" + ref.id };
        }
        return { ok: true, ref: { type: ref.type, id: ref.id } };
    }

    function getRefSnapshot(ref) {
        const validation = validateRef(ref, null);
        if (!validation.ok) {
            return validation;
        }
        let snapshot;
        try {
            snapshot = resolvers[ref.type].getSnapshot(ref.id);
        } catch (error) {
            return { ok: false, error: "m156_resolver_failed", details: String(error && error.message || error) };
        }
        if (isThenable(snapshot)) {
            return { ok: false, error: "m156_unsupported_async_resolver" };
        }
        if (snapshot == null) {
            return { ok: false, error: "m156_missing_ref_target", details: ref.type + ":" + ref.id };
        }
        try {
            return { ok: true, ref: { type: ref.type, id: ref.id }, value: clone(snapshot) };
        } catch (error) {
            return { ok: false, error: "m156_nonserializable_ref_snapshot" };
        }
    }

    function getResolverSnapshot() {
        return Object.keys(resolvers).sort().map(function (typeId) {
            return { typeId: typeId };
        });
    }

    window.ArsRefRegistry = Object.freeze({
        registerResolver: registerResolver,
        hasResolver: hasResolver,
        validateRef: validateRef,
        getRefSnapshot: getRefSnapshot,
        getResolverSnapshot: getResolverSnapshot
    });
})();

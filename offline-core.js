/* =========================================================
   RAMPUR FREE TUITION
   OFFLINE-FIRST CORE  (v2)

   This is the ONLY IndexedDB database in the app.
   It provides:
     - generic per-table CRUD against IndexedDB
     - a single outbox (sync queue) with two actions only:
         'upsert'  -> insert or update a row (id is always
                      known client-side, so upsert covers both)
         'delete'  -> delete a row by id
     - a sync engine that drains the outbox to Supabase and
       pulls fresh server data back down
     - small "meta" key/value store (last sync time, whether
       this device has ever logged in successfully, etc.)

   Nothing in this file talks about students/attendance/fees
   specifically - it is generic. script.js supplies the
   Supabase client and table names.
   ========================================================= */

(() => {

    "use strict";

    const DB_NAME = "RampurFreeTuitionDB";
    // v3: adds the "events" object store (Events & Notices section).
    // onupgradeneeded only creates stores that don't already exist, so
    // the existing "finance", "fees" and every other store and all of
    // their data are left exactly as they were.
    const DB_VERSION = 3;

    // Tables that are mirrored locally and synced to Supabase via the
    // GENERIC sync engine (pullAllFromSupabase/processOutbox loop over
    // this list in script.js). "finance" is deliberately NOT in this
    // list - it is owner-only and is pulled/pushed through isolated,
    // owner-gated functions in script.js instead (pullFinanceFromSupabase,
    // and owner-checked addFinance/editFinance/deleteFinance), so a
    // teacher session can never have Finance downloaded to it or enqueue
    // a Finance outbox entry via the generic path.
    // "fees" is kept (not renamed/removed) so existing historical fee
    // records stay intact for the Dashboard and Student History views.
    // "events" (Events & Notices) IS in this generic list, unlike
    // "finance" - Teachers are allowed to view Events (just not
    // add/edit/delete them), so it goes through the same generic
    // pull/outbox path as students/attendance/etc.; the owner-only
    // restriction on writes is enforced in script.js (denyIfNotOwner)
    // and should also be enforced by Supabase RLS on the "events" table.
    const TABLES = ["students", "groups", "attendance", "fees", "exams", "results", "events"];

    let dbPromise = null;
    let syncing = false;
    let syncListeners = [];

    /* =====================================================
       OPEN DATABASE
       ===================================================== */

    function openDB() {

        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = event => {

                const db = event.target.result;

                TABLES.forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name, { keyPath: "id" });
                    }
                });

                // "finance" is intentionally NOT in TABLES (see comment
                // above) so it is created explicitly here instead. This
                // does not delete or recreate the database - it only
                // creates the store if it doesn't already exist, exactly
                // like every other store above. Existing Finance data in
                // this store (if any) is untouched.
                if (!db.objectStoreNames.contains("finance")) {
                    db.createObjectStore("finance", { keyPath: "id" });
                }

                if (!db.objectStoreNames.contains("outbox")) {
                    const store = db.createObjectStore("outbox", {
                        keyPath: "localId",
                        autoIncrement: true
                    });
                    store.createIndex("createdAt", "createdAt");
                }

                if (!db.objectStoreNames.contains("meta")) {
                    db.createObjectStore("meta", { keyPath: "key" });
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };

            request.onerror = () => {
                console.error("IndexedDB open failed:", request.error);
                reject(request.error);
            };
        });

        return dbPromise;
    }

    /* =====================================================
       GENERIC STORE HELPERS
       ===================================================== */

    async function getAll(storeName) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function get(storeName, id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function put(storeName, value) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put(value);
            tx.oncomplete = () => resolve(value);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function putMany(storeName, items) {
        if (!Array.isArray(items) || items.length === 0) return;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            items.forEach(item => {
                if (item && item.id !== undefined && item.id !== null) {
                    store.put(item);
                }
            });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function remove(storeName, id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clearStore(storeName) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    /* =====================================================
       META (small key/value settings)
       ===================================================== */

    async function setMeta(key, value) {
        await put("meta", { key, value });
    }

    async function getMeta(key) {
        const item = await get("meta", key);
        return item ? item.value : null;
    }

    /* =====================================================
       OUTBOX (sync queue)
       ===================================================== */

    /* =====================================================
       TIMEOUT HELPER
       A network request with no timeout can hang forever on a
       flaky mobile connection, leaving the UI stuck on
       "Syncing...". Every Supabase call this file/script.js
       makes is wrapped in this so it always settles one way or
       another within a bounded time.
       ===================================================== */

    function withTimeout(promise, ms, label) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error((label || "Request") + " timed out")),
                ms
            );
        });
        return Promise.race([Promise.resolve(promise), timeout])
            .finally(() => clearTimeout(timeoutId));
    }

    /* =====================================================
       ABORTABLE TIMEOUT
       Same idea as withTimeout, but also actually cancels the
       underlying network request via AbortController (rather
       than just walking away from an abandoned promise), which
       frees up the connection instead of leaving it hanging in
       the background. Falls back to a plain race if the query
       builder passed in doesn't support .abortSignal() for
       whatever reason - still correct, just without true
       cancellation.
       ===================================================== */

    function withAbortableTimeout(queryBuilder, ms, label) {
        let controller = null;
        let timeoutId;

        let promise = queryBuilder;
        if (queryBuilder && typeof queryBuilder.abortSignal === "function") {
            controller = new AbortController();
            promise = queryBuilder.abortSignal(controller.signal);
        }

        timeoutId = setTimeout(() => {
            if (controller) controller.abort();
        }, ms);

        // A small buffer beyond the abort itself, in case aborting doesn't
        // actually settle the promise in some environment - this still
        // guarantees the caller's await always resolves/rejects.
        return withTimeout(promise, ms + 3000, label)
            .finally(() => clearTimeout(timeoutId));
    }

    /* =====================================================
       OUTBOX (sync queue)

       Coalesces repeated edits to the same record into a single
       queued item instead of piling up one entry per keystroke/
       save - so editing a student's phone number five times
       before you're back online still only sends one upsert.
       ===================================================== */

    /* ---- Stage 8H-5a: atomic outbox helpers -------------------------------

       Every read-modify-write of the outbox now happens inside ONE IndexedDB
       readwrite transaction. IndexedDB serialises readwrite transactions on
       the same object store, so no other enqueue / compare-and-delete /
       update can interleave between the read and the write.
       ----------------------------------------------------------------------- */

    // Deterministic text form of a JSON-like value (object keys sorted
    // recursively) so two copies of the same content always compare equal.
    function stableStringify(value) {
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value === undefined ? null : value);
        }
        if (Array.isArray(value)) {
            return "[" + value.map(stableStringify).join(",") + "]";
        }
        return "{" + Object.keys(value).sort().map(k =>
            JSON.stringify(k) + ":" + stableStringify(value[k])
        ).join(",") + "}";
    }

    // Everything about a queued item that changes WHAT would be written:
    // table, action, the full record (every field) and a revision counter
    // (bumped on every coalesce / re-key, so even an edit that happens to
    // produce identical record content is still detected as "changed").
    // attempts / lastError / createdAt are bookkeeping and deliberately excluded.
    function outboxFingerprint(item) {
        if (!item) return null;
        return stableStringify({
            table: item.table,
            action: item.action,
            rev: item.rev || 0,
            record: item.record
        });
    }

    // The body of enqueue(), working on an already-open readwrite "outbox"
    // object store so the CALLER decides the transaction boundary (enqueue()
    // uses the outbox alone; putAndEnqueue() adds the data row to the same
    // transaction). Behaviour is unchanged from the previous enqueue():
    // coalesce a pending upsert for the same record, drop superseded items
    // before queueing a delete, otherwise append a new pending item.
    function enqueueInStore(outboxStore, table, action, record, onDone) {
        const readReq = outboxStore.getAll();
        readReq.onsuccess = () => {
            const existing = (readReq.result || [])
                .filter(i => i.status === "pending")
                .sort((a, b) => a.createdAt - b.createdAt)
                .filter(i => i.table === table && i.record && record && i.record.id === record.id);

            if (action === "upsert") {
                const existingUpsert = existing.find(i => i.action === "upsert");
                if (existingUpsert) {
                    // Same record, still queued, not yet synced - replace the
                    // payload with the latest version rather than queuing
                    // another full round trip for it. rev++ lets an in-flight
                    // request for the OLD payload see that this item changed.
                    existingUpsert.record = record;
                    existingUpsert.lastError = null;
                    existingUpsert.rev = (existingUpsert.rev || 0) + 1;
                    outboxStore.put(existingUpsert);
                    onDone(existingUpsert.localId);
                    return;
                }
            }

            if (action === "delete") {
                // Nothing to upsert if it's about to be deleted anyway - and
                // no need to delete twice.
                for (const item of existing) {
                    outboxStore.delete(item.localId);
                }
            }

            const addReq = outboxStore.add({
                table,
                action,          // 'upsert' | 'delete'
                record,          // full row for upsert, { id } for delete
                status: "pending",
                attempts: 0,
                lastError: null,
                createdAt: Date.now(),
                rev: 0
            });
            addReq.onsuccess = () => onDone(addReq.result);
        };
    }

    async function enqueue(table, action, record) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            let localId;
            enqueueInStore(tx.objectStore("outbox"), table, action, record, id => { localId = id; });
            tx.oncomplete = () => resolve(localId);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Write a data row AND queue it for sync in ONE transaction: either both
    // are saved or neither is. This closes the old crash window where a row
    // was written locally (put) but the app died before it was queued
    // (enqueue) - a later pull would then delete that unqueued row.
    //
    // Optional 5th argument { resolveRow(pendingItems, row) }: called INSIDE
    // the transaction, before anything is written, with the table's pending
    // outbox items as they are right now. It may return a replacement row
    // (e.g. the same edit under a different id). Because it runs in the same
    // transaction, no other transaction (such as a re-key) can change the
    // outbox between its look-up and the write. If it is omitted, returns
    // nothing, or throws, the row is written exactly as given.
    async function putAndEnqueue(storeName, row, table, action, options) {
        const resolveRow = options && typeof options.resolveRow === "function" ? options.resolveRow : null;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName, "outbox"], "readwrite");
            const outbox = tx.objectStore("outbox");
            const tableName = table || storeName;
            let localId;
            const save = finalRow => {
                tx.objectStore(storeName).put(finalRow);
                enqueueInStore(outbox, tableName, action || "upsert", finalRow, id => { localId = id; });
            };
            if (!resolveRow) {
                save(row);
            } else {
                const pendingReq = outbox.getAll();
                pendingReq.onsuccess = () => {
                    let finalRow = row;
                    try {
                        const pending = (pendingReq.result || [])
                            .filter(i => i.status === "pending" && i.table === tableName && i.record);
                        const replaced = resolveRow(pending, row);
                        if (replaced && typeof replaced === "object") finalRow = replaced;
                    } catch (err) {
                        console.warn("putAndEnqueue resolveRow failed; writing the row as given:", err);
                        finalRow = row;
                    }
                    save(finalRow);
                };
            }
            tx.oncomplete = () => resolve(localId);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    async function getPendingOutbox() {
        const items = await getAll("outbox");
        return items
            .filter(i => i.status === "pending")
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    async function removeFromOutbox(localId) {
        await remove("outbox", localId);
    }

    // Same behaviour as before (merge `updates` into the stored item; no-op if
    // the item is gone) but the read and the write are ONE transaction, so a
    // concurrent coalescing enqueue cannot be overwritten with a stale copy.
    async function updateOutboxItem(localId, updates) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            const req = store.get(localId);
            req.onsuccess = () => {
                const item = req.result;
                if (!item) return;
                Object.assign(item, updates);
                if (updates && Object.prototype.hasOwnProperty.call(updates, "record")) {
                    item.rev = (item.rev || 0) + 1;
                }
                store.put(item);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Remove an outbox item ONLY IF it is still exactly what was sent.
    // read + compare + delete happen in one readwrite transaction, so an edit
    // coalesced into the item while its request was in flight can never be
    // deleted by that older request succeeding. Resolves to
    //   "removed"  - unchanged, deleted
    //   "changed"  - modified during the request, KEPT pending
    //   "gone"     - already removed by something else
    async function removeOutboxIfUnchanged(localId, sentItem) {
        const expected = outboxFingerprint(sentItem);
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            let outcome = "gone";
            const req = store.get(localId);
            req.onsuccess = () => {
                const current = req.result;
                if (!current) return;
                if (outboxFingerprint(current) === expected) {
                    store.delete(localId);
                    outcome = "removed";
                } else {
                    outcome = "changed";
                }
            };
            tx.oncomplete = () => resolve(outcome);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Move a PENDING upsert (and its local data row) from id `oldId` to
    // `newId` in one transaction - used to adopt the server's canonical id.
    // The pending edit is preserved exactly (same fields, same updated_at);
    // only `id` changes. Applies to the item's CURRENT content, so an edit
    // coalesced a moment ago is not lost. If another, distinct pending item
    // already owns `newId`, both items are kept; the local row keeps the
    // existing row when options.preferExisting(moved, existing) says so.
    // Resolves "rekeyed" or "skipped" (conditions no longer hold).
    async function rekeyPendingRecord(table, localId, oldId, newId, options) {
        if (!oldId || !newId || oldId === newId) return "skipped";
        const preferExisting = options && options.preferExisting;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([table, "outbox"], "readwrite");
            const rows = tx.objectStore(table);
            const outbox = tx.objectStore("outbox");
            let outcome = "skipped";

            const itemReq = outbox.get(localId);
            itemReq.onsuccess = () => {
                const item = itemReq.result;
                if (!item || item.status !== "pending" || item.table !== table ||
                    item.action !== "upsert" || !item.record || item.record.id !== oldId) {
                    return;
                }
                const moved = Object.assign({}, item.record, { id: newId });

                const allReq = outbox.getAll();
                allReq.onsuccess = () => {
                    const otherOwners = (allReq.result || []).filter(i =>
                        i.localId !== localId && i.status === "pending" && i.table === table &&
                        i.record && i.record.id === newId
                    );
                    const curReq = rows.get(newId);
                    curReq.onsuccess = () => {
                        const current = curReq.result;
                        rows.delete(oldId);
                        const keepExisting = otherOwners.length > 0 && current &&
                            typeof preferExisting === "function" && preferExisting(moved, current);
                        if (!keepExisting) rows.put(moved);
                        item.record = moved;
                        item.rev = (item.rev || 0) + 1;
                        outbox.put(item);
                        outcome = "rekeyed";
                    };
                };
            };
            tx.oncomplete = () => resolve(outcome);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    async function outboxCount() {
        const items = await getPendingOutbox();
        return items.length;
    }

    /* =====================================================
       CONNECTIVITY
       ===================================================== */

    function isOnline() {
        return navigator.onLine === true;
    }

    function onSyncStatusChange(fn) {
        syncListeners.push(fn);
    }

    function notifySyncListeners(status) {
        syncListeners.forEach(fn => {
            try { fn(status); } catch (e) { /* ignore listener errors */ }
        });
    }

    /* =====================================================
       SYNC ENGINE
       Upload every pending outbox item to Supabase, then
       download fresh rows for every table back into IndexedDB.
       Never throws - callers just get a status back.
       ===================================================== */

    async function processOutbox(supabaseClient) {

        if (syncing) return { ok: false, reason: "already-syncing" };
        if (!isOnline()) return { ok: false, reason: "offline" };

        syncing = true;
        notifySyncListeners({ phase: "start" });

        let succeeded = 0;
        let failed = 0;

        try {
            const items = await getPendingOutbox();

            for (const item of items) {
                try {
                    let error = null;

                    if (item.action === "upsert") {
                        const res = await withAbortableTimeout(
                            supabaseClient.from(item.table).upsert(item.record),
                            20000,
                            "Upsert"
                        );
                        error = res.error;
                    } else if (item.action === "delete") {
                        const res = await withAbortableTimeout(
                            supabaseClient.from(item.table).delete().eq("id", item.record.id).select("id"),
                            20000,
                            "Delete"
                        );
                        error = res.error;

                        // error === null does NOT necessarily mean the row was
                        // actually deleted: if RLS filters the row out for this
                        // session, Postgres/PostgREST report a normal, error-free
                        // response having deleted zero rows - indistinguishable
                        // from success unless the deleted rows are requested back
                        // via .select(), which is why that's now chained above.
                        // A non-empty res.data means at least one row was
                        // genuinely deleted - handled by the normal success path
                        // below, unchanged. An empty array means nothing was
                        // actually deleted; handled here, separately, because it
                        // must NOT fall through to that same success path.
                        //
                        // This can mean either RLS silently blocked the delete,
                        // or the row was already removed by another device or
                        // session first - there is no way to tell which from this
                        // response alone, so no specific cause is claimed.
                        //
                        // Reuses the existing attempts/lastError mechanism rather
                        // than adding a new outbox status, but caps retries for
                        // this specific case so a permanently-unauthorized delete
                        // doesn't queue forever: once a few consecutive attempts
                        // have all come back zero-row, the item is dropped -
                        // still counted as a failure for this sync pass (never as
                        // a success), just no longer retried.
                        if (!error && Array.isArray(res.data) && res.data.length === 0) {
                            const ZERO_ROW_MESSAGE =
                                "Delete could not be confirmed. The server may have already removed the record or your account may not have permission.";
                            const ZERO_ROW_RETRY_LIMIT = 3;

                            const priorAttempts = item.attempts || 0;

                            if (item.lastError === ZERO_ROW_MESSAGE && priorAttempts >= ZERO_ROW_RETRY_LIMIT) {
                                // Given up after repeated zero-row results - this
                                // is NOT a success, just stopping asking Supabase
                                // to do something it has already told us,
                                // repeatedly, it isn't doing.
                                await removeFromOutbox(item.localId);
                                failed++;
                                continue;
                            }

                            failed++;
                            await updateOutboxItem(item.localId, {
                                attempts: priorAttempts + 1,
                                lastError: ZERO_ROW_MESSAGE
                            });
                            continue; // leave it queued (unless just dropped above), try again next sync
                        }
                    } else {
                        // Unknown action - drop it rather than loop on it forever.
                        console.warn("Dropping outbox item with unknown action:", item);
                        await removeFromOutbox(item.localId);
                        continue;
                    }

                    if (error) {
                        failed++;
                        await updateOutboxItem(item.localId, {
                            attempts: (item.attempts || 0) + 1,
                            lastError: error.message || String(error)
                        });
                        continue; // leave it queued, try again next sync
                    }

                    // Stage 8H-5a: remove only if the item is still exactly what was
                    // sent. If the teacher edited the same record while this request was
                    // in flight, the newer version stays pending for the next pass.
                    await removeOutboxIfUnchanged(item.localId, item);
                    succeeded++;

                } catch (err) {
                    // Network drop mid-loop - stop this pass, keep everything
                    // else queued for the next sync attempt.
                    failed++;
                    await updateOutboxItem(item.localId, {
                        attempts: (item.attempts || 0) + 1,
                        lastError: err.message || String(err)
                    });

                    if (!isOnline()) break;
                }
            }
        } finally {
            syncing = false;
        }

        notifySyncListeners({ phase: "end", succeeded, failed });
        return { ok: true, succeeded, failed };
    }

    async function pullFromServer(supabaseClient, tableFetchers) {
        // tableFetchers: { studentsTable: async () => {...applies data locally + to IndexedDB...} }
        // Kept generic - script.js decides per-table shape mapping.
        for (const name of Object.keys(tableFetchers)) {
            try {
                await tableFetchers[name]();
            } catch (err) {
                console.error(`Pull failed for ${name}:`, err);
            }
        }
        await setMeta("lastSyncedAt", Date.now());
    }

    async function fullSync(supabaseClient, tableFetchers) {
        if (!isOnline()) return { ok: false, reason: "offline" };
        const uploadResult = await processOutbox(supabaseClient);
        await pullFromServer(supabaseClient, tableFetchers);
        return uploadResult;
    }

    /* =====================================================
       IDs
       ===================================================== */

    function newId() {
        if (window.crypto && window.crypto.randomUUID) {
            return window.crypto.randomUUID();
        }
        // Fallback for very old browsers without crypto.randomUUID
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /* =====================================================
       PERSISTENT STORAGE
       ===================================================== */

    async function requestPersistentStorage() {
        try {
            if (navigator.storage && navigator.storage.persist) {
                const already = await navigator.storage.persisted();
                if (!already) {
                    await navigator.storage.persist();
                }
            }
        } catch (error) {
            console.warn("Persistent storage request failed:", error);
        }
    }

    /* =====================================================
       DEBUG
       ===================================================== */

    async function getDatabaseInfo() {
        const info = {};
        for (const name of TABLES) info[name] = await getAll(name);
        info.outbox = await getAll("outbox");
        info.meta = await getAll("meta");
        return info;
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.RFT = {
        TABLES,
        openDB,
        getAll,
        get,
        put,
        putMany,
        remove,
        clearStore,
        setMeta,
        getMeta,
        enqueue,
        putAndEnqueue,
        removeOutboxIfUnchanged,
        rekeyPendingRecord,
        getPendingOutbox,
        removeFromOutbox,
        updateOutboxItem,
        outboxCount,
        isOnline,
        onSyncStatusChange,
        processOutbox,
        pullFromServer,
        fullSync,
        newId,
        requestPersistentStorage,
        getDatabaseInfo,
        withTimeout,
        withAbortableTimeout
    };

    openDB()
        .then(() => requestPersistentStorage())
        .then(() => console.log("RFT offline core ready."))
        .catch(err => console.error("RFT offline core failed:", err));

})();

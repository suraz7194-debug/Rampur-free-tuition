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

    /* ---- Stage 8H-5b: retry metadata, failure classification, backoff ---------

       Every field below is OPTIONAL on an outbox item and lives next to the
       existing fields; status stays "pending". Items written by older code
       (no retry fields) are simply "due". None of these fields is part of
       outboxFingerprint(), so writing them can never make an in-flight
       request think its item "changed".
         retryCount      consecutive failures of THIS version of the item
         nextAttemptAt   ms epoch before which an automatic pass skips it
         retryFp         fingerprint of the item when it last failed
         lastAttemptAt   ms epoch of the last failed send
         lastErrorClass  network | timeout | rate-limit | server |
                         auth-or-permission | waiting-for-parent | rejected |
                         delete-unconfirmed | unexpected
         lastErrorCode / lastErrorSub / lastHttpStatus
         issue           item needs a human look (never removes the item):
                         unknown-action | delete-unconfirmed | rejected |
                         parent-unverified | parent-missing | auth-or-permission
         issueSince / issueDetail
       -------------------------------------------------------------------------- */

    const RETRY_CAP_MS = 15 * 60 * 1000;          // longest automatic delay
    const RETRY_CLOCK_SLACK_MS = 60 * 1000;       // tolerance before a far-future timestamp is distrusted
    const RETRY_ERROR_TEXT_MAX = 300;
    const RETRY_AUTH_ISSUE_AFTER = 3;             // consecutive auth/permission failures before it is flagged
    const RETRY_NETWORK_STREAK_LIMIT = 2;         // consecutive network/timeout failures that end a pass
    const RETRY_BASE_MS = {
        "network": 15000,
        "timeout": 15000,
        "rate-limit": 60000,
        "server": 30000,
        "auth-or-permission": 60000,
        "waiting-for-parent": 30000,
        "rejected": 120000,
        "delete-unconfirmed": 60000,
        "unexpected": 60000
    };
    const RETRY_FIELDS = [
        "retryCount", "nextAttemptAt", "retryFp", "lastAttemptAt",
        "lastErrorClass", "lastErrorCode", "lastErrorSub", "lastHttpStatus",
        "issue", "issueSince", "issueDetail"
    ];
    const ZERO_ROW_MESSAGE =
        "Delete could not be confirmed. The server may have already removed the record or your account may not have permission.";

    // Plain, bounded, markup-free text for storage and display. Never keeps
    // HTML bodies, tokens or API keys.
    function boundText(value, max) {
        let s = "";
        try {
            if (value === null || value === undefined) s = "";
            else if (typeof value === "string") s = value;
            else if (typeof value.message === "string") s = value.message;
            else s = String(value);
        } catch (e) { s = ""; }
        s = String(s)
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[token]")
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/sb_(publishable|secret)_[A-Za-z0-9_-]+/g, "[key]")
            .replace(/\s+/g, " ")
            .trim();
        const limit = typeof max === "number" && max > 1 ? max : RETRY_ERROR_TEXT_MAX;
        return s.length > limit ? s.slice(0, limit - 1) + "…" : s;
    }

    // Decide what kind of failure this is from the OPERATION, the structured
    // error code, the status AND the message - never from status alone. Anything
    // uncertain becomes "unexpected": kept, retried with backoff, never removed.
    // info: { operation, table, status, error, thrown, zeroRow, zeroRowMessage,
    //         online, hasSession (true|false|null = unknown), parentPending }
    function classifyOutboxFailure(info) {
        info = info || {};
        const err = info.error || null;
        const thrown = info.thrown || null;
        const status = typeof info.status === "number" ? info.status
            : (err && typeof err.status === "number" ? err.status : null);
        const code = err && err.code !== undefined && err.code !== null ? String(err.code) : "";
        const rawMessage = err ? (err.message !== undefined ? err.message : err)
            : (thrown ? (thrown.message !== undefined ? thrown.message : thrown) : "");
        const message = boundText(rawMessage, RETRY_ERROR_TEXT_MAX);
        const hint = err && err.hint ? boundText(err.hint, 120) : "";
        const lower = (message + " " + hint).toLowerCase();
        const out = (cls, extra) => Object.assign(
            { cls, code: code.slice(0, 32), httpStatus: status, message, issue: null }, extra || {});

        // A delete that "succeeded" but touched zero rows: ambiguous (already
        // gone, or not allowed). Always kept and surfaced; never resolved here.
        if (info.zeroRow) {
            return out("delete-unconfirmed", {
                issue: "delete-unconfirmed",
                message: boundText(info.zeroRowMessage || ZERO_ROW_MESSAGE, RETRY_ERROR_TEXT_MAX)
            });
        }

        // Exceptions thrown instead of an error object (our own timeout, fetch
        // failures when throwOnError is used, JavaScript errors).
        if (thrown) {
            const name = String(thrown.name || "");
            const text = String(thrown.message || "");
            if (name === "AbortError" || /timed out|timeout/i.test(text)) return out("timeout");
            if (name === "TypeError" || /failed to fetch|network|load failed/i.test(text)) return out("network");
            return out("unexpected");
        }
        if (!err) return out("unexpected");

        if (/^aborterror/i.test(message) || /abort/i.test(hint) || /timed out/.test(lower) || status === 408) {
            return out("timeout");
        }
        if (status === 0 || /^(typeerror|networkerror|fetcherror)/i.test(message) ||
            /failed to fetch|network request failed|load failed/.test(lower) || info.online === false) {
            return out("network");
        }
        if (status === 429) return out("rate-limit");

        const authish = status === 401 || status === 403 || code === "42501" || /^PGRST30\d$/.test(code) ||
            /jwt|not authenticated|permission denied|row-level security/.test(lower);
        if (authish) {
            // Only claim a specific cause when the evidence supports it.
            let sub = "auth-unverified";
            if (info.hasSession === false) sub = "sign-in-required";
            else if (info.hasSession === true &&
                (code === "42501" || status === 403 || /row-level security|permission denied/.test(lower))) sub = "permission-denied";
            return out("auth-or-permission", { sub, issueAfter: RETRY_AUTH_ISSUE_AFTER, issueName: "auth-or-permission" });
        }

        if (/^23/.test(code) || /^22/.test(code) || status === 400 || status === 409 ||
            status === 413 || status === 422 || /^PGRST1/.test(code)) {
            if (code === "23503") {
                // Foreign-key failure. If the parent is itself still queued it is
                // simply not there yet; otherwise the parent is unverified.
                if (info.parentPending) return out("waiting-for-parent");
                return out("rejected", { issue: info.table === "attendance" ? "parent-unverified" : "rejected" });
            }
            return out("rejected", { issue: "rejected" });
        }
        if (typeof status === "number" && status >= 500) return out("server");
        return out("unexpected");
    }

    // Capped exponential backoff with downward-only jitter, so the result can
    // never exceed RETRY_CAP_MS. rand is injectable for tests.
    function computeBackoffMs(cls, retryCount, rand) {
        const base = RETRY_BASE_MS[cls] || 60000;
        const n = Math.max(1, Math.min(Number(retryCount) || 1, 30));
        const raw = Math.min(RETRY_CAP_MS, base * Math.pow(2, Math.min(n - 1, 20)));
        const r = typeof rand === "number" ? Math.min(1, Math.max(0, rand)) : Math.random();
        return Math.max(1000, Math.min(RETRY_CAP_MS, Math.round(raw * (0.8 + 0.2 * r))));
    }

    // Is this item eligible for an automatic send right now? Missing, invalid
    // or implausibly distant timestamps mean "yes" (never stuck), and so does a
    // record that has changed since the failure the delay was earned for.
    function isRetryDue(item, now) {
        const t = item ? item.nextAttemptAt : undefined;
        if (t === undefined || t === null) return true;
        if (typeof t !== "number" || !isFinite(t)) return true;
        if (t <= now) return true;
        if (t - now > RETRY_CAP_MS + RETRY_CLOCK_SLACK_MS) return true;
        if (item.retryFp !== undefined && item.retryFp !== outboxFingerprint(item)) return true;
        return false;
    }

    function clearRetryState(item) {
        RETRY_FIELDS.forEach(f => { delete item[f]; });
        item.attempts = 0;
        item.lastError = null;
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
                    // Stage 8H-5b: a newer edit starts with a clean slate - no
                    // inherited delay, count or issue from the older version.
                    clearRetryState(existingUpsert);
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
                        // Stage 8H-5b: delay/error metadata described the OLD
                        // target; the operation and data are untouched.
                        ["retryCount", "nextAttemptAt", "retryFp", "lastAttemptAt", "lastErrorClass",
                         "lastErrorCode", "lastErrorSub", "lastHttpStatus"].forEach(f => { delete item[f]; });
                        item.lastError = null;
                        if (typeof item.issue === "string" && item.issue.indexOf("parent-") === 0) {
                            delete item.issue; delete item.issueSince; delete item.issueDetail;
                        }
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

    // Record a failed send. Applies ONLY if the stored item is still exactly
    // the item that was sent (same fingerprint) - a newer coalesced edit is
    // never penalised by an older request's failure. One transaction.
    // meta: { cls, message, code, httpStatus, sub, issue, issueAfter, issueName, now, rand }
    // Resolves { outcome: "recorded"|"changed"|"gone", nextAttemptAt, retryCount, issue }.
    async function recordOutboxFailure(localId, sentItem, meta) {
        meta = meta || {};
        const expected = outboxFingerprint(sentItem);
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            const result = { outcome: "gone", nextAttemptAt: null, retryCount: null, issue: null };
            const req = store.get(localId);
            req.onsuccess = () => {
                const cur = req.result;
                if (!cur) return;
                if (outboxFingerprint(cur) !== expected) { result.outcome = "changed"; return; }
                const now = typeof meta.now === "number" ? meta.now : Date.now();
                const prev = typeof cur.retryCount === "number" && cur.retryCount >= 0 ? cur.retryCount : 0;
                const n = prev + 1;
                cur.attempts = (cur.attempts || 0) + 1;
                cur.retryCount = n;
                cur.lastAttemptAt = now;
                cur.lastError = boundText(meta.message, RETRY_ERROR_TEXT_MAX);
                cur.lastErrorClass = meta.cls || "unexpected";
                if (meta.code) cur.lastErrorCode = String(meta.code).slice(0, 32); else delete cur.lastErrorCode;
                if (meta.sub) cur.lastErrorSub = String(meta.sub).slice(0, 32); else delete cur.lastErrorSub;
                if (typeof meta.httpStatus === "number") cur.lastHttpStatus = meta.httpStatus; else delete cur.lastHttpStatus;
                cur.nextAttemptAt = now + computeBackoffMs(cur.lastErrorClass, n, meta.rand);
                cur.retryFp = expected;
                let issue = meta.issue || null;
                if (!issue && meta.issueAfter && n >= meta.issueAfter) issue = meta.issueName || null;
                // An unverified guess never downgrades an issue a later check has established.
                if (issue === "parent-unverified" && (cur.issue === "parent-missing" || cur.issue === "rejected")) issue = null;
                if (issue) {
                    if (cur.issue !== issue) cur.issueSince = now;
                    cur.issue = issue;
                }
                store.put(cur);
                result.outcome = "recorded";
                result.nextAttemptAt = cur.nextAttemptAt;
                result.retryCount = n;
                result.issue = cur.issue || null;
            };
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Flag an item as needing attention (or update the explanation). Never
    // removes or alters the operation or its data; skipped if the item changed.
    async function markOutboxIssue(localId, sentItem, issue, detail, now) {
        const expected = sentItem ? outboxFingerprint(sentItem) : null;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            let outcome = "gone";
            const req = store.get(localId);
            req.onsuccess = () => {
                const cur = req.result;
                if (!cur) return;
                if (expected !== null && outboxFingerprint(cur) !== expected) { outcome = "changed"; return; }
                const t = typeof now === "number" ? now : Date.now();
                if (cur.issue !== issue) cur.issueSince = t;
                cur.issue = issue;
                if (detail) cur.issueDetail = boundText(detail, 200); else delete cur.issueDetail;
                store.put(cur);
                outcome = "marked";
            };
            tx.oncomplete = () => resolve(outcome);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Clear an issue flag (not the item). options.resetBackoff also makes the
    // item immediately due. Skipped if the item changed since `sentItem`.
    async function clearOutboxIssue(localId, sentItem, options) {
        const expected = sentItem ? outboxFingerprint(sentItem) : null;
        const resetBackoff = !!(options && options.resetBackoff);
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            let outcome = "gone";
            const req = store.get(localId);
            req.onsuccess = () => {
                const cur = req.result;
                if (!cur) return;
                if (expected !== null && outboxFingerprint(cur) !== expected) { outcome = "changed"; return; }
                delete cur.issue; delete cur.issueSince; delete cur.issueDetail;
                if (resetBackoff) { delete cur.nextAttemptAt; delete cur.retryFp; }
                store.put(cur);
                outcome = "cleared";
            };
            tx.oncomplete = () => resolve(outcome);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("Outbox transaction aborted"));
        });
    }

    // Read-only summaries for the UI and the scheduler. Items that automatic
    // passes never send (unknown actions, verified-missing parents) are not
    // counted as "due".
    function skippedByAutomaticPasses(item) {
        return item.issue === "unknown-action" || item.issue === "parent-missing" ||
            (item.action !== "upsert" && item.action !== "delete");
    }

    async function getOutboxSummary(now) {
        const t = typeof now === "number" ? now : Date.now();
        const items = await getPendingOutbox();
        const s = { pending: items.length, sendableDue: 0, deferred: 0, attention: 0, nextDueAt: null, byIssue: {} };
        items.forEach(i => {
            if (i.issue) { s.attention++; s.byIssue[i.issue] = (s.byIssue[i.issue] || 0) + 1; }
            if (skippedByAutomaticPasses(i)) return;
            if (isRetryDue(i, t)) { s.sendableDue++; return; }
            s.deferred++;
            if (s.nextDueAt === null || i.nextAttemptAt < s.nextDueAt) s.nextDueAt = i.nextAttemptAt;
        });
        return s;
    }

    // Items to show in a "sync details" view: issue-bearing or deferred. No
    // record contents - only identifiers and bounded metadata.
    async function getOutboxIssues(now) {
        const t = typeof now === "number" ? now : Date.now();
        const items = await getPendingOutbox();
        return items
            .filter(i => i.issue || !isRetryDue(i, t) || (i.lastErrorClass && i.retryCount))
            .map(i => ({
                localId: i.localId,
                table: i.table,
                action: i.action,
                recordId: i.record && i.record.id ? String(i.record.id) : null,
                createdAt: i.createdAt,
                attempts: i.attempts || 0,
                retryCount: i.retryCount || 0,
                nextAttemptAt: typeof i.nextAttemptAt === "number" ? i.nextAttemptAt : null,
                lastAttemptAt: typeof i.lastAttemptAt === "number" ? i.lastAttemptAt : null,
                lastErrorClass: i.lastErrorClass || null,
                lastErrorCode: i.lastErrorCode || null,
                lastErrorSub: i.lastErrorSub || null,
                lastHttpStatus: typeof i.lastHttpStatus === "number" ? i.lastHttpStatus : null,
                lastError: i.lastError ? boundText(i.lastError, RETRY_ERROR_TEXT_MAX) : null,
                issue: i.issue || null,
                issueSince: i.issueSince || null,
                issueDetail: i.issueDetail ? boundText(i.issueDetail, 200) : null,
                due: isRetryDue(i, t)
            }));
    }

    // Read-only snapshot of every queued (pending) operation INCLUDING record
    // contents, for the person to keep as a recovery copy. Changes nothing.
    async function exportPendingOutbox() {
        const items = await getPendingOutbox();
        return {
            exportedAt: new Date().toISOString(),
            app: "Rampur Free Tuition",
            database: DB_NAME,
            count: items.length,
            items: JSON.parse(JSON.stringify(items))
        };
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

    // Parent rows (students / exams) of a child item that are themselves still
    // queued: a foreign-key failure then just means "parent not there yet".
    function hasPendingParent(item, items) {
        const r = item.record || {};
        return items.some(o => o.localId !== item.localId && o.action === "upsert" && o.record && (
            (o.table === "students" && r.student_id && o.record.id === r.student_id) ||
            (o.table === "exams" && r.exam_id && o.record.id === r.exam_id)));
    }

    function looksAuthRelated(error, status) {
        const code = error && error.code ? String(error.code) : "";
        const msg = error && error.message ? String(error.message).toLowerCase() : "";
        return status === 401 || status === 403 || code === "42501" || /^PGRST30\d$/.test(code) ||
            /jwt|not authenticated|permission denied|row-level security/.test(msg);
    }

    // true = a signed-in session exists, false = confirmed none, null = unknown.
    async function probeSession(client) {
        try {
            if (!client || !client.auth || typeof client.auth.getSession !== "function") return null;
            const r = await withTimeout(client.auth.getSession(), 8000, "Session check");
            if (r && r.error) return null;
            const session = r && r.data ? r.data.session : null;
            return !!(session && session.access_token);
        } catch (e) {
            return null;
        }
    }

    // options (all optional; with none the behaviour is the pre-8H-5b "send
    // everything" pass, except that nothing is ever dropped):
    //   respectBackoff  skip items whose nextAttemptAt is still in the future
    //   force           ignore backoff (manual sync)
    //   bypassClasses   items whose last failure class is listed ("network" /
    //                   "timeout" only) are sent even if delayed
    //   gate(item, {force})  -> "send" | anything else = skip this pass
    async function processOutbox(supabaseClient, options) {

        if (syncing) return { ok: false, reason: "already-syncing" };
        if (!isOnline()) return { ok: false, reason: "offline" };

        options = options || {};
        const respectBackoff = options.respectBackoff === true;
        const force = options.force === true;
        const bypassClasses = (Array.isArray(options.bypassClasses) ? options.bypassClasses : [])
            .filter(c => c === "network" || c === "timeout");
        const gate = typeof options.gate === "function" ? options.gate : null;

        syncing = true;
        notifySyncListeners({ phase: "start" });

        let succeeded = 0;
        let failed = 0;
        let deferred = 0;
        let retained = 0;
        let skipped = 0;
        let aborted = false;
        let retryAfterMs = null;
        let networkStreak = 0;

        try {
            const items = await getPendingOutbox();

            // Persist a classified failure (conditionally - see recordOutboxFailure).
            const recordFailure = async (item, c) => {
                failed++;
                try {
                    const r = await recordOutboxFailure(item.localId, item, {
                        cls: c.cls, message: c.message, code: c.code, httpStatus: c.httpStatus, sub: c.sub,
                        issue: c.issue, issueAfter: c.issueAfter, issueName: c.issueName
                    });
                    if (r && r.outcome === "changed") retained++;
                    return r;
                } catch (metaErr) {
                    // Never let bookkeeping break the pass; the item is untouched.
                    console.warn("Could not record outbox failure metadata:", metaErr);
                    return null;
                }
            };

            // Returns true when the pass should stop (consecutive network-level failures).
            const noteFailure = (c, r) => {
                if (c.cls === "network" || c.cls === "timeout") {
                    networkStreak++;
                    retryAfterMs = r && typeof r.nextAttemptAt === "number"
                        ? Math.max(1000, r.nextAttemptAt - Date.now()) : 15000;
                    if (networkStreak >= RETRY_NETWORK_STREAK_LIMIT) { aborted = true; return true; }
                } else {
                    networkStreak = 0;
                }
                return false;
            };

            for (const item of items) {

                // Unknown action: never sent, never removed - flagged for review.
                if (item.action !== "upsert" && item.action !== "delete") {
                    skipped++;
                    if (item.issue !== "unknown-action") {
                        try {
                            await markOutboxIssue(item.localId, item, "unknown-action",
                                "Unknown operation type; kept unsent for review.");
                        } catch (e) { console.warn("Could not flag unknown outbox action:", e); }
                    }
                    continue;
                }

                if (respectBackoff && !force && bypassClasses.indexOf(item.lastErrorClass) === -1 &&
                    !isRetryDue(item, Date.now())) {
                    deferred++;
                    continue;
                }

                if (gate) {
                    let verdict = "skip";
                    try { verdict = await gate(item, { force }); } catch (gateErr) { verdict = "skip"; }
                    if (verdict !== "send") { skipped++; continue; }
                }

                try {
                    let error = null;
                    let status = null;

                    if (item.action === "upsert") {
                        const res = await withAbortableTimeout(
                            supabaseClient.from(item.table).upsert(item.record),
                            20000,
                            "Upsert"
                        );
                        error = res.error;
                        status = res.status;
                    } else {
                        const res = await withAbortableTimeout(
                            supabaseClient.from(item.table).delete().eq("id", item.record.id).select("id"),
                            20000,
                            "Delete"
                        );
                        error = res.error;
                        status = res.status;

                        // error === null does NOT necessarily mean the row was
                        // actually deleted: if RLS filters the row out, or the row
                        // is already gone, PostgREST reports a normal response
                        // with zero rows. Stage 8H-5b: such a delete is NEVER
                        // dropped or cleared automatically - it stays queued with
                        // backoff and a visible "delete-unconfirmed" issue until a
                        // person resolves it in a future, approved step.
                        if (!error && Array.isArray(res.data) && res.data.length === 0) {
                            const c = classifyOutboxFailure({ operation: "delete", table: item.table, zeroRow: true });
                            const r = await recordFailure(item, c);
                            if (noteFailure(c, r)) break;
                            continue;
                        }
                    }

                    if (error) {
                        let hasSession = null;
                        if (looksAuthRelated(error, status)) hasSession = await probeSession(supabaseClient);
                        const c = classifyOutboxFailure({
                            operation: item.action, table: item.table, status, error, hasSession,
                            online: isOnline(), parentPending: hasPendingParent(item, items)
                        });
                        const r = await recordFailure(item, c);
                        if (noteFailure(c, r)) break;
                        continue; // leave it queued; the delay decides when it is retried
                    }

                    // Stage 8H-5a: remove only if the item is still exactly what was
                    // sent. If the teacher edited the same record while this request was
                    // in flight, the newer version stays pending for a follow-up pass.
                    const removal = await removeOutboxIfUnchanged(item.localId, item);
                    succeeded++;
                    if (removal === "changed") retained++;
                    networkStreak = 0;

                } catch (err) {
                    const c = classifyOutboxFailure({
                        operation: item.action, table: item.table, thrown: err, online: isOnline()
                    });
                    const r = await recordFailure(item, c);
                    if (noteFailure(c, r)) break;
                    if (!isOnline()) break;
                }
            }
        } finally {
            syncing = false;
        }

        notifySyncListeners({ phase: "end", succeeded, failed });
        return { ok: true, succeeded, failed, deferred, retained, skipped, aborted, retryAfterMs };
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
        recordOutboxFailure,
        markOutboxIssue,
        clearOutboxIssue,
        getOutboxSummary,
        getOutboxIssues,
        exportPendingOutbox,
        classifyOutboxFailure,
        computeBackoffMs,
        isRetryDue,
        boundText,
        RETRY_CAP_MS,
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

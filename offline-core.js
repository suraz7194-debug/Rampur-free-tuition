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
    const DB_VERSION = 1;

    // Tables that are mirrored locally and synced to Supabase.
    const TABLES = ["students", "groups", "attendance", "fees", "exams", "results"];

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

    async function enqueue(table, action, record) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            const item = {
                table,
                action,          // 'upsert' | 'delete'
                record,          // full row for upsert, { id } for delete
                status: "pending",
                attempts: 0,
                lastError: null,
                createdAt: Date.now()
            };
            const req = store.add(item);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
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

    async function updateOutboxItem(localId, updates) {
        const item = await get("outbox", localId);
        if (!item) return;
        Object.assign(item, updates);
        await put("outbox", item);
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
                        const res = await supabaseClient
                            .from(item.table)
                            .upsert(item.record);
                        error = res.error;
                    } else if (item.action === "delete") {
                        const res = await supabaseClient
                            .from(item.table)
                            .delete()
                            .eq("id", item.record.id);
                        error = res.error;
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

                    await removeFromOutbox(item.localId);
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
        getDatabaseInfo
    };

    openDB()
        .then(() => requestPersistentStorage())
        .then(() => console.log("RFT offline core ready."))
        .catch(err => console.error("RFT offline core failed:", err));

})();

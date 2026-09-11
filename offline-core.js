/* =========================================================
   RAMPUR FREE TUITION
   OFFLINE-FIRST CORE
   ========================================================= */

(() => {

    "use strict";

    const DB_NAME = "RampurFreeTuitionOffline";
    const DB_VERSION = 1;

    const STORES = [
        "students",
        "groups",
        "attendance",
        "fees",
        "exams",
        "results",
        "syncQueue",
        "meta"
    ];

    let dbPromise = null;

    /* =====================================================
       OPEN DATABASE
       ===================================================== */

    function openDB() {

        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {

            const request = indexedDB.open(
                DB_NAME,
                DB_VERSION
            );

            request.onupgradeneeded = event => {

                const db = event.target.result;

                STORES.forEach(storeName => {

                    if (!db.objectStoreNames.contains(storeName)) {

                        if (storeName === "syncQueue") {

                            const store =
                                db.createObjectStore(
                                    storeName,
                                    {
                                        keyPath: "queueId",
                                        autoIncrement: true
                                    }
                                );

                            store.createIndex(
                                "createdAt",
                                "createdAt"
                            );

                            store.createIndex(
                                "status",
                                "status"
                            );

                        } else {

                            db.createObjectStore(
                                storeName,
                                {
                                    keyPath: "id"
                                }
                            );

                        }

                    }

                });

            };

            request.onsuccess = () => {

                const db = request.result;

                db.onversionchange = () => {
                    db.close();
                };

                resolve(db);

            };

            request.onerror = () => {

                console.error(
                    "IndexedDB open failed:",
                    request.error
                );

                reject(request.error);

            };

        });

        return dbPromise;
    }


    /* =====================================================
       GENERIC GET ALL
       ===================================================== */

    async function getAll(storeName) {

        const db = await openDB();

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    storeName,
                    "readonly"
                );

            const store =
                transaction.objectStore(
                    storeName
                );

            const request =
                store.getAll();

            request.onsuccess = () => {

                resolve(
                    request.result || []
                );

            };

            request.onerror = () => {

                reject(request.error);

            };

        });

    }


    /* =====================================================
       GET ONE
       ===================================================== */

    async function get(storeName, id) {

        const db = await openDB();

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    storeName,
                    "readonly"
                );

            const store =
                transaction.objectStore(
                    storeName
                );

            const request =
                store.get(id);

            request.onsuccess = () => {

                resolve(
                    request.result || null
                );

            };

            request.onerror = () => {

                reject(request.error);

            };

        });

    }


    /* =====================================================
       PUT
       ===================================================== */

    async function put(storeName, value) {

        const db = await openDB();

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    storeName,
                    "readwrite"
                );

            const store =
                transaction.objectStore(
                    storeName
                );

            const request =
                store.put(value);

            request.onsuccess = () => {

                resolve(request.result);

            };

            request.onerror = () => {

                reject(request.error);

            };

        });

    }


    /* =====================================================
       DELETE
       ===================================================== */

    async function remove(storeName, id) {

        const db = await openDB();

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    storeName,
                    "readwrite"
                );

            const store =
                transaction.objectStore(
                    storeName
                );

            const request =
                store.delete(id);

            request.onsuccess = () => {

                resolve(true);

            };

            request.onerror = () => {

                reject(request.error);

            };

        });

    }


    /* =====================================================
       SAVE MANY
       ===================================================== */

    async function putMany(storeName, items) {

        if (!Array.isArray(items)) {
            return;
        }

        const db = await openDB();

        return new Promise((resolve, reject) => {

            const transaction =
                db.transaction(
                    storeName,
                    "readwrite"
                );

            const store =
                transaction.objectStore(
                    storeName
                );

            items.forEach(item => {

                if (
                    item &&
                    item.id !== undefined &&
                    item.id !== null
                ) {

                    store.put(item);

                }

            });

            transaction.oncomplete = () => {

                resolve(true);

            };

            transaction.onerror = () => {

                reject(transaction.error);

            };

        });

    }


    /* =====================================================
       PERSISTENT STORAGE
       ===================================================== */

    async function requestPersistentStorage() {

        try {

            if (
                navigator.storage &&
                navigator.storage.persist
            ) {

                const alreadyPersistent =
                    await navigator.storage.persisted();

                if (!alreadyPersistent) {

                    const granted =
                        await navigator.storage.persist();

                    console.log(
                        "Persistent storage:",
                        granted
                    );

                } else {

                    console.log(
                        "Persistent storage already enabled."
                    );

                }

            }

        } catch (error) {

            console.warn(
                "Persistent storage request failed:",
                error
            );

        }

    }


    /* =====================================================
       SYNC QUEUE
       ===================================================== */

    async function queueChange({
        table,
        action,
        record,
        localId = null
    }) {

        const item = {

            table,

            action,

            record,

            localId,

            status: "pending",

            createdAt:
                new Date().toISOString()

        };

        return await put(
            "syncQueue",
            item
        );

    }


    /* =====================================================
       GET PENDING QUEUE
       ===================================================== */

    async function getPendingChanges() {

        const items =
            await getAll("syncQueue");

        return items
            .filter(
                item =>
                    item.status === "pending"
            )
            .sort(
                (a, b) =>
                    a.queueId - b.queueId
            );

    }


    /* =====================================================
       UPDATE QUEUE ITEM
       ===================================================== */

    async function updateQueueItem(
        queueId,
        updates
    ) {

        const item =
            await get(
                "syncQueue",
                queueId
            );

        if (!item) {
            return;
        }

        Object.assign(
            item,
            updates
        );

        await put(
            "syncQueue",
            item
        );

    }


    /* =====================================================
       DATABASE SNAPSHOT STATUS
       ===================================================== */

    async function setMeta(
        key,
        value
    ) {

        await put(
            "meta",
            {
                id: key,
                value: value
            }
        );

    }


    async function getMeta(key) {

        const item =
            await get(
                "meta",
                key
            );

        return item
            ? item.value
            : null;

    }


    /* =====================================================
       ONLINE STATUS
       ===================================================== */

    function isOnline() {

        return navigator.onLine === true;

    }


    /* =====================================================
       DEBUG INFORMATION
       ===================================================== */

    async function getDatabaseInfo() {

        const info = {};

        for (
            const storeName of STORES
        ) {

            info[storeName] =
                await getAll(
                    storeName
                );

        }

        return info;

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.RFTOffline = {

        openDB,

        getAll,

        get,

        put,

        remove,

        putMany,

        queueChange,

        getPendingChanges,

        updateQueueItem,

        setMeta,

        getMeta,

        requestPersistentStorage,

        isOnline,

        getDatabaseInfo

    };


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    openDB()
        .then(async () => {

            await requestPersistentStorage();

            console.log(
                "✅ RFT Offline Core ready."
            );

        })
        .catch(error => {

            console.error(
                "❌ RFT Offline Core failed:",
                error
            );

        });


})();
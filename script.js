let selectedStudentPhoto = "";
let selectedEditPhoto = "";
let selectedHistoryStudentId = null;

/* =====================================================
   SUPABASE
===================================================== */

const SUPABASE_URL = "https://gkbhqpikqnhmwqyeamwq.supabase.co";
const SUPABASE_KEY = "sb_publishable_jEydXwqKEqmdmlRPYLAQ9g_wMesM0Kh";

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);


/* =====================================================
   OWNER / TEACHER DETECTION (Finance access control)

   This is a UI/behavior convenience layer ONLY - it decides what
   THIS DEVICE shows and attempts (nav button, Finance section,
   Finance add/edit/delete, what gets pulled/pushed). It is NOT the
   real security boundary: Supabase Row Level Security on the
   "finance" table (using public.is_owner()) is, and stays, the
   authoritative layer. Even if this client-side check were wrong,
   tampered with, or bypassed entirely, a non-owner's actual
   Supabase requests still have to pass RLS to succeed or return
   data.

   Ownership is determined by a ROLE LOOKUP against the
   public.user_roles table (role = 'owner' or 'teacher'), not by
   comparing the signed-in user's id to any single hardcoded UID.
   This matches the database, which supports multiple simultaneous
   owners (the current seeded owner, and later a second owner
   account) via that same table - there is no "the one owner UID"
   concept on either side anymore.

   currentUserId/currentUserRole are populated from the real
   Supabase Auth session (signInWithPassword's response, or
   getSession()) and a live query against user_roles - never
   invented, never assumed. rftUserId/rftUserRole in localStorage
   are only a cache of those same values so the UI can restore its
   owner/teacher state instantly, including offline (see
   cacheUserId/cacheUserRole below) - neither is itself checked by
   anything on the server.
===================================================== */

let currentUserId = null;
let currentUserRole = null; // 'owner' | 'teacher' | null (no row / unknown)

function isOwner() {
    return currentUserRole === "owner";
}

function isTeacher() {
    return currentUserRole === "teacher";
}

function cacheUserId(id) {
    currentUserId = id || null;
    if (currentUserId) {
        localStorage.setItem("rftUserId", currentUserId);
    } else {
        localStorage.removeItem("rftUserId");
    }
}

function cacheUserRole(role) {
    currentUserRole = role || null;
    if (currentUserRole) {
        localStorage.setItem("rftUserRole", currentUserRole);
    } else {
        localStorage.removeItem("rftUserRole");
    }
}

/* Looks up the given Supabase Auth user's role from user_roles.
   Returns "owner", "teacher", null (authenticated but no role row
   - e.g. a not-yet-assigned future account, correctly treated as
   no special access), or undefined if the lookup itself couldn't
   be performed (offline, network error) - callers should keep
   whatever role was previously cached rather than treat undefined
   as "no role", since that would incorrectly demote someone on a
   transient failure. RLS on user_roles ("Users can view own role")
   already allows any authenticated user to read their own row, so
   this works identically for owners and teachers. */
async function fetchUserRole(userId) {
    if (!userId) return null;
    try {
        const { data, error } = await supabaseClient
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .maybeSingle();
        if (error) {
            console.warn("Could not fetch user role:", error);
            return undefined;
        }
        return data ? data.role : null;
    } catch (err) {
        console.warn("Could not fetch user role:", err);
        return undefined;
    }
}

/* Hides/shows the Finance nav button and Finance section based on
   isOwner(). Called once currentUserId is known (see initApp below).
   This is the UI half of Finance access control - see the owner
   checks inside the Finance functions themselves (addFinance,
   renderFinance, etc.) for the part that holds even if this UI step
   is somehow skipped or a Finance function is called directly. */
/* Hides/shows a nav button and, defensively, bounces the user off its
   section back to Dashboard if it's somehow left active for someone
   who shouldn't be there (e.g. stale UI state on a shared device).
   Shared by Finance and Backup below - same pattern, just parameterized
   by which button/section it applies to. */
function applyNavVisibility(navButtonId, sectionId, allowed) {
    let navButton = document.getElementById(navButtonId);
    if (navButton) navButton.style.display = allowed ? "" : "none";

    let section = document.getElementById(sectionId);
    if (section && !allowed && section.classList.contains("active")) {
        document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
        document.querySelectorAll("nav button").forEach(btn => btn.classList.remove("active"));

        let dashboard = document.getElementById("dashboard");
        if (dashboard) dashboard.classList.add("active");

        let dashboardBtn = document.querySelector("nav button[onclick^=\"showSection('dashboard'\"]");
        if (dashboardBtn) dashboardBtn.classList.add("active");
    }
}

function applyOwnerVisibility() {
    let owner = isOwner();

    // Finance - unchanged behavior from before, just now expressed
    // through the shared helper above.
    applyNavVisibility("financeNavButton", "fees", owner);

    // Backup/Restore (Stage 1 of the teacher permission fix) - same
    // pattern, applied to the Backup nav button/section. The Backup
    // section contains both Backup and Restore in one place, so hiding
    // this one button/section covers both, matching importData()'s and
    // exportData()'s own owner-only guards.
    applyNavVisibility("backupNavButton", "backup", owner);

    // Delete Exam button (Stage 1) - a static button, not part of a
    // per-item render loop like the student cards, so it's toggled
    // here rather than inline in a template.
    let deleteExamButton = document.getElementById("deleteExamButton");
    if (deleteExamButton) deleteExamButton.style.display = owner ? "" : "none";

    // Events & Notices: Owner can add/edit/delete, Teacher can only
    // view. Unlike Finance/Backup, the Events NAV BUTTON and SECTION
    // stay visible to everyone - only the Add/Edit form panel is
    // owner-only, toggled here the same way deleteExamButton is above.
    // (The per-card edit/delete ⋮ menu is gated separately, inline in
    // renderEvents(), since it depends on isOwner() per render, not
    // just at login/role-refresh time.)
    let eventFormPanel = document.getElementById("eventFormPanel");
    if (eventFormPanel) eventFormPanel.style.display = owner ? "" : "none";

    // TEMPORARY (Stage 6A): owner-only Send Test Push panel. Hidden in
    // the HTML by default; only ever shown here. Remove with the panel.
    let pushTestPanel = document.getElementById("pushTestPanel");
    if (pushTestPanel) pushTestPanel.style.display = owner ? "" : "none";

    // TEMPORARY (Stage 7B-test): owner-only Absence Alert Engine dry-run panel.
    // Hidden in the HTML by default; only ever shown here. Remove with the panel.
    let absenceEngineTestPanel = document.getElementById("absenceEngineTestPanel");
    if (absenceEngineTestPanel) absenceEngineTestPanel.style.display = owner ? "" : "none";

    // TEMPORARY (Stage 7C): owner-only Absence Push Test panel. Hidden in the
    // HTML by default; only ever shown here. Remove with the panel.
    let absencePushTestPanel = document.getElementById("absencePushTestPanel");
    if (absencePushTestPanel) absencePushTestPanel.style.display = owner ? "" : "none";

    // TEMPORARY (live verification of Stage 7D only) - owner-only UI test tools panel.
    let absenceUITestPanel = document.getElementById("absenceUITestPanel");
    if (absenceUITestPanel) absenceUITestPanel.style.display = owner ? "" : "none";
}

/* =====================================================
   WEB PUSH NOTIFICATIONS (Stage 3 - client foundation only)

   This is ONLY the client-side plumbing: request permission, create
   a browser Push subscription, and store it in the existing
   "notification_subscriptions" Supabase table (added in Stage 2).
   No server-side scheduler exists yet, so nothing will actually be
   sent as a result of this - that is a later stage. Uses the same
   currentUserId/supabaseClient as the rest of the app; no separate
   auth mechanism.

   VAPID_PUBLIC_KEY is intentionally empty: no VAPID key pair has
   been generated for this project yet. Only the PUBLIC half of a
   VAPID key may ever go here - never the private key. Until a real
   key is configured, enablePushNotifications() still requests
   permission (so that part can be tested) but stops before calling
   pushManager.subscribe(), since subscribing requires a valid
   applicationServerKey.
===================================================== */

const VAPID_PUBLIC_KEY = "BO-xj4JzWHWuYfYfwRQB0mD0dUoPylT2vaoF5V-1Vxnp8yAj_Sq6I9VWgywZpHpdRIuZLCUNLCTKX3RHbQ-k_8g"; // PUBLIC key only. Private key lives in Supabase Edge Function secrets, never here.

function pushNotificationsSupported() {
    return ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window);
}

// Converts a base64url VAPID public key (the format it's normally
// generated/shared in) into the Uint8Array pushManager.subscribe() needs.
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function setNotificationStatusText(text) {
    let el = document.getElementById("notificationStatusText");
    if (el) el.innerText = text;
}

/* Reflects the CURRENT state only (supported? permission? existing
   subscription?) - never itself prompts for permission. Safe to call
   on every app load/render. */
async function refreshNotificationUI() {
    let button = document.getElementById("notificationEnableButton");
    if (!button) return;

    if (!pushNotificationsSupported()) {
        button.style.display = "none";
        setNotificationStatusText("Notifications aren't supported on this browser/device.");
        return;
    }

    button.style.display = "";

    if (Notification.permission === "denied") {
        button.disabled = true;
        button.innerText = "🔔 Enable Notifications";
        setNotificationStatusText("Notifications are blocked in this browser's site settings.");
        return;
    }

    button.disabled = false;

    try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (existing) {
            button.innerText = "🔕 Disable Notifications";
            button.onclick = disablePushNotifications;
            setNotificationStatusText("Notifications are enabled on this device.");
        } else {
            button.innerText = "🔔 Enable Notifications";
            button.onclick = enablePushNotifications;
            setNotificationStatusText(
                VAPID_PUBLIC_KEY
                    ? "Notifications are off on this device."
                    : "Notifications aren't fully set up yet (server key pending)."
            );
        }
    } catch (err) {
        console.warn("Could not check existing push subscription:", err);
    }
}

/* Only ever called from the "Enable Notifications" button's onclick,
   i.e. an explicit user action - never automatically on page load. */
async function enablePushNotifications() {
    if (!pushNotificationsSupported()) {
        alert("Notifications aren't supported on this browser/device.");
        return;
    }

    if (!currentUserId) {
        alert("Please log in first.");
        return;
    }

    let permission;
    try {
        permission = await Notification.requestPermission();
    } catch (err) {
        console.error("Notification permission request failed:", err);
        setNotificationStatusText("Couldn't request notification permission.");
        return;
    }

    if (permission !== "granted") {
        setNotificationStatusText(
            permission === "denied"
                ? "Notifications are blocked in this browser's site settings."
                : "Notification permission was not granted."
        );
        return;
    }

    if (!VAPID_PUBLIC_KEY) {
        // Matches the project instruction: do not invent/store a VAPID
        // key here. A server-side VAPID key pair (public half placed in
        // VAPID_PUBLIC_KEY above) must exist before a real subscription
        // can be created - see the assistant's Stage 3 report.
        console.warn(
            "Push subscription skipped: no VAPID public key configured yet."
        );
        setNotificationStatusText(
            "Permission granted, but push isn't fully set up yet (server key pending)."
        );
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        await saveSubscriptionToSupabase(subscription);
        await refreshNotificationUI();
    } catch (err) {
        // Covers "offline during subscribe", "permission changed mid-flow",
        // etc. - fails gracefully, no retry loop.
        console.error("Push subscription failed:", err);
        setNotificationStatusText("Couldn't enable notifications right now. Try again when online.");
    }
}

async function disablePushNotifications() {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            await deactivateSubscriptionInSupabase(subscription.endpoint, currentUserId);
            await subscription.unsubscribe();
        }

        await refreshNotificationUI();
    } catch (err) {
        console.error("Failed to disable notifications:", err);
        setNotificationStatusText("Couldn't disable notifications right now.");
    }
}

/* Upserts on "endpoint" (unique in the DB - see Stage 2), so
   re-enabling on the same device/browser updates the existing row
   instead of creating a duplicate. RLS (Stage 2) already restricts
   this to rows where user_id = auth.uid(), so this can never write
   another user's subscription. */
async function saveSubscriptionToSupabase(subscription) {
    const json = subscription.toJSON();
    const row = {
        user_id: currentUserId,
        endpoint: json.endpoint,
        p256dh: json.keys ? json.keys.p256dh : null,
        auth: json.keys ? json.keys.auth : null,
        active: true,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
        .from("notification_subscriptions")
        .upsert(row, { onConflict: "endpoint" });

    if (error) {
        console.error("Could not save push subscription to Supabase:", error);
        throw error;
    }
}

/* Marks a subscription inactive rather than deleting the row, and is
   scoped to both endpoint AND the given user id - RLS enforces the
   same restriction server-side regardless. */
async function deactivateSubscriptionInSupabase(endpoint, userId) {
    if (!endpoint || !userId) return;

    try {
        const { error } = await supabaseClient
            .from("notification_subscriptions")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("endpoint", endpoint)
            .eq("user_id", userId);

        if (error) console.warn("Could not deactivate push subscription in Supabase:", error);
    } catch (err) {
        // Offline/network failure - best effort only, no retry loop.
        console.warn("Could not deactivate push subscription (offline?):", err);
    }
}

/* Best-effort, fire-and-forget: deactivates THIS device's subscription
   row for the user who is logging out, without unsubscribing the
   browser itself (so re-enabling after logging back in is instant).
   Never blocks logout and never throws. */
async function deactivateCurrentDeviceSubscriptionOnLogout(userId) {
    if (!userId || !("serviceWorker" in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await deactivateSubscriptionInSupabase(subscription.endpoint, userId);
        }
    } catch (err) {
        console.warn("Could not deactivate push subscription on logout:", err);
    }
}

/* ---------- LOCAL TEST NOTIFICATION (dev/testing only) ----------
   Shows a notification through the service worker WITHOUT sending a
   real Web Push message, and without writing anything to
   notification_logs/absence_alerts/events. This only proves that
   showNotification() and the service-worker registration work on
   THIS device - it is NOT a test of server-side delivery, and it is
   not wired to any button (console-only, so it can't clutter the
   production UI and is easy to remove later).

   Run from the browser console after granting permission:
     testLocalNotification()
===================================================== */
async function testLocalNotification() {
    if (!pushNotificationsSupported()) {
        console.warn("Notifications aren't supported on this browser/device.");
        return;
    }
    if (Notification.permission !== "granted") {
        console.warn("Grant notification permission first, then re-run testLocalNotification().");
        return;
    }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("🔔 Local test (not a real push)", {
        body: "This is a local service-worker test notification only - no server involved.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        data: { url: "./" }
    });
}

/* =====================================================
   TEMPORARY (Stage 6A) - OWNER-ONLY "SEND TEST PUSH" BUTTON HANDLER
   Invokes the already-deployed "push-test" Edge Function with the
   existing authenticated Supabase session. Sends no recipient, no
   payload, no keys. The function itself requires a valid JWT and only
   ever targets the caller's own active subscription.
   NOTE: a success result means only that the push service ACCEPTED the
   request - NOT that the phone displayed a notification.
   Remove this function, pushTestPanel in index.html, and the one line
   in applyOwnerVisibility() when testing is finished.
===================================================== */
let pushTestInFlight = false;

async function sendTestPush() {
    if (!isOwner()) return;          // defensive: UI is already hidden for non-owners
    if (pushTestInFlight) return;    // prevent duplicate simultaneous requests

    const button = document.getElementById("pushTestButton");
    const status = document.getElementById("pushTestStatus");
    const setStatus = text => { if (status) status.innerText = text; };

    if (!navigator.onLine) {
        setStatus("❌ Push test failed: this device is offline.");
        return;
    }

    pushTestInFlight = true;
    if (button) button.disabled = true;
    setStatus("Sending test push request...");

    try {
        const { data, error } = await supabaseClient.functions.invoke("push-test");

        if (error) {
            // Non-2xx: the function's JSON body carries a safe, plain-language
            // message (it never contains secrets). Only that message is shown.
            let message = "request failed.";
            try {
                if (error.context && typeof error.context.json === "function") {
                    const body = await error.context.json();
                    if (body && typeof body.error === "string") message = body.error;
                }
            } catch (_) { /* body unreadable - keep generic message */ }
            setStatus("❌ Push test failed: " + message);
        } else if (data && data.ok === true) {
            setStatus("✅ Push request accepted — check your phone. (This does not prove it was displayed.)");
        } else {
            setStatus("❌ Push test failed: unexpected response.");
        }
    } catch (err) {
        console.warn("Send test push failed:", err);
        setStatus("❌ Push test failed: could not reach the server.");
    } finally {
        pushTestInFlight = false;
        if (button) button.disabled = false;
    }
}

/* =====================================================
   TEMPORARY (Stage 7B-test) - OWNER-ONLY "RUN DRY TEST" HANDLER
   Invokes the already-deployed "absence-alert-engine" Edge Function in
   DRY-RUN mode using the existing authenticated Supabase session.

   Contract (verified against the deployed function): POST with a JSON body;
   the function only writes when the body has apply === true. This handler
   ALWAYS sends { apply: false } and never sends apply: true. It also refuses
   to show a result as OK unless the function itself reports dryRun === true.

   Displays only an allow-listed set of numbers/labels from the response -
   never the raw response, headers or tokens. Remove this function,
   absenceEngineTestPanel in index.html, and the one block in
   applyOwnerVisibility() when testing is finished.
===================================================== */
let absenceEngineTestInFlight = false;

async function runAbsenceEngineDryTest() {
    if (!isOwner()) return;                     // defensive: UI is already hidden for non-owners
    if (absenceEngineTestInFlight) return;      // prevent duplicate simultaneous requests

    const button = document.getElementById("absenceEngineTestButton");
    const status = document.getElementById("absenceEngineTestStatus");
    const setStatus = text => { if (status) status.textContent = text; };
    const num = v => (typeof v === "number" && isFinite(v)) ? String(v) : "?";

    if (!navigator.onLine) {
        setStatus("Absence engine test failed: this device is offline.");
        return;
    }

    absenceEngineTestInFlight = true;
    if (button) { button.disabled = true; button.textContent = "⏳ Running..."; }
    setStatus("Running dry test...");

    try {
        const { data, error } = await supabaseClient.functions.invoke("absence-alert-engine", {
            body: { apply: false }              // explicit DRY RUN - never true from this UI
        });

        if (error) {
            // Non-2xx: the function's JSON body carries a safe plain-language message.
            let message = "request failed.";
            try {
                if (error.context && typeof error.context.json === "function") {
                    const body = await error.context.json();
                    if (body && typeof body.error === "string") message = body.error;
                }
            } catch (_) { /* body unreadable - keep generic message */ }
            setStatus("Absence engine test failed: " + message);
        } else if (!data || data.ok !== true) {
            setStatus("Absence engine test failed: unexpected response.");
        } else if (data.dryRun !== true) {
            // Must never happen from this UI; refuse to present it as a dry-run result.
            setStatus("⚠ The function did not report dry-run mode. Do not rely on this result - check the database.");
        } else {
            const planned = data.planned || {};
            const applied = data.applied || {};
            const lines = [
                "✅ Dry run completed (dry-run mode confirmed by the function).",
                "Students evaluated: " + num(data.studentsEvaluated),
                "Attendance rows read: " + num(data.attendanceRowsRead),
                "Open alerts read: " + num(data.openAlertsRead),
                "Would create: " + num(planned.create) +
                    " · Would update: " + num(planned.update) +
                    " · Would resolve: " + num(planned.resolve),
                "No change needed: " + num(data.unchanged),
                "Applied (must be 0 in a dry run): create " + num(applied.create) +
                    ", update " + num(applied.update) + ", resolve " + num(applied.resolve)
            ];
            const actions = Array.isArray(data.actions) ? data.actions.slice(0, 5) : [];
            actions.forEach(a => {
                const type = ["create", "update", "resolve"].includes(a && a.type) ? a.type : "?";
                const sid = (a && typeof a.student_id === "string") ? a.student_id.slice(0, 8) : "?";
                lines.push("  • would " + type + " — student " + sid + "…" +
                    (typeof a.absent_count === "number" ? " (" + a.absent_count + " absences)" : ""));
            });
            setStatus(lines.join("\n"));
        }
    } catch (err) {
        console.warn("Absence engine dry test failed:", err);
        setStatus("Absence engine test failed: could not reach the server.");
    } finally {
        absenceEngineTestInFlight = false;
        if (button) { button.disabled = false; button.textContent = "▶ Run Dry Test"; }
    }
}

/* =====================================================
   TEMPORARY (Stage 7C) - OWNER-ONLY "SEND TEST ABSENCE PUSH" HANDLER
   Invokes the deployed "absence-alert-notify" Edge Function in its
   SYNTHETIC test mode: one clearly-labelled TEST notification is sent to
   the logged-in Owner's OWN subscribed devices only. No absence_alerts
   row is read, created or changed, and no real student/attendance data
   is involved. The request carries only { mode: "synthetic" } - no
   recipient, content, key or alert id can be supplied from here.
   Results are shown from an allow-list of labels/numbers only.
   NOTE: "accepted" means the push service accepted the request, NOT
   that the phone displayed it.
   Remove this function, absencePushTestPanel in index.html, and the one
   block in applyOwnerVisibility() when testing is finished.
===================================================== */
let absencePushTestInFlight = false;

async function runAbsencePushTest() {
    if (!isOwner()) return;                     // defensive: UI is already hidden for non-owners
    if (absencePushTestInFlight) return;        // prevent duplicate simultaneous requests

    const button = document.getElementById("absencePushTestButton");
    const status = document.getElementById("absencePushTestStatus");
    const setStatus = text => { if (status) status.textContent = text; };
    const num = v => (typeof v === "number" && isFinite(v)) ? v : 0;

    if (!navigator.onLine) {
        setStatus("Absence push test failed: this device is offline.");
        return;
    }

    absencePushTestInFlight = true;
    if (button) { button.disabled = true; button.textContent = "⏳ Sending..."; }
    setStatus("Sending test push request...");

    const messages = {
        already_sent_today: "ℹ️ Already sent today for this test — duplicate protection worked. No new notification was sent.",
        no_active_subscription: "❌ No active notification subscription found for your account. Enable notifications first.",
        no_authorized_recipients: "❌ Your account is not an authorized recipient.",
        vapid_configuration_error: "❌ Push server configuration error.",
        push_failed: "❌ The push service rejected or could not deliver the request.",
        database_error: "❌ A database error occurred on the server.",
        invalid_request: "❌ The request was not valid."
    };

    try {
        const { data, error } = await supabaseClient.functions.invoke("absence-alert-notify", {
            body: { mode: "synthetic" }         // the only thing this UI can ever request
        });

        let result = null, body = data;
        if (error) {
            body = null;
            try {
                if (error.context && typeof error.context.json === "function") body = await error.context.json();
            } catch (_) { /* unreadable body - generic message below */ }
            result = body && typeof body.result === "string" ? body.result : null;
            if (result === "owner_required") setStatus("Absence push test failed: Owner access required.");
            else if (result === "unauthenticated") setStatus("Absence push test failed: please log in again.");
            else if (result && messages[result]) setStatus("Absence push test failed: " + messages[result].replace(/^❌ /, ""));
            else setStatus("Absence push test failed: request failed.");
        } else {
            result = body && typeof body.result === "string" ? body.result : null;
            const subs = (body && body.subscriptions) || {};
            if (result === "sent") {
                const lines = [
                    "✅ Push request accepted for " + num(subs.succeeded) + " device(s) — check your phone. (This does not prove it was displayed.)",
                    "Devices that failed: " + num(subs.failed) + " · Expired devices deactivated: " + num(subs.expiredDeactivated),
                    "Test alert only — no real alert, student or attendance data was used."
                ];
                setStatus(lines.join("\n"));
            } else if (result && messages[result]) {
                setStatus(messages[result]);
            } else {
                setStatus("Absence push test failed: unexpected response.");
            }
        }
    } catch (err) {
        console.warn("Absence push test failed:", err);
        setStatus("Absence push test failed: could not reach the server.");
    } finally {
        absencePushTestInFlight = false;
        if (button) { button.disabled = false; button.textContent = "🔔 Send Test Absence Push"; }
    }
}


/* =====================================================
   ADMIN LOGIN & SESSION (OFFLINE READY)

   Online: Supabase auth is the source of truth.
   Offline: passwords are never checked offline (there is
   nothing safe to check them against, and a password should
   not sit in the client bundle). Instead, once a device has
   logged in successfully online at least once, that fact -
   not the password - is remembered, so the same device can
   keep working offline afterwards. A brand-new device that
   has never been online cannot log in for the first time
   without connecting once.
===================================================== */

async function adminLogin() {
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const message = document.getElementById("loginMessage");

    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value.trim() : "";

    if (!email || !password) {
        if (message) message.innerText = "Please enter email and password.";
        return;
    }

    if (message) message.innerText = "Logging in...";

    if (navigator.onLine) {
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;

            localStorage.setItem("adminLoggedIn", "true");
            const uid = data && data.user ? data.user.id : null;
            cacheUserId(uid);

            const role = await fetchUserRole(uid);
            cacheUserRole(role === undefined ? null : role);

            if (message) message.innerText = "";
            document.getElementById("loginScreen").style.display = "none";
            await initApp();
            return;
        } catch (err) {
            console.warn("Supabase login failed:", err.message);
            if (message) message.innerText = "Invalid email or password.";
            return;
        }
    }

    // Offline: only allow re-entry if this device has logged in successfully before.
    if (localStorage.getItem("adminLoggedIn") === "true") {
        // Restore the cached user id and role from the last successful
        // online login on this device - see cacheUserId()/cacheUserRole()'s
        // doc comments for why this is safe to trust for UI purposes
        // while offline.
        currentUserId = localStorage.getItem("rftUserId") || null;
        currentUserRole = localStorage.getItem("rftUserRole") || null;
        if (message) message.innerText = "";
        document.getElementById("loginScreen").style.display = "none";
        await initApp();
    } else {
        if (message) message.innerText = "No internet connection. Please connect once to log in for the first time.";
    }
}

function adminLogout() {
    // Best-effort, non-blocking - see doc comment on the function itself.
    deactivateCurrentDeviceSubscriptionOnLogout(currentUserId);

    localStorage.removeItem("adminLoggedIn");
    currentUserId = null;
    localStorage.removeItem("rftUserId");
    currentUserRole = null;
    localStorage.removeItem("rftUserRole");

    if (navigator.onLine && supabaseClient.auth) {
        supabaseClient.auth.signOut();
    }

    // Finance-specific shared-device cleanup - see clearFinanceLocalData()
    // for exactly what this does and does not remove.
    clearFinanceLocalData();

    // Clear the stale "Logging in..." / error text and the password field
    // so the login screen comes back clean instead of showing leftover
    // state from the previous session.
    const message = document.getElementById("loginMessage");
    if (message) message.innerText = "";

    const passwordInput = document.getElementById("loginPassword");
    if (passwordInput) passwordInput.value = "";

    const loginScreen = document.getElementById("loginScreen");
    if (loginScreen) loginScreen.style.display = "flex";
}

/* =====================================================
   FINANCE - LOGOUT / SHARED-DEVICE CLEANUP

   Wipes the local Finance IndexedDB store (the read-cache of
   records this device has pulled down) so a Finance-populated
   device doesn't leave that data sitting around for whoever logs
   in next. Deliberately does NOT touch pending (not-yet-synced)
   Finance outbox entries: those represent real unsaved edits, and
   silently discarding them on logout would be data loss, not a
   security fix. If a device that has unsynced Finance edits queued
   is then used to log in as someone else before those edits sync,
   that is a known, disclosed limitation of the shared-device/
   generic-outbox design (see the audit) - it is closed once
   Finance's Supabase RLS policy is locked down to the owner UID,
   which is an explicitly separate, not-yet-approved step.
   Does not touch students/groups/attendance/fees/exams/results
   data or their outbox entries in any way.
===================================================== */

async function clearFinanceLocalData() {
    try {
        await RFT.clearStore("finance");
    } catch (err) {
        console.warn("Could not clear local Finance store on logout:", err);
    }
    finance = [];
}

/* =====================================================
   CHECK ADMIN SESSION

   Runs immediately on script load. Always loads app data
   after confirming the session - this fixes the old bug
   where a returning (already logged-in) teacher saw a blank
   app because nothing ever loaded their data.
===================================================== */

async function checkAdminSession() {
    const isLoggedInLocally = localStorage.getItem("adminLoggedIn") === "true";

    if (isLoggedInLocally) {
        // Restore the cached user id/role first (works fully offline),
        // then best-effort refresh them from the real Supabase session
        // when possible. getSession() reads the locally cached, signed
        // session and does not require a network round trip, so this
        // still works offline - it just falls back to the cached values
        // above if it can't run for any reason. The role refresh only
        // overwrites the cache if the lookup actually succeeded (see
        // fetchUserRole's doc comment) - a transient failure here keeps
        // whatever was already cached rather than clearing it.
        currentUserId = localStorage.getItem("rftUserId") || null;
        currentUserRole = localStorage.getItem("rftUserRole") || null;
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && session.user) {
                cacheUserId(session.user.id);
                const role = await fetchUserRole(session.user.id);
                if (role !== undefined) cacheUserRole(role);
            }
        } catch (err) {
            // Ignore - keep the cached id/role restored above.
        }

        const loginScreen = document.getElementById("loginScreen");
        if (loginScreen) loginScreen.style.display = "none";
        await initApp();
        return;
    }

    if (navigator.onLine) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                localStorage.setItem("adminLoggedIn", "true");
                const uid = session.user ? session.user.id : null;
                cacheUserId(uid);
                const role = await fetchUserRole(uid);
                cacheUserRole(role === undefined ? null : role);
                const loginScreen = document.getElementById("loginScreen");
                if (loginScreen) loginScreen.style.display = "none";
                await initApp();
            }
        } catch (err) {
            console.warn("Could not check online session:", err);
        }
    }
}

checkAdminSession();


/* =====================================================
   APP DATA (in-memory - mirrors what is in IndexedDB)
===================================================== */

let students = [];
let fees = [];
let finance = [];
let exams = [];
let results = {};        // { examId: { studentId: {id, english, nepali, math, science, total} } }
let groups = [];
let groupIds = {};       // name -> id
let attendance = {};     // { date: { studentId: status } }
let attendanceIds = {};  // { "date|studentId": id } - lets us upsert instead of duplicate-insert

let studentGroup = "A";
let attendanceGroup = "A";
let resultGroup = "A";

let events = [];
let editingEventId = null;
let eventsView = "upcoming"; // "upcoming" | "past"

/* ---------- row (Supabase/IndexedDB shape) <-> app shape ---------- */

function studentFromRow(row) {
    return {
        id: row.id,
        name: row.name,
        className: row.class,
        roll: row.roll,
        parent: row.parent,
        phone: row.phone,
        group: row.group,
        joined: row.date_joined,
        photo: row.photo || "",
        createdAt: row.created_at || null
    };
}
function studentToRow(s) {
    const row = {
        id: s.id,
        name: s.name,
        class: s.className,
        roll: s.roll,
        parent: s.parent,
        phone: s.phone,
        group: s.group,
        date_joined: s.joined,
        photo: s.photo || "",
        updated_at: new Date().toISOString()
    };
    if (s.createdAt) row.created_at = s.createdAt;
    return row;
}

function feeFromRow(row) {
    return { id: row.id, studentId: row.student_id, month: row.month, amount: Number(row.amount), paidDate: row.date };
}
function feeToRow(f) {
    return { id: f.id, student_id: f.studentId, month: f.month, amount: Number(f.amount), date: f.paidDate, updated_at: new Date().toISOString() };
}

/* ---------- EVENTS & NOTICES ----------
   Owner-only to add/edit/delete (see denyIfNotOwner calls in the Events
   functions further down); Teachers can view them - so unlike "finance",
   this table stays in the GENERIC RFT.TABLES list and goes through the
   normal offline-first load/outbox/sync path everyone else uses. */
function eventFromRow(row) {
    return {
        id: row.id,
        title: row.title,
        type: row.type || "Event",
        date: row.date,
        time: row.time || "",
        location: row.location || "",
        description: row.description || "",
        targetGroup: row.target_group || "",
        priority: row.priority || "Normal",
        createdBy: row.created_by || "",
        createdAt: row.created_at || null
    };
}
function eventToRow(e) {
    const row = {
        id: e.id,
        title: e.title,
        type: e.type || "Event",
        date: e.date,
        time: e.time || null,
        location: e.location || null,
        description: e.description || null,
        target_group: e.targetGroup || null,
        priority: e.priority || "Normal",
        created_by: e.createdBy || null,
        updated_at: new Date().toISOString()
    };
    if (e.createdAt) row.created_at = e.createdAt;
    return row;
}

/* ---------- FINANCIAL MANAGEMENT (NGO income / expense ledger) ----------
   A separate table/store from "fees" on purpose - the old per-student fee
   payments and the NGO's income/expense records mean different things and
   are never converted into one another. */
function financeFromRow(row) {
    return {
        id: row.id,
        type: row.type,                       // "income" | "expense"
        amount: Number(row.amount),
        date: row.date,                       // transaction date (YYYY-MM-DD)
        category: row.category,
        description: row.description || "",
        party: row.party || "",               // Received from / Paid to
        method: row.method || "",             // cash / bank transfer / digital payment / ...
        reference: row.reference || "",       // reference no. / transaction ID
        notes: row.notes || "",
        createdAt: row.created_at || null
    };
}
function financeToRow(f) {
    const row = {
        id: f.id,
        type: f.type,
        amount: Number(f.amount),
        date: f.date,
        category: f.category,
        description: f.description || "",
        party: f.party || "",
        method: f.method || "",
        reference: f.reference || "",
        notes: f.notes || "",
        updated_at: new Date().toISOString()
    };
    if (f.createdAt) row.created_at = f.createdAt;
    return row;
}

function examFromRow(row) {
    return { id: row.id, name: row.exam_name, date: row.date, createdAt: row.created_at || null };
}
function examToRow(e) {
    const row = { id: e.id, exam_name: e.name, date: e.date, updated_at: new Date().toISOString() };
    if (e.createdAt) row.created_at = e.createdAt;
    return row;
}

/* ---------- building the display caches from raw arrays ---------- */

function rebuildAttendanceCache(rows) {
    attendance = {};
    attendanceIds = {};
    rows.forEach(row => {
        if (!attendance[row.date]) attendance[row.date] = {};
        attendance[row.date][row.student_id] = row.status;
        attendanceIds[row.date + "|" + row.student_id] = row.id;
    });
}

function rebuildResultsCache(rows) {
    results = {};
    rows.forEach(row => {
        if (!results[row.exam_id]) results[row.exam_id] = {};
        results[row.exam_id][row.student_id] = {
            id: row.id,
            english: Number(row.english || 0),
            nepali: Number(row.nepali || 0),
            math: Number(row.maths || 0),
            science: Number(row.science || 0),
            total: Number(row.total || 0),
            createdAt: row.created_at || null
        };
    });
}

function rebuildGroupsCache(rows) {
    let sorted = rows.slice().sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    groupIds = {};
    let names = sorted.map(row => String(row.name).trim()).filter(Boolean);
    sorted.forEach(row => { groupIds[String(row.name).trim()] = row.id; });

    if (names.length === 0) {
        names = ["A"];
    }

    groups = sortGroupsPreferred(names);

    studentGroup = groups.includes(studentGroup) ? studentGroup : groups[0];
    attendanceGroup = groups.includes(attendanceGroup) ? attendanceGroup : groups[0];
    resultGroup = groups.includes(resultGroup) ? resultGroup : groups[0];
}

/* =====================================================
   GROUP DISPLAY ORDER (used everywhere groups are listed -
   Students tabs, Attendance/Results group buttons, and the
   dashboard cards)

   Groups A, B and C are the app's original defaults, so they
   always appear first (in that order) if they exist. Any other
   group - however many get added - appears afterward, in the
   order it was created.
===================================================== */

function sortGroupsPreferred(names) {
    let preferred = ["A", "B", "C"].filter(name => names.includes(name));
    let rest = names.filter(name => !preferred.includes(name));
    return preferred.concat(rest);
}

/* =====================================================
   RECONCILE ORPHAN GROUPS

   students.group is a plain text field, not a foreign key, so
   it's possible for a student to carry a group name (e.g. from
   an older/imported record, or one created on another device in
   a race with the groups table) that has no matching row in the
   groups table. When that happens, that name never showed up as
   a tab/button anywhere driven by the groups list - the student
   was still there, but their group was effectively invisible.

   This self-heals it: any group name actually in use by a
   student that isn't already a real group gets a proper row
   created for it (locally + queued to Supabase), so it becomes a
   normal, fully-functional group from then on.
===================================================== */

async function reconcileOrphanGroups() {
    let changed = false;

    let usedNames = new Set(
        students.map(s => s.group).filter(Boolean)
    );

    for (const name of usedNames) {
        if (!groupIds[name]) {
            const id = RFT.newId();
            const row = { id, name, created_at: new Date().toISOString() };

            await RFT.put("groups", row);
            await RFT.enqueue("groups", "upsert", row);

            groups.push(name);
            groupIds[name] = id;

            changed = true;
        }
    }

    if (changed) {
        groups = sortGroupsPreferred(groups);
    }

    return changed;
}

/* =====================================================
   LOAD ALL DATA FROM LOCAL INDEXEDDB
   Always works, online or offline, and is fast because it
   never waits on the network.
===================================================== */

async function loadAllFromLocal() {
    const [studentRows, feeRows, examRows, groupRows, attendanceRows, resultRows, financeRows, eventRows] = await Promise.all([
        RFT.getAll("students"),
        RFT.getAll("fees"),
        RFT.getAll("exams"),
        RFT.getAll("groups"),
        RFT.getAll("attendance"),
        RFT.getAll("results"),
        RFT.getAll("finance"),
        RFT.getAll("events")
    ]);

    students = studentRows.map(studentFromRow)
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    fees = feeRows.map(feeFromRow)
        .sort((a, b) => String(a.paidDate || "").localeCompare(String(b.paidDate || "")));

    exams = examRows.map(examFromRow)
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    finance = financeRows.map(financeFromRow)
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    events = eventRows.map(eventFromRow);

    rebuildGroupsCache(groupRows);
    rebuildAttendanceCache(attendanceRows);
    rebuildResultsCache(resultRows);
}

/* =====================================================
   PULL FRESH DATA FROM SUPABASE INTO INDEXEDDB
   (download direction of sync - this is how one teacher's
   device sees another teacher's changes)
===================================================== */

/* =====================================================
   PULL FRESH DATA FROM SUPABASE INTO INDEXEDDB
   (download direction of sync - this is how one teacher's
   device sees another teacher's changes)

   Careful about two things a naive "clear + refill" would get
   wrong:
   - A record with a pending (not-yet-synced) outbox change must
     NOT be overwritten by a stale server copy - the local
     pending version stays until it actually syncs up.
   - A row that no longer exists on the server (someone else
     deleted it) and has no pending local change should be
     removed locally too, so deletions propagate correctly.

   Returns true only if every table pulled successfully, so a
   partial failure can be told apart from a full sync.
===================================================== */

async function pullAllFromSupabase() {
    let allOk = true;

    const pendingOutbox = await RFT.getPendingOutbox();
    const pendingIdsByTable = {};
    pendingOutbox.forEach(item => {
        if (!item.record || !item.record.id) return;
        if (!pendingIdsByTable[item.table]) pendingIdsByTable[item.table] = new Set();
        pendingIdsByTable[item.table].add(item.record.id);
    });

    for (const table of RFT.TABLES) {
        let data, error;

        try {
            const res = await RFT.withAbortableTimeout(
                supabaseClient.from(table).select("*"),
                20000,
                `Pull ${table}`
            );
            data = res.data;
            error = res.error;
        } catch (err) {
            error = err;
        }

        if (error) {
            console.error(`Could not pull ${table} from Supabase:`, error);
            allOk = false;
            continue; // keep whatever is already cached locally for this table
        }

        const pendingIds = pendingIdsByTable[table] || new Set();
        const serverRows = data || [];
        const serverIds = new Set(serverRows.map(r => r.id));

        // Rows still waiting to sync up keep their local version - don't
        // let a stale server copy clobber an edit that hasn't left yet.
        const rowsToStore = serverRows.filter(r => !pendingIds.has(r.id));

        // A row that's gone from the server, and that we have no pending
        // local change for, was deleted by someone else - remove it here too.
        const localRows = await RFT.getAll(table);
        for (const row of localRows) {
            if (!pendingIds.has(row.id) && !serverIds.has(row.id)) {
                await RFT.remove(table, row.id);
            }
        }

        await RFT.putMany(table, rowsToStore);
    }

    if (allOk) {
        await RFT.setMeta("lastSyncedAt", Date.now());
    }

    return allOk;
}

/* =====================================================
   FINANCE - ISOLATED PULL (owner-only)

   Deliberately separate from pullAllFromSupabase() above, and NOT
   driven by RFT.TABLES (see offline-core.js) - Finance must never be
   downloaded onto a non-owner device. Mirrors the same safe-merge
   logic (respect pending outbox, remove server-deleted rows) as
   pullAllFromSupabase(), scoped to just the "finance" table, and
   only ever does anything when isOwner() is true. For a non-owner
   session this is a harmless no-op - it does not even make a
   network request.
===================================================== */

async function pullFinanceFromSupabase() {
    if (!isOwner()) return true; // nothing to do for a non-owner - not an error

    const table = "finance";
    let data, error;

    try {
        const res = await RFT.withAbortableTimeout(
            supabaseClient.from(table).select("*"),
            20000,
            "Pull finance"
        );
        data = res.data;
        error = res.error;
    } catch (err) {
        error = err;
    }

    if (error) {
        console.error("Could not pull finance from Supabase:", error);
        return false;
    }

    const pendingOutbox = await RFT.getPendingOutbox();
    const pendingIds = new Set(
        pendingOutbox
            .filter(i => i.table === table && i.record && i.record.id)
            .map(i => i.record.id)
    );

    const serverRows = data || [];
    const serverIds = new Set(serverRows.map(r => r.id));

    const rowsToStore = serverRows.filter(r => !pendingIds.has(r.id));

    const localRows = await RFT.getAll(table);
    for (const row of localRows) {
        if (!pendingIds.has(row.id) && !serverIds.has(row.id)) {
            await RFT.remove(table, row.id);
        }
    }

    await RFT.putMany(table, rowsToStore);
    return true;
}

/* =====================================================
   OUTBOX HYGIENE
   Cancels queued upserts for child records that no longer
   have anywhere to go (their parent student/exam was deleted
   locally before the child record ever finished syncing).
===================================================== */

async function purgeOutboxFor(table, predicate) {
    const pending = await RFT.getPendingOutbox();
    for (const item of pending) {
        if (item.table !== table || item.action !== "upsert") continue;
        if (predicate(item.record || {})) {
            await RFT.removeFromOutbox(item.localId);
        }
    }
}

/* =====================================================
   APP INITIALIZATION (single entry point)

   1. Always load from IndexedDB first, so the UI shows data
      immediately - online or offline.
   2. If online, sync in the background: push pending outbox
      changes, then pull fresh shared data, then refresh the
      screen. Never blocks the initial render on the network.
===================================================== */

let appEventsBound = false;

async function initApp() {
    await RFT.openDB();
    await loadAllFromLocal();
    await reconcileOrphanGroups();
    applyOwnerVisibility();
    renderAll();

    // Reflects current permission/subscription state only - never
    // itself prompts for notification permission.
    refreshNotificationUI();

    if (!appEventsBound) {
        appEventsBound = true;
        window.addEventListener("online", () => { updateConnectionBadge(); syncNow(); });
        window.addEventListener("offline", updateConnectionBadge);
    }
    updateConnectionBadge();
    updateSyncBadge();

    if (navigator.onLine) {
        syncNow();
    }
}

let lastSyncFailed = false;

async function syncNow() {
    if (!navigator.onLine) {
        updateSyncBadge();
        return;
    }

    updateSyncBadge("🔄 Syncing...");

    let ok = true;

    try {
        const pushResult = await RFT.processOutbox(supabaseClient);

        if (pushResult && pushResult.reason === "already-syncing") {
            // Another sync is already in flight - let it finish and
            // reflect its outcome instead of racing it.
            updateSyncBadge();
            return;
        }

        if (pushResult && pushResult.failed > 0) ok = false;

        // Best-effort role refresh - picks up a role change (e.g. an
        // owner promoting/demoting someone) without requiring the
        // affected device to log out and back in. Only overwrites the
        // cache if the lookup actually succeeded (see fetchUserRole's
        // doc comment), so a transient failure here can't look like a
        // demotion.
        if (currentUserId) {
            const role = await fetchUserRole(currentUserId);
            if (role !== undefined) cacheUserRole(role);
        }

        const pullOk = await pullAllFromSupabase();
        if (!pullOk) ok = false;

        // Finance is intentionally isolated from the generic pull above -
        // see pullFinanceFromSupabase()'s doc comment. This is a no-op
        // for a non-owner session.
        const financeOk = await pullFinanceFromSupabase();
        if (!financeOk) ok = false;

        await loadAllFromLocal();
        await reconcileOrphanGroups();
        applyOwnerVisibility();
        renderAll();
    } catch (err) {
        console.error("Sync failed:", err);
        ok = false;
    }

    lastSyncFailed = !ok;
    updateSyncBadge();
}

async function updateSyncBadge(overrideText) {
    const el = document.getElementById("syncBadge");
    if (!el) return;

    if (overrideText) {
        el.textContent = overrideText;
        return;
    }

    const pending = await RFT.outboxCount();

    if (!navigator.onLine) {
        el.textContent = pending > 0 ? ("📴 Offline — " + pending + " pending") : "📴 Offline";
        return;
    }

    if (lastSyncFailed) {
        el.textContent = "⚠️ Sync failed — will retry" + (pending > 0 ? (" (" + pending + " pending)") : "");
        return;
    }

    el.textContent = pending > 0 ? ("⏳ " + pending + " change(s) waiting to sync") : "✅ All changes synced";
}

function updateConnectionBadge() {
    const el = document.getElementById("connectionBadge");
    if (!el) return;
    el.textContent = navigator.onLine ? "🟢 Online" : "🔴 Offline";
    el.className = navigator.onLine ? "connection-badge online" : "connection-badge offline";
}

/* =====================================================
   NAVIGATION
===================================================== */

function saveAll() {
    // Every mutation writes to IndexedDB and the outbox immediately (see
    // each add/edit/delete function). This just opportunistically pushes
    // those changes to Supabase right away when online, instead of
    // waiting for the next scheduled sync.
    if (navigator.onLine) {
        syncNow();
    } else {
        updateSyncBadge();
    }
}


/* =====================================================
   NAVIGATION
===================================================== */

function showSection(id,button){

    document.querySelectorAll(".section")
    .forEach(section=>{
        section.classList.remove("active");
    });

    document.getElementById(id)
    .classList.add("active");


    document.querySelectorAll("nav button")
    .forEach(btn=>{
        btn.classList.remove("active");
    });

    button.classList.add("active");


    renderAll();

    // STAGE 7D: fetch/refresh absence alerts only when the Attendance
    // section is actually opened, not on every section switch.
    if (id === "attendance") loadAbsenceAlerts();

}


/* =====================================================
   DATE
===================================================== */

function today(){

    // Uses the device's own local date (not UTC), so attendance/fees
    // logged near midnight land on the correct calendar day for
    // whatever timezone the teacher's phone/computer is actually set to.
    let d = new Date();

    let year = d.getFullYear();
    let month = String(d.getMonth() + 1).padStart(2, "0");
    let day = String(d.getDate()).padStart(2, "0");

    return year + "-" + month + "-" + day;

}


/* =====================================================
   GROUP MANAGEMENT
===================================================== */


/* =========================
   RENDER GROUP SELECTS
========================= */

function renderGroupSelects(){

    let addSelect =
        document.getElementById("studentGroup");

    let editSelect =
        document.getElementById("editStudentGroup");


    if(addSelect){

        let oldValue = addSelect.value;

        addSelect.innerHTML = "";

        groups.forEach(group=>{

            addSelect.innerHTML += `

<option value="${escapeHTML(group)}">
${escapeHTML(group)}
</option>

`;

        });


        if(groups.includes(oldValue))
            addSelect.value = oldValue;
        else
            addSelect.value = groups[0] || "";

    }


    /* EDIT SELECT */

    if(editSelect){

        let oldValue = editSelect.value;

        editSelect.innerHTML = "";

        groups.forEach(group=>{

            editSelect.innerHTML += `

<option value="${escapeHTML(group)}">
${escapeHTML(group)}
</option>

`;

        });

        if(groups.includes(oldValue))
            editSelect.value = oldValue;

    }

}


/* =========================
   RENDER GROUP BUTTONS
========================= */

function renderGroupButtons(){

    /* STUDENTS */

    let studentButtons =
        document.getElementById(
            "studentGroupButtons"
        );

    studentButtons.innerHTML = "";

    groups.forEach(group=>{

        let button =
            document.createElement("button");

        button.innerText = group;

        if(group === studentGroup)
            button.classList.add("active");

        button.onclick = function(){

            selectStudentGroup(group);

        };

        studentButtons.appendChild(button);

    });


    /* ATTENDANCE */

    let attendanceButtons =
        document.getElementById(
            "attendanceGroupButtons"
        );

    attendanceButtons.innerHTML = "";

    groups.forEach(group=>{

        let button =
            document.createElement("button");

        button.innerText = group;

        if(group === attendanceGroup)
            button.classList.add("active");

        button.onclick = function(){

            selectAttendanceGroup(group);

        };

        attendanceButtons.appendChild(button);

    });


    /* RESULTS */

    let resultButtons =
        document.getElementById(
            "resultGroupButtons"
        );

    resultButtons.innerHTML = "";

    groups.forEach(group=>{

        let button =
            document.createElement("button");

        button.innerText = group;

        if(group === resultGroup)
            button.classList.add("active");

        button.onclick = function(){

            selectResultGroup(group);

        };

        resultButtons.appendChild(button);

    });

}


/* =========================
   GROUP MANAGEMENT LIST
========================= */
function renderManageGroups(){

    let container =
        document.getElementById(
            "manageGroupsList"
        );

    if(!container)
        return;

    container.innerHTML = "";

    groups.forEach(group => {

        let box =
            document.createElement("div");

        box.className = "modern-group-row";

        let count =
            students.filter(
                s => s.group === group
            ).length;

        let groupId =
            groupIds[group];

        box.innerHTML = `

            <div class="modern-group-info">

                <div class="modern-group-icon">
                    👥
                </div>

                <div>

                    <strong>
                        ${escapeHTML(group)}
                    </strong>

                    <span>
                        ${count} student${count === 1 ? "" : "s"}
                    </span>

                </div>

            </div>


            <div class="modern-group-menu">

                <button
                    class="group-menu-button"
                    onclick="toggleGroupMenu(this)">
                    ⋮
                </button>

                <div class="group-menu-dropdown">

                    <button
                        onclick="editGroup('${groupId}')">
                        ✏️
                        <span>Edit Group</span>
                    </button>

                    <button
                        class="delete-option"
                        onclick="deleteGroup('${groupId}')">
                        🗑️
                        <span>Delete Group</span>
                    </button>

                </div>

            </div>

        `;

        container.appendChild(box);

    });

}
/* =====================================================
   FLOATING MENU POSITIONING (viewport-aware)

   The student/fee/group/exam "..." menus were plain
   position:absolute dropdowns anchored to their button. Near
   the bottom of a long list that meant the menu could open
   off-screen, get clipped by a scrolling/overflow container,
   or end up behind other elements - the button looked broken.
   This computes a fixed, viewport-relative position from the
   button's actual on-screen location every time a menu opens,
   and flips it upward if there isn't room below. position:fixed
   is used (rather than moving the element in the DOM) so it is
   never clipped by an ancestor's overflow, since nothing in this
   app's layout puts a transform/filter on any ancestor of these
   menus - if that ever changes, this positioning would need the
   menu re-parented to <body> instead.
===================================================== */

function positionFloatingMenu(button, menu){

    let rect = button.getBoundingClientRect();

    // Measure it invisibly first (needs to be display:block to have a size).
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    let menuWidth = menu.offsetWidth || 180;
    let menuHeight = menu.offsetHeight || 120;

    menu.style.display = "";
    menu.style.visibility = "";

    let margin = 8;

    let spaceBelow = window.innerHeight - rect.bottom;
    let spaceAbove = rect.top;

    let top;
    if(spaceBelow >= menuHeight + margin || spaceBelow >= spaceAbove){
        top = rect.bottom + 6;          // enough room below (or more room than above) - open downward
    } else {
        top = rect.top - menuHeight - 6; // not enough room below - open upward instead
    }

    // Always keep it fully inside the viewport, even in a very short window.
    top = Math.max(margin, Math.min(top, window.innerHeight - menuHeight - margin));

    let left = rect.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

    menu.style.position = "fixed";
    menu.style.top = top + "px";
    menu.style.left = left + "px";
    menu.style.right = "auto";
}


function toggleGroupMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".group-menu-dropdown"
        );

    let willOpen = !menu.classList.contains("show");

    document
        .querySelectorAll(
            ".group-menu-dropdown"
        )
        .forEach(otherMenu => {

            if(otherMenu !== menu){
                otherMenu.classList.remove(
                    "show"
                );
            }

        });

    if(willOpen) positionFloatingMenu(button, menu);
    menu.classList.toggle("show");

}
document.addEventListener("click", function(event){

    if(
        !event.target.closest(
            ".modern-group-menu"
        )
    ){

        document
            .querySelectorAll(
                ".group-menu-dropdown"
            )
            .forEach(menu => {

                menu.classList.remove(
                    "show"
                );

            });

    }

});

/* =========================
   ADD GROUP
========================= */
/* =====================================================
   GROUPS (OFFLINE READY)
===================================================== */

async function addGroup() {
    let input = document.getElementById("newGroupName");
    let name = input.value.trim();

    if (!name) {
        alert("Please enter a group name.");
        return;
    }

    let exists = groups.some(
        g => g.toLowerCase() === name.toLowerCase()
    );

    if (exists) {
        alert("This group already exists.");
        return;
    }

    const id = RFT.newId();
    const row = { id, name, created_at: new Date().toISOString() };

    // 1. Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("groups", row);
    await RFT.enqueue("groups", "upsert", row);

    groups.push(name);
    groups = sortGroupsPreferred(groups);
    groupIds[name] = id;

    studentGroup = name;
    attendanceGroup = name;
    resultGroup = name;

    input.value = "";

    saveAll();
    renderAll();

    alert("Group '" + name + "' added successfully.");
}

/* =========================
   EDIT GROUP (OFFLINE READY)
========================= */
async function editGroup(groupId) {
    let oldName = Object.keys(groupIds).find(
        name => String(groupIds[name]) === String(groupId)
    );

    if (!oldName) {
        alert("Group not found.");
        return;
    }

    let newName = prompt("Enter new name for group:", oldName);
    if (newName === null) return;
    newName = newName.trim();

    if (!newName) {
        alert("Group name cannot be empty.");
        return;
    }

    let duplicate = groups.some(
        g => g !== oldName && g.toLowerCase() === newName.toLowerCase()
    );

    if (duplicate) {
        alert("A group with this name already exists.");
        return;
    }

    const groupRow = { id: groupId, name: newName, updated_at: new Date().toISOString() };
    await RFT.put("groups", groupRow);
    await RFT.enqueue("groups", "upsert", groupRow);

    // students.group is a plain text column, not a foreign key, so every
    // affected student's own row needs its own update.
    for (const student of students) {
        if (student.group === oldName) {
            student.group = newName;
            const row = studentToRow(student);
            await RFT.put("students", row);
            await RFT.enqueue("students", "upsert", row);
        }
    }

    let index = groups.indexOf(oldName);
    if (index !== -1) {
        groups[index] = newName;
    }
    groups = sortGroupsPreferred(groups);

    delete groupIds[oldName];
    groupIds[newName] = groupId;

    if (studentGroup === oldName) studentGroup = newName;
    if (attendanceGroup === oldName) attendanceGroup = newName;
    if (resultGroup === oldName) resultGroup = newName;

    saveAll();
    renderAll();

    alert("✅ Group renamed successfully.");
}

/* =========================
   DELETE GROUP (OFFLINE READY)
========================= */
async function deleteGroup(groupId) {
    let group = Object.keys(groupIds).find(
        name => String(groupIds[name]) === String(groupId)
    );

    if (!group) {
        alert("Group not found.");
        return;
    }

    if (groups.length <= 1) {
        alert("You must keep at least one group.");
        return;
    }

    let studentCount = students.filter(s => s.group === group).length;
    let message = "Delete group '" + group + "'?";

    if (studentCount > 0) {
        message += "\n\nThis group has " + studentCount + " student(s).\nDeleting the group will move those students to another group.";
    }

    if (!confirm(message)) return;

    let replacement = groups.find(g => g !== group);

    if (studentCount > 0) {
        for (const student of students) {
            if (student.group === group) {
                student.group = replacement;
                const row = studentToRow(student);
                await RFT.put("students", row);
                await RFT.enqueue("students", "upsert", row);
            }
        }
    }

    await RFT.remove("groups", groupId);
    await RFT.enqueue("groups", "delete", { id: groupId });

    groups = groups.filter(g => g !== group);
    delete groupIds[group];

    if (studentGroup === group) studentGroup = replacement;
    if (attendanceGroup === group) attendanceGroup = replacement;
    if (resultGroup === group) resultGroup = replacement;

    saveAll();
    renderAll();

    alert("✅ Group deleted successfully.\nStudents were moved to " + replacement + ".");
}

/* =====================================================
   PHOTO COMPRESSION
===================================================== */

function previewStudentPhoto(event){

    let file =
        event.target.files[0];


    if(!file){

        selectedStudentPhoto = "";

        return;

    }


    if(!file.type.startsWith("image/")){

        alert("Please select an image.");

        event.target.value = "";

        return;

    }


    let reader =
        new FileReader();


    reader.onload = function(e){

        let img =
            new Image();


        img.onload = function(){

            let canvas =
                document.createElement("canvas");

            let maxSize = 500;

            let width = img.width;
            let height = img.height;


            if(width > height){

                if(width > maxSize){

                    height =
                        height * maxSize / width;

                    width = maxSize;

                }

            }
            else{

                if(height > maxSize){

                    width =
                        width * maxSize / height;

                    height = maxSize;

                }

            }


            canvas.width = width;
            canvas.height = height;


            let ctx =
                canvas.getContext("2d");


            ctx.drawImage(
                img,
                0,
                0,
                width,
                height
            );


            selectedStudentPhoto =
                canvas.toDataURL(
                    "image/jpeg",
                    0.75
                );


            let preview =
                document.getElementById(
                    "photoPreview"
                );


            preview.src =
                selectedStudentPhoto;

            preview.style.display =
                "block";

        };


        img.src = e.target.result;

    };


    reader.readAsDataURL(file);

}


/* =====================================================
   EDIT PHOTO
===================================================== */

function previewEditStudentPhoto(event){

    let file =
        event.target.files[0];


    if(!file)
        return;


    if(!file.type.startsWith("image/")){

        alert("Please select an image.");

        event.target.value = "";

        return;

    }


    let reader =
        new FileReader();


    reader.onload = function(e){

        let img =
            new Image();


        img.onload = function(){

            let canvas =
                document.createElement("canvas");

            let maxSize = 500;

            let width = img.width;
            let height = img.height;


            if(width > height){

                if(width > maxSize){

                    height =
                        height * maxSize / width;

                    width = maxSize;

                }

            }
            else{

                if(height > maxSize){

                    width =
                        width * maxSize / height;

                    height = maxSize;

                }

            }


            canvas.width = width;
            canvas.height = height;


            let ctx =
                canvas.getContext("2d");


            ctx.drawImage(
                img,
                0,
                0,
                width,
                height
            );


            selectedEditPhoto =
                canvas.toDataURL(
                    "image/jpeg",
                    0.75
                );


            let preview =
                document.getElementById(
                    "editPhotoPreview"
                );


            preview.src =
                selectedEditPhoto;

            preview.style.display =
                "block";

        };


        img.src = e.target.result;

    };


    reader.readAsDataURL(file);

}


/* =====================================================
   ADD STUDENT
===================================================== */
async function addStudent() {
    let name = document.getElementById("studentName").value.trim();
    let className = document.getElementById("studentClass").value.trim();
    let roll = document.getElementById("studentRoll").value.trim();
    let parent = document.getElementById("parentName").value.trim();
    let phone = document.getElementById("parentPhone").value.trim();
    let group = document.getElementById("studentGroup").value;

    if (!name || !className || !roll) {
        alert("Please enter name, class and roll.");
        return;
    }

    if (!group) {
        alert("Please select a group.");
        return;
    }

    const newStudent = {
        id: RFT.newId(),
        name, className, roll, parent, phone, group,
        joined: today(),
        photo: selectedStudentPhoto || "",
        createdAt: new Date().toISOString()
    };

    const row = studentToRow(newStudent);

    // 1. Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("students", row);
    students.push(newStudent);

    // 2. Queue for Supabase and try to sync now if online.
    await RFT.enqueue("students", "upsert", row);
    saveAll();

    // 3. Reset form
    document.getElementById("studentName").value = "";
    document.getElementById("studentClass").value = "";
    document.getElementById("studentRoll").value = "";
    document.getElementById("parentName").value = "";
    document.getElementById("parentPhone").value = "";
    document.getElementById("studentPhoto").value = "";

    document.getElementById("photoPreview").style.display = "none";
    document.getElementById("photoPreview").src = "";
    selectedStudentPhoto = "";

    renderAll();
    alert("Student added successfully.");
}


/* =====================================================
   STUDENT GROUP
===================================================== */

function selectStudentGroup(group){

    studentGroup = group;

    renderGroupButtons();

    renderStudents();

}


/* =====================================================
   EDIT STUDENT
===================================================== */

function editStudent(id){

    let student =
        students.find(
            s => s.id === id
        );


    if(!student){

        alert("Student not found.");

        return;

    }


    document.getElementById(
        "editStudentBox"
    ).style.display = "block";


    document.getElementById(
        "editStudentId"
    ).value = student.id;


    document.getElementById(
        "editStudentName"
    ).value = student.name;


    document.getElementById(
        "editStudentClass"
    ).value = student.className;


    document.getElementById(
        "editStudentRoll"
    ).value = student.roll;


    document.getElementById(
        "editParentName"
    ).value = student.parent || "";


    document.getElementById(
        "editParentPhone"
    ).value = student.phone || "";


    /* Refresh group select */

    renderGroupSelects();


    document.getElementById(
        "editStudentGroup"
    ).value = student.group;


    selectedEditPhoto = "";


    let preview =
        document.getElementById(
            "editPhotoPreview"
        );


    if(student.photo){

        preview.src = student.photo;
        preview.style.display = "block";

    }
    else{

        preview.src = "";
        preview.style.display = "none";

    }


    document.getElementById(
        "editStudentPhoto"
    ).value = "";


    /*
       Scroll to edit box
    */

    document.getElementById(
        "editStudentBox"
    ).scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

}


/* =====================================================
   SAVE STUDENT EDIT
===================================================== */
async function saveStudentEdit() {
    let id = document.getElementById("editStudentId").value;

    let student = students.find(s => s.id === id);

    if (!student) {
        alert("Student not found.");
        return;
    }

    let name = document.getElementById("editStudentName").value.trim();
    let className = document.getElementById("editStudentClass").value.trim();
    let roll = document.getElementById("editStudentRoll").value.trim();
    let parent = document.getElementById("editParentName").value.trim();
    let phone = document.getElementById("editParentPhone").value.trim();
    let group = document.getElementById("editStudentGroup").value;

    if (!name || !className || !roll) {
        alert("Name, class and roll are required.");
        return;
    }

    let photo = student.photo || "";
    if (selectedEditPhoto) {
        photo = selectedEditPhoto;
    }

    student.name = name;
    student.className = className;
    student.roll = roll;
    student.parent = parent;
    student.phone = phone;
    student.group = group;
    student.photo = photo;

    const row = studentToRow(student);

    // 1. Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("students", row);
    await RFT.enqueue("students", "upsert", row);
    saveAll();

    selectedEditPhoto = "";
    document.getElementById("editStudentBox").style.display = "none";
    renderAll();

    alert("Student information updated successfully.");
}



/* =====================================================
   CANCEL EDIT
===================================================== */

function cancelStudentEdit(){

    document.getElementById(
        "editStudentBox"
    ).style.display = "none";


    selectedEditPhoto = "";

}


/* =====================================================
   PHOTO HTML
===================================================== */

function studentPhotoHTML(
    student,
    className = "student-photo"
){

    if(student.photo){

        return `
<img
src="${escapeHTML(student.photo)}"
class="${className}"
alt="${escapeHTML(student.name)}">
`;

    }


    return `
<span
class="${className}"
style="
display:inline-flex;
align-items:center;
justify-content:center;
background:#e5e7eb;
font-size:18px;">
👤
</span>
`;

}


/* =====================================================
   STUDENTS
===================================================== */
function renderStudents(){

    let table =
        document.getElementById(
            "studentTable"
        );

    if(!table)
        return;

    let search =
        document.getElementById(
            "studentSearch"
        ).value.toLowerCase();

    table.innerHTML = "";

    let list =
        students.filter(s =>

            s.group === studentGroup &&

            (
                String(s.name || "")
                    .toLowerCase()
                    .includes(search) ||

                String(s.roll || "")
                    .toLowerCase()
                    .includes(search) ||

                String(s.className || "")
                    .toLowerCase()
                    .includes(search) ||

                String(s.parent || "")
                    .toLowerCase()
                    .includes(search) ||

                String(s.phone || "")
                    .toLowerCase()
                    .includes(search)
            )

        );

    if(list.length === 0){

        table.innerHTML = `
<div class="empty">No students found.</div>
`;

        return;

    }

    list.forEach(s=>{

        table.innerHTML += `

<div class="student-list-card">

<div class="student-list-card-top">

${studentPhotoHTML(s)}

<strong class="student-list-name">${escapeHTML(s.name)}</strong>

<div class="student-menu">

<button
class="student-menu-button"
onclick="toggleStudentMenu(this)">
⋮
</button>

<div class="student-menu-dropdown">

<button
onclick="editStudent('${s.id}')">
✏️
<span>Edit Student</span>
</button>

${isOwner() ? `
<button
class="delete-option"
onclick="deleteStudent('${s.id}')">
🗑️
<span>Delete Student</span>
</button>
` : ""}

</div>

</div>

</div>

<div class="recent-student-meta">
<span>Class ${escapeHTML(s.className)}</span>
<span>Roll ${escapeHTML(s.roll)}</span>
<span>Group ${escapeHTML(s.group)}</span>
</div>

<div class="recent-student-contact">
👨‍👩‍👦 ${escapeHTML(s.parent || "N/A")} | 📞 ${phoneLinkHTML(s.phone, "N/A")}
</div>

</div>

`;

    });

}

/* =====================================================
   DELETE STUDENT
===================================================== */
async function deleteStudent(id){

    if(denyIfNotOwner(true, "Only the owner can delete students.")) return;

    if(!confirm(
        "⚠️ Delete this student and all their records?\n\n" +
        "This will delete the student along with their attendance, fees and results."
    ))
        return;

    // 1. Remove locally (IndexedDB + memory) immediately - this works offline.
    await RFT.remove("students", id);

    const attendanceRows = (await RFT.getAll("attendance")).filter(r => r.student_id === id);
    for (const row of attendanceRows) await RFT.remove("attendance", row.id);

    const feeRows = (await RFT.getAll("fees")).filter(r => r.student_id === id);
    for (const row of feeRows) await RFT.remove("fees", row.id);

    const resultRows = (await RFT.getAll("results")).filter(r => r.student_id === id);
    for (const row of resultRows) await RFT.remove("results", row.id);

    // Cancel any not-yet-synced child records so they don't try to sync
    // after their parent student has already been deleted server-side.
    await purgeOutboxFor("attendance", r => r.student_id === id);
    await purgeOutboxFor("fees", r => r.student_id === id);
    await purgeOutboxFor("results", r => r.student_id === id);

    students = students.filter(s => s.id !== id);

    Object.keys(attendance).forEach(date => {
        if(attendance[date]) delete attendance[date][id];
    });

    fees = fees.filter(f => f.studentId !== id);

    Object.keys(results).forEach(examId => {
        if(results[examId]) delete results[examId][id];
    });

    if(selectedHistoryStudentId === id) selectedHistoryStudentId = null;

    // 2. Queue the student deletion for Supabase. Attendance/fees/results
    //    rows that already made it to the server are removed automatically
    //    via ON DELETE CASCADE.
    await RFT.enqueue("students", "delete", { id });
    saveAll();

    renderAll();

    alert("✅ Student deleted. This finishes syncing to the cloud once you're online.");

}


/* =====================================================
   ATTENDANCE GROUP
===================================================== */

function selectAttendanceGroup(group){

    attendanceGroup = group;

    renderGroupButtons();

    renderAttendance();

    renderMonthlyAttendance();

}


/* =====================================================
   ATTENDANCE
===================================================== */

function renderAttendance(){

    let date =
        document.getElementById(
            "attendanceDate"
        ).value;


    if(!date){

        date = today();

        document.getElementById(
            "attendanceDate"
        ).value = date;

    }


    if(!attendance[date])
        attendance[date] = {};


    let table =
        document.getElementById(
            "attendanceTable"
        );


    table.innerHTML = "";


    let search =
        (document.getElementById("attendanceSearch")?.value || "")
        .trim()
        .toLowerCase();

    // With a search term, look up the student across every group (so you
    // don't have to know/select their group first) - just their date
    // stays fixed to whatever's picked above. With no search term, fall
    // back to the normal per-group view.
    let list = search
        ? students.filter(s =>
            String(s.name || "").toLowerCase().includes(search) ||
            String(s.roll || "").toLowerCase().includes(search) ||
            String(s.className || "").toLowerCase().includes(search)
          )
        : students.filter(s => s.group === attendanceGroup);


    if(list.length === 0){

        table.innerHTML = `

<tr>

<td colspan="4"
class="empty">

${search ? "No matching student found." : "No students in this group."}

</td>

</tr>

`;

        return;

    }


    list.forEach(s=>{

        let status =
            attendance[date][s.id] ||
            "unmarked";


        let buttonText =
            status === "present"
            ? "Present ✓"
            : status === "absent"
            ? "Absent ✗"
            : "Not Marked";


        let cls =
            status === "present"
            ? "green"
            : status === "absent"
            ? "red"
            : "gray";


        table.innerHTML += `

<tr>

<td>

${studentPhotoHTML(s)}

<b>${escapeHTML(s.name)}</b>

${search ? `<span class="small" style="display:block;">Group ${escapeHTML(s.group)}</span>` : ""}

</td>

<td>${escapeHTML(s.className)}</td>

<td>${escapeHTML(s.roll)}</td>

<td>

<button
class="btn ${cls}"
onclick="toggleAttendance(
'${s.id}',
'${date}'
)">

${buttonText}

</button>

</td>

</tr>

`;

    });

}


/* =====================================================
   TOGGLE ATTENDANCE
===================================================== */
/* =====================================================
   TOGGLE ATTENDANCE
===================================================== */

async function toggleAttendance(studentId, date) {
    if (!attendance[date]) attendance[date] = {};

    let current = attendance[date][studentId];
    let newStatus = current === "present" ? "absent" : "present";

    let id = attendanceIds[date + "|" + studentId];
    if (!id) {
        id = RFT.newId();
        attendanceIds[date + "|" + studentId] = id;
    }

    attendance[date][studentId] = newStatus;

    const row = { id, student_id: studentId, date, status: newStatus, updated_at: new Date().toISOString() };

    // 1. Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("attendance", row);
    await RFT.enqueue("attendance", "upsert", row);
    saveAll();

    // If this row was reached via the search box, clear the search after
    // marking so the view returns to the normal group list instead of
    // making you erase what you typed by hand.
    let searchInput = document.getElementById("attendanceSearch");
    if (searchInput && searchInput.value) searchInput.value = "";

    renderAttendance();
    renderMonthlyAttendance();
    renderDashboard();
}



/* =====================================================
   MONTHLY ATTENDANCE
===================================================== */

function renderMonthlyAttendance(){

    let month =
        document.getElementById(
            "attendanceMonth"
        ).value;


    if(!month){

        month =
            new Date()
            .toISOString()
            .slice(0,7);


        document.getElementById(
            "attendanceMonth"
        ).value = month;

    }


    let table =
        document.getElementById(
            "monthlyAttendanceTable"
        );


    table.innerHTML = "";


    let list =
        students.filter(
            s => s.group === attendanceGroup
        );


    list.forEach(s=>{

        let present = 0;
        let absent = 0;


        Object.keys(attendance)
        .forEach(date=>{

            if(date.startsWith(month)){

                let status =
                    attendance[date][s.id];


                if(status === "present")
                    present++;

                if(status === "absent")
                    absent++;

            }

        });


        let total =
            present + absent;


        let percent =
            total === 0
            ? 0
            : present / total * 100;


        table.innerHTML += `

<tr>

<td>

${studentPhotoHTML(s)}

<b>${escapeHTML(s.name)}</b>

</td>

<td class="present">
${present}
</td>

<td class="absent">
${absent}
</td>

<td>${total}</td>

<td>${percent.toFixed(1)}%</td>

</tr>

`;

    });

}


/* =====================================================
   FINANCIAL MANAGEMENT
   (NGO income / expense ledger - replaces the old
   per-student Fees section now that the tuition center no
   longer charges fees. Old fee records are left untouched
   in the "fees" table/array - see feeFromRow/feeToRow above
   and the Dashboard / Student History views that still read
   them - they are simply no longer editable from here.)
===================================================== */

const FINANCE_CATEGORIES = {
    income: [
        "Donation - Individual",
        "Donation - Organization",
        "Grant / Financial Assistance",
        "Fundraising Collection",
        "Other Income"
    ],
    expense: [
        "Books & Educational Materials",
        "Stationery & School Supplies",
        "Teaching Materials & Equipment",
        "Student Support & Educational Assistance",
        "Transportation",
        "Events & Activities",
        "Food & Refreshments",
        "Administrative Expenses",
        "Other Operational Expense"
    ]
};

const FINANCE_CUSTOM_VALUE = "__custom__";

/* Fills a <select> with the preset categories for the given type
   (income/expense), plus a "Custom category..." option, and shows/hides
   the matching free-text input depending on what's currently selected. */
function populateFinanceCategorySelect(selectId, type, selectedCategory){
    let select = document.getElementById(selectId);
    if(!select) return;

    let presets = FINANCE_CATEGORIES[type] || [];
    let isCustom = !!selectedCategory && !presets.includes(selectedCategory);

    select.innerHTML =
        presets.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("") +
        `<option value="${FINANCE_CUSTOM_VALUE}">Other (type your own)...</option>`;

    select.value = isCustom ? FINANCE_CUSTOM_VALUE : (selectedCategory || presets[0] || FINANCE_CUSTOM_VALUE);
}

function toggleFinanceCustomCategory(selectId, customInputId){
    let select = document.getElementById(selectId);
    let customInput = document.getElementById(customInputId);
    if(!select || !customInput) return;

    let showCustom = select.value === FINANCE_CUSTOM_VALUE;
    customInput.style.display = showCustom ? "block" : "none";
    if(!showCustom) customInput.value = "";
}

/* Income / Expense toggle buttons on the Add form. */
function selectFinanceType(type){
    document.getElementById("financeType").value = type;

    let incomeBtn = document.getElementById("financeTypeIncomeBtn");
    let expenseBtn = document.getElementById("financeTypeExpenseBtn");

    if(type === "expense"){
        expenseBtn.classList.add("active", "expense-active");
        incomeBtn.classList.remove("active", "income-active");
    } else {
        incomeBtn.classList.add("active", "income-active");
        expenseBtn.classList.remove("active", "expense-active");
    }

    onFinanceTypeChange();
}

/* Add form: category list depends on whether Income or Expense is
   selected, so it's rebuilt whenever the type changes. */
function onFinanceTypeChange(){
    let type = document.getElementById("financeType").value === "expense" ? "expense" : "income";
    populateFinanceCategorySelect("financeCategory", type, "");
    toggleFinanceCustomCategory("financeCategory", "financeCategoryCustom");
}

function onFinanceCategoryChange(){
    toggleFinanceCustomCategory("financeCategory", "financeCategoryCustom");
}

function onEditFinanceTypeChange(){
    let type = document.getElementById("editFinanceType").value === "expense" ? "expense" : "income";
    populateFinanceCategorySelect("editFinanceCategory", type, "");
    toggleFinanceCustomCategory("editFinanceCategory", "editFinanceCategoryCustom");
}

function onEditFinanceCategoryChange(){
    toggleFinanceCustomCategory("editFinanceCategory", "editFinanceCategoryCustom");
}

/* =====================================================
   ADD FINANCIAL RECORD (OFFLINE-CAPABLE)
===================================================== */

/* Shared guard for every Finance action/render function below, and
   (from Stage 1 of the teacher permission fix) for owner-only actions
   elsewhere in the app too (student/exam delete, Backup/Restore).
   Returns true (and alerts, if requested) if the CURRENT session is
   not the owner, so callers can do `if (denyIfNotOwner(true)) return;`
   at the very top of a function - before any IndexedDB write, outbox
   enqueue, or sync call. message lets each call site show wording
   appropriate to what it's guarding; existing Finance call sites don't
   pass one, so they keep showing exactly the same text as before. */
function denyIfNotOwner(showAlert, message){
    if(isOwner()) return false;
    if(showAlert) alert(message || "Finance is restricted to the owner account.");
    return true;
}

async function addFinance(){
    if(denyIfNotOwner(true)) return;

    let type = document.getElementById("financeType").value === "expense" ? "expense" : "income";
    let amount = Number(document.getElementById("financeAmount").value);
    let date = document.getElementById("financeDate").value;

    let categorySelect = document.getElementById("financeCategory").value;
    let category = categorySelect === FINANCE_CUSTOM_VALUE
        ? document.getElementById("financeCategoryCustom").value.trim()
        : categorySelect;

    let description = document.getElementById("financeDescription").value.trim();
    let party = document.getElementById("financeParty").value.trim();
    let method = document.getElementById("financeMethod").value;
    let reference = document.getElementById("financeReference").value.trim();
    let notes = document.getElementById("financeNotes").value.trim();

    if(!amount || amount <= 0 || !Number.isFinite(amount)){
        alert("Please enter a valid amount greater than zero.");
        return;
    }

    if(!date){
        alert("Please select a transaction date.");
        return;
    }

    if(!category){
        alert("Please select or enter a category.");
        return;
    }

    const newRecord = {
        id: RFT.newId(),
        type,
        amount,
        date,
        category,
        description,
        party,
        method,
        reference,
        notes
    };

    const row = financeToRow(newRecord);

    // Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("finance", row);
    await RFT.enqueue("finance", "upsert", row);

    finance.push(newRecord);
    saveAll();

    // Reset the form for the next entry.
    document.getElementById("financeAmount").value = "";
    document.getElementById("financeDescription").value = "";
    document.getElementById("financeParty").value = "";
    document.getElementById("financeReference").value = "";
    document.getElementById("financeNotes").value = "";
    document.getElementById("financeDate").value = today();
    onFinanceTypeChange();

    renderFinance();
    renderFinanceSummary();

    alert((type === "income" ? "Income" : "Expense") + " record saved successfully.");
}

/* =====================================================
   FINANCIAL DASHBOARD (Total Income / Expenses / Balance)
===================================================== */

function renderFinanceSummary(){
    let incomeEl = document.getElementById("financeTotalIncome");
    let expenseEl = document.getElementById("financeTotalExpenses");
    let balanceEl = document.getElementById("financeBalance");

    if(denyIfNotOwner(false)){
        // Not the owner - leave the summary cards blank rather than
        // computing/displaying anything derived from Finance data.
        if(incomeEl) incomeEl.innerText = "Rs. 0";
        if(expenseEl) expenseEl.innerText = "Rs. 0";
        if(balanceEl) balanceEl.innerText = "Rs. 0";
        return;
    }

    let totalIncome = finance
        .filter(f => f.type === "income")
        .reduce((sum, f) => sum + Number(f.amount || 0), 0);

    let totalExpenses = finance
        .filter(f => f.type === "expense")
        .reduce((sum, f) => sum + Number(f.amount || 0), 0);

    let balance = totalIncome - totalExpenses;

    if(incomeEl) incomeEl.innerText = "Rs. " + totalIncome;
    if(expenseEl) expenseEl.innerText = "Rs. " + totalExpenses;
    if(balanceEl) balanceEl.innerText = "Rs. " + balance;
}

/* =====================================================
   RENDER FINANCIAL HISTORY (search + filter + sort)
===================================================== */

let financeTypeFilter = "all"; // "all" | "income" | "expense"

function setFinanceTypeFilter(type, button){
    financeTypeFilter = type;

    document.querySelectorAll("#fees .finance-filter-buttons button")
        .forEach(btn => btn.classList.remove("active"));

    if(button) button.classList.add("active");

    renderFinance();
}

function renderFinance(){
    let container = document.getElementById("financeTable");
    if(!container) return;

    if(denyIfNotOwner(false)){
        container.innerHTML = "";
        return;
    }

    container.innerHTML = "";

    let search = (document.getElementById("financeSearch")?.value || "").trim().toLowerCase();
    let categoryFilter = document.getElementById("financeCategoryFilter")?.value || "";
    let fromDate = document.getElementById("financeFromDate")?.value || "";
    let toDate = document.getElementById("financeToDate")?.value || "";

    let visibleCount = 0;

    finance
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .reverse()
    .forEach(f => {

        if(financeTypeFilter !== "all" && f.type !== financeTypeFilter) return;

        if(categoryFilter && f.category !== categoryFilter) return;

        if(fromDate && String(f.date || "") < fromDate) return;
        if(toDate && String(f.date || "") > toDate) return;

        if(search){
            let haystack = [f.description, f.category, f.party, f.reference]
                .map(v => String(v || "").toLowerCase())
                .join(" ");
            if(!haystack.includes(search)) return;
        }

        visibleCount++;

        let isIncome = f.type === "income";

        container.innerHTML += `

<div class="finance-card">

<div class="finance-card-top">

<div class="finance-card-icon ${isIncome ? "finance-icon-income" : "finance-icon-expense"}">
${isIncome ? "⬇️" : "⬆️"}
</div>

<div class="finance-card-heading">
<strong class="student-list-name">${escapeHTML(f.category)}</strong>
<span class="finance-card-sub">${escapeHTML(f.description || "No description")}</span>
</div>

<div class="fee-menu">

<button
class="fee-menu-button"
onclick="toggleFinanceMenu(this)">
⋮
</button>

<div class="fee-menu-dropdown">

<button
onclick="viewFinance('${f.id}')">
👁️
<span>View Details</span>
</button>

<button
onclick="editFinance('${f.id}')">
✏️
<span>Edit</span>
</button>

<button
class="delete-option"
onclick="deleteFinance('${f.id}')">
🗑️
<span>Delete</span>
</button>

</div>

</div>

</div>

<div class="recent-student-meta">
<span>${escapeHTML(f.date)}</span>
${f.party ? `<span>${isIncome ? "From" : "To"}: ${escapeHTML(f.party)}</span>` : ""}
${f.method ? `<span>${escapeHTML(f.method)}</span>` : ""}
<span class="${isIncome ? "paid" : "due"}">${isIncome ? "INCOME" : "EXPENSE"}</span>
<span class="finance-amount ${isIncome ? "paid" : "due"}">Rs. ${f.amount}</span>
</div>

</div>

`;

    });

    if(visibleCount === 0){
        container.innerHTML = `<div class="empty">${search || categoryFilter || fromDate || toDate || financeTypeFilter !== "all" ? "No matching financial records found." : "No financial records yet."}</div>`;
    }
}

/* Rebuilds the category filter dropdown from whatever categories are
   actually in use (owner-only, like the rest of Finance). */
function renderFinanceCategoryFilterOptions(){
    let select = document.getElementById("financeCategoryFilter");
    if(!select) return;

    if(denyIfNotOwner(false)){
        select.innerHTML = `<option value="">All Categories</option>`;
        return;
    }

    let current = select.value;

    let categories = Array.from(new Set(finance.map(f => f.category).filter(Boolean))).sort();

    select.innerHTML =
        `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");

    if(categories.includes(current)) select.value = current;
}

/* =====================================================
   VIEW FINANCIAL RECORD DETAILS
===================================================== */

function viewFinance(id){
    if(denyIfNotOwner(true)) return;

    let f = finance.find(r => r.id === id);
    if(!f){
        alert("Record not found.");
        return;
    }

    alert(
        (f.type === "income" ? "INCOME RECORD" : "EXPENSE RECORD") + "\n\n" +
        "Amount: Rs. " + f.amount + "\n" +
        "Date: " + f.date + "\n" +
        "Category: " + f.category + "\n" +
        "Description: " + (f.description || "-") + "\n" +
        (f.type === "income" ? "Received from: " : "Paid to: ") + (f.party || "-") + "\n" +
        "Payment method: " + (f.method || "-") + "\n" +
        "Reference / Transaction ID: " + (f.reference || "-") + "\n" +
        "Notes: " + (f.notes || "-")
    );
}

/* =====================================================
   EDIT FINANCIAL RECORD (offline-capable, inline form -
   same pattern as Edit Student, not a prompt() chain, since
   this record has too many fields for that)
===================================================== */

function editFinance(id){
    if(denyIfNotOwner(true)) return;

    let f = finance.find(r => r.id === id);
    if(!f){
        alert("Record not found.");
        return;
    }

    document.getElementById("editFinanceBox").style.display = "block";
    document.getElementById("editFinanceId").value = f.id;
    document.getElementById("editFinanceType").value = f.type;
    document.getElementById("editFinanceAmount").value = f.amount;
    document.getElementById("editFinanceDate").value = f.date;

    let type = f.type === "expense" ? "expense" : "income";
    populateFinanceCategorySelect("editFinanceCategory", type, f.category);
    toggleFinanceCustomCategory("editFinanceCategory", "editFinanceCategoryCustom");
    if(document.getElementById("editFinanceCategory").value === FINANCE_CUSTOM_VALUE){
        document.getElementById("editFinanceCategoryCustom").value = f.category;
    }

    document.getElementById("editFinanceDescription").value = f.description || "";
    document.getElementById("editFinanceParty").value = f.party || "";
    document.getElementById("editFinanceMethod").value = f.method || "";
    document.getElementById("editFinanceReference").value = f.reference || "";
    document.getElementById("editFinanceNotes").value = f.notes || "";

    document.getElementById("editFinanceBox").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

async function saveFinanceEdit(){
    if(denyIfNotOwner(true)) return;

    let id = document.getElementById("editFinanceId").value;
    let f = finance.find(r => r.id === id);
    if(!f){
        alert("Record not found.");
        return;
    }

    let type = document.getElementById("editFinanceType").value === "expense" ? "expense" : "income";
    let amount = Number(document.getElementById("editFinanceAmount").value);
    let date = document.getElementById("editFinanceDate").value;

    let categorySelect = document.getElementById("editFinanceCategory").value;
    let category = categorySelect === FINANCE_CUSTOM_VALUE
        ? document.getElementById("editFinanceCategoryCustom").value.trim()
        : categorySelect;

    if(!amount || amount <= 0 || !Number.isFinite(amount)){
        alert("Please enter a valid amount greater than zero.");
        return;
    }

    if(!date){
        alert("Please select a transaction date.");
        return;
    }

    if(!category){
        alert("Please select or enter a category.");
        return;
    }

    f.type = type;
    f.amount = amount;
    f.date = date;
    f.category = category;
    f.description = document.getElementById("editFinanceDescription").value.trim();
    f.party = document.getElementById("editFinanceParty").value.trim();
    f.method = document.getElementById("editFinanceMethod").value;
    f.reference = document.getElementById("editFinanceReference").value.trim();
    f.notes = document.getElementById("editFinanceNotes").value.trim();

    const row = financeToRow(f);
    await RFT.put("finance", row);
    await RFT.enqueue("finance", "upsert", row);
    saveAll();

    cancelFinanceEdit();
    renderFinance();
    renderFinanceSummary();

    alert("✅ Record updated successfully.");
}

function cancelFinanceEdit(){
    document.getElementById("editFinanceBox").style.display = "none";
    document.getElementById("editFinanceId").value = "";
}

/* =====================================================
   DELETE FINANCIAL RECORD (OFFLINE-CAPABLE)
===================================================== */

async function deleteFinance(id){
    if(denyIfNotOwner(true)) return;

    if(!confirm("Are you sure you want to delete this financial record? This cannot be undone.")){
        return;
    }

    await RFT.remove("finance", id);
    await RFT.enqueue("finance", "delete", { id });

    finance = finance.filter(f => f.id !== id);
    saveAll();

    renderFinance();
    renderFinanceSummary();

    alert("Record deleted.");
}

/* =====================================================
   FINANCE ACTION MENU (⋮) - same dropdown behaviour as the
   rest of the app (toggleExamMenu/toggleFeeMenu), reusing the
   existing .fee-menu / .fee-menu-dropdown styling.
===================================================== */

function toggleFinanceMenu(button){
    let menu = button.parentElement.querySelector(".fee-menu-dropdown");

    let willOpen = !menu.classList.contains("show");

    document.querySelectorAll("#fees .fee-menu-dropdown").forEach(otherMenu => {
        if(otherMenu !== menu) otherMenu.classList.remove("show");
    });

    if(willOpen) positionFloatingMenu(button, menu);
    menu.classList.toggle("show");
}

document.addEventListener("click", function(event){
    if(!event.target.closest("#fees .fee-menu")){
        document.querySelectorAll("#fees .fee-menu-dropdown").forEach(menu => {
            menu.classList.remove("show");
        });
    }
});


/* =====================================================
   CREATE EXAM
===================================================== */

async function createExam(){

    let name = document.getElementById("examName").value.trim();
    let date = document.getElementById("examDate").value;

    if(!name){
        alert("Please enter exam name.");
        return;
    }

    if(!date){
        alert("Please select exam date.");
        return;
    }

    const newExam = {
        id: RFT.newId(),
        name,
        date,
        createdAt: new Date().toISOString()
    };
    const row = examToRow(newExam);

    await RFT.put("exams", row);
    await RFT.enqueue("exams", "upsert", row);

    exams.push(newExam);
    saveAll();

    document.getElementById("examName").value = "";
    document.getElementById("examDate").value = "";

    renderExamSelect();

    alert("Exam created successfully.");

}
// deleteExam() (legacy, argument-less) removed - it was dead code, never
// called from anywhere. deleteExamById()/deleteSelectedExam() below are
// what the UI actually uses.


/* =====================================================
   EXAM SELECT
===================================================== */

function renderExamSelect(){

    let select =
        document.getElementById(
            "examSelect"
        );

    // Remember what was selected so a rename/list-rebuild doesn't silently
    // jump the view back to the first exam (which made an edited exam's
    // marks look like they'd vanished, when they were only ever hidden
    // behind a different exam now showing instead).
    let previousValue = select.value;

    select.innerHTML = "";


    if(exams.length === 0){

        select.innerHTML = `

<option value="">

No exams created

</option>

`;

        return;

    }


    exams.forEach(exam => {

        select.innerHTML += `

<option value="${exam.id}">

${escapeHTML(exam.name)} - ${exam.date}

</option>

`;

    });

    if (previousValue && exams.some(e => e.id === previousValue)) {
        select.value = previousValue;
    }
}


/* =====================================================
   RESULT GROUP
===================================================== */

function selectResultGroup(group){

    resultGroup = group;

    renderGroupButtons();

    renderResults();

}


/* =====================================================
   RESULTS
===================================================== */
let resultsView = "summary";

let resultSearchText = "";

let selectedResultStudentId = null;
function setResultsView(view){

    resultsView = view;

    document
        .getElementById("resultSummaryBtn")
        .classList.toggle(
            "active",
            view === "summary"
        );

    document
        .getElementById("resultEntryBtn")
        .classList.toggle(
            "active",
            view === "entry"
        );

    selectedResultStudentId = null;

    renderResults();
}


function searchResultStudents(){

    resultSearchText =
        document
        .getElementById("resultStudentSearch")
        .value
        .trim()
        .toLowerCase();

    renderResults();
}


function getResultStudents(){

    let list =
        students.filter(
            s => s.group === resultGroup
        );

    if(!resultSearchText)
        return list;

    return list.filter(s => {

        let name =
            String(s.name || "")
            .toLowerCase();

        let roll =
            String(s.roll || "")
            .toLowerCase();

        return (
            name.includes(resultSearchText) ||
            roll.includes(resultSearchText)
        );

    });
}
function renderResults(){

    let table =
        document.getElementById(
            "resultsTable"
        );

    let head =
        document.getElementById(
            "resultsTableHead"
        );

    table.innerHTML = "";
    head.innerHTML = "";

    let select =
        document.getElementById(
            "examSelect"
        );

    let examId =
        select.value;

    if(!examId){

        head.innerHTML = `
<tr>
<th>Student</th>
<th>Total</th>
<th>%</th>
<th>Grade</th>
<th>Result</th>
</tr>
`;

        table.innerHTML = `
<tr>
<td colspan="5" class="empty">
Create an exam first.
</td>
</tr>
`;

        return;
    }

    if(!results[examId])
        results[examId] = {};

    let list =
        getResultStudents();

    if(list.length === 0){

        head.innerHTML = `
<tr>
<th>Student</th>
<th>Total</th>
<th>%</th>
<th>Grade</th>
<th>Result</th>
</tr>
`;

        table.innerHTML = `
<tr>
<td colspan="5" class="empty">
No students found.
</td>
</tr>
`;

        return;
    }


    /* =========================================
       STUDENT DETAIL VIEW
    ========================================= */

    if(selectedResultStudentId){

        renderResultStudentDetail(
            examId,
            selectedResultStudentId
        );

        return;
    }


    /* =========================================
       SUMMARY VIEW
    ========================================= */

    if(resultsView === "summary"){

        head.innerHTML = `
<tr>
<th>Student</th>
<th>Total /100</th>
<th>%</th>
<th>Grade</th>
<th>Result</th>
</tr>
`;

        list.forEach(s => {

            // Read-only default for display - does NOT touch the shared
            // results object. Writing a placeholder here (without an id)
            // used to get "adopted" as if it were a real saved mark the
            // moment you typed one, permanently breaking that save.
            let r =
                results[examId][s.id] || { english: 0, nepali: 0, math: 0, science: 0 };

            let total =
                Number(r.english || 0) +
                Number(r.nepali || 0) +
                Number(r.math || 0) +
                Number(r.science || 0);

            let percentage =
                total;

            let grade =
                getGrade(percentage);

            let pass =
                Number(r.english || 0) >= 10 &&
                Number(r.nepali || 0) >= 10 &&
                Number(r.math || 0) >= 10 &&
                Number(r.science || 0) >= 10;

            let row =
                document.createElement("tr");

            row.innerHTML = `

<td>
    <div
        class="result-student-summary"
        onclick="openResultStudent('${s.id}')">

        ${studentPhotoHTML(s)}

        <div>
            <b>
                ${escapeHTML(s.name)}
            </b>

            <small>
                Roll ${escapeHTML(s.roll)}
            </small>
        </div>

    </div>
</td>

<td>
    <b>${total}/100</b>
</td>

<td>
    ${percentage.toFixed(1)}%
</td>

<td class="${
    grade === "F"
    ? "grade-fail"
    : "grade-good"
}">
    <b>${grade}</b>
</td>

<td class="${
    pass
    ? "present"
    : "absent"
}">
    ${pass ? "PASS" : "FAIL"}
</td>

`;

            table.appendChild(row);

        });

        return;
    }


    /* =========================================
       ENTER MARKS VIEW
    ========================================= */

    head.innerHTML = `
<tr>
<th>Student</th>
<th>English /25</th>
<th>Nepali /25</th>
<th>Math /25</th>
<th>Science /25</th>
<th>Total /100</th>
<th>%</th>
<th>Grade</th>
<th>Result</th>
</tr>
`;

    list.forEach(s => {

        // Read-only default for display - does NOT touch the shared
        // results object (see the other occurrence of this pattern above
        // for why that mattered).
        let r =
            results[examId][s.id] || { english: 0, nepali: 0, math: 0, science: 0 };

        let total =
            Number(r.english || 0) +
            Number(r.nepali || 0) +
            Number(r.math || 0) +
            Number(r.science || 0);

        let percentage =
            total;

        let grade =
            getGrade(percentage);

        let pass =
            Number(r.english || 0) >= 10 &&
            Number(r.nepali || 0) >= 10 &&
            Number(r.math || 0) >= 10 &&
            Number(r.science || 0) >= 10;

        table.innerHTML += `

<tr data-student-id="${s.id}">

<td>
${studentPhotoHTML(s)}
<b>${escapeHTML(s.name)}</b>
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.english}"
oninput="updateMark(
'${examId}',
'${s.id}',
'english',
this.value,
this
)">
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.nepali}"
oninput="updateMark(
'${examId}',
'${s.id}',
'nepali',
this.value,
this
)">
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.math}"
oninput="updateMark(
'${examId}',
'${s.id}',
'math',
this.value,
this
)">
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.science}"
oninput="updateMark(
'${examId}',
'${s.id}',
'science',
this.value,
this
)">
</td>

<td>
<b>${total}/100</b>
</td>

<td>
${percentage.toFixed(1)}%
</td>

<td class="${
    grade === "F"
    ? "grade-fail"
    : "grade-good"
}">
<b>${grade}</b>
</td>

<td class="${
    pass
    ? "present"
    : "absent"
}">
${pass ? "PASS" : "FAIL"}
</td>

</tr>
`;

    });

}
function openResultStudent(studentId){

    selectedResultStudentId =
        studentId;

    renderResults();
}


function renderResultStudentDetail(
    examId,
    studentId
){

    let table =
        document.getElementById(
            "resultsTable"
        );

    let head =
        document.getElementById(
            "resultsTableHead"
        );

    let student =
        students.find(
            s => s.id === studentId
        );

    if(!student){
        selectedResultStudentId = null;
        renderResults();
        return;
    }

    // Read-only default for display - does NOT touch the shared results
    // object (a placeholder without a proper id here used to get
    // "adopted" as the real saved record the moment a mark was typed,
    // and IndexedDB then permanently refused to save it).
    let r =
        results[examId][studentId] || { english: 0, nepali: 0, math: 0, science: 0 };

    let total =
        Number(r.english || 0) +
        Number(r.nepali || 0) +
        Number(r.math || 0) +
        Number(r.science || 0);

    let percentage =
        total;

    let grade =
        getGrade(percentage);

    let pass =
        Number(r.english || 0) >= 10 &&
        Number(r.nepali || 0) >= 10 &&
        Number(r.math || 0) >= 10 &&
        Number(r.science || 0) >= 10;


    head.innerHTML = `
<tr>
<th colspan="2">
    Student Result
</th>
</tr>
`;


    table.innerHTML = `

<tr>
<td colspan="2">

<div class="result-detail-header">

    <button
        class="result-back-button"
        onclick="closeResultStudentDetail()">
        ← Back
    </button>

    <div class="result-detail-student">

        ${studentPhotoHTML(student)}

        <div>

            <h3>
                ${escapeHTML(student.name)}
            </h3>

            <p>
                Class ${escapeHTML(student.className)}
                • Roll ${escapeHTML(student.roll)}
                • Group ${escapeHTML(student.group)}
            </p>

        </div>

    </div>

</div>

</td>
</tr>


<tr>
<td>
    English
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.english}"
oninput="updateMark(
'${examId}',
'${studentId}',
'english',
this.value,
this
)">
<span>/25</span>
</td>
</tr>


<tr>
<td>
    Nepali
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.nepali}"
oninput="updateMark(
'${examId}',
'${studentId}',
'nepali',
this.value,
this
)">
<span>/25</span>
</td>
</tr>


<tr>
<td>
    Math
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.math}"
oninput="updateMark(
'${examId}',
'${studentId}',
'math',
this.value,
this
)">
<span>/25</span>
</td>
</tr>


<tr>
<td>
    Science
</td>

<td>
<input
class="marks-input"
type="number"
min="0"
max="25"
inputmode="numeric"
value="${r.science}"
oninput="updateMark(
'${examId}',
'${studentId}',
'science',
this.value,
this
)">
<span>/25</span>
</td>
</tr>


<tr>
<td>
    <b>Total</b>
</td>

<td>
    <b>${total}/100</b>
</td>
</tr>


<tr>
<td>
    Percentage
</td>

<td>
    ${percentage.toFixed(1)}%
</td>
</tr>


<tr>
<td>
    Grade
</td>

<td class="${
    grade === "F"
    ? "grade-fail"
    : "grade-good"
}">
    <b>${grade}</b>
</td>
</tr>


<tr>
<td>
    Result
</td>

<td class="${
    pass
    ? "present"
    : "absent"
}">
    <b>${pass ? "PASS" : "FAIL"}</b>
</td>
</tr>

`;

}


function closeResultStudentDetail(){

    selectedResultStudentId =
        null;

    renderResults();

}


function refreshResultDetail(
    examId,
    studentId
){

    if(
        selectedResultStudentId !==
        studentId
    )
        return;

    renderResultStudentDetail(
        examId,
        studentId
    );

}


/* =====================================================
   UPDATE MARK
===================================================== */
async function updateMark(
    examId,
    studentId,
    subject,
    value,
    input
){

    let mark = Number(value);
    if(isNaN(mark)) mark = 0;
    mark = Math.max(0, Math.min(25, mark));

    if(!results[examId]) results[examId] = {};

    // If this entry doesn't exist yet, OR exists but is somehow missing
    // its id (e.g. a leftover corrupted entry from a previous bug), give
    // it a fresh id now rather than silently reusing a broken one forever.
    if(!results[examId][studentId] || !results[examId][studentId].id){
        results[examId][studentId] = {
            ...(results[examId][studentId] || {}),
            id: RFT.newId(),
            english: (results[examId][studentId] || {}).english || 0,
            nepali: (results[examId][studentId] || {}).nepali || 0,
            math: (results[examId][studentId] || {}).math || 0,
            science: (results[examId][studentId] || {}).science || 0,
            createdAt: new Date().toISOString()
        };
    }

    results[examId][studentId][subject] = mark;

    let result = results[examId][studentId];

    let total =
        Number(result.english || 0) +
        Number(result.nepali || 0) +
        Number(result.math || 0) +
        Number(result.science || 0);

    result.total = total;

    const row = {
        id: result.id,
        student_id: studentId,
        exam_id: examId,
        english: Number(result.english || 0),
        nepali: Number(result.nepali || 0),
        maths: Number(result.math || 0),
        science: Number(result.science || 0),
        total: total,
        updated_at: new Date().toISOString()
    };
    if (result.createdAt) row.created_at = result.createdAt;

    // Local-first: write + queue, no live "does it exist yet" round trip
    // needed - the id is known client-side so upsert always does the
    // right thing whether this is a new mark or an edit.
    await RFT.put("results", row);
    await RFT.enqueue("results", "upsert", row);
    saveAll();

    if(selectedResultStudentId === studentId){
        refreshResultDetail(examId, studentId);
    }
    else{
        updateResultRow(examId, studentId);
    }
}




/* =====================================================
   UPDATE RESULT ROW
===================================================== */

function updateResultRow(
    examId,
    studentId
){

    let row =
        document.querySelector(
            `tr[data-student-id="${studentId}"]`
        );


    if(!row)
        return;


    let r =
        results[examId][studentId];


    let total =

        Number(r.english || 0) +
        Number(r.nepali || 0) +
        Number(r.math || 0) +
        Number(r.science || 0);


    let percentage = total;


    let grade =
        getGrade(percentage);


    let pass =

        Number(r.english || 0) >= 10 &&
        Number(r.nepali || 0) >= 10 &&
        Number(r.math || 0) >= 10 &&
        Number(r.science || 0) >= 10;


    row.cells[5].innerHTML =
        `<b>${total}/100</b>`;


    row.cells[6].innerText =
        percentage.toFixed(1) + "%";


    row.cells[7].innerHTML =
        `<b>${grade}</b>`;


    row.cells[7].className =
        grade === "F"
        ? "grade-fail"
        : "grade-good";


    row.cells[8].innerText =
        pass
        ? "PASS"
        : "FAIL";


    row.cells[8].className =
        pass
        ? "present"
        : "absent";

}


/* =====================================================
   GRADES
===================================================== */

function getGrade(p){

    if(p >= 90) return "A+";
    if(p >= 80) return "A";
    if(p >= 70) return "B+";
    if(p >= 60) return "B";
    if(p >= 50) return "C+";
    if(p >= 40) return "C";

    return "F";

}


/* =====================================================
   STUDENT HISTORY SEARCH
===================================================== */

function searchHistoryStudents(){

    let input =
        document.getElementById(
            "historySearch"
        );


    let search =
        input.value
        .trim()
        .toLowerCase();


    let container =
        document.getElementById(
            "historySearchResults"
        );


    if(!search){

        container.innerHTML = `

<div class="empty">

Start typing to search students.

</div>

`;

        return;

    }


    let matches =
        students.filter(s=>{

            let name =
                String(s.name || "")
                .toLowerCase();

            let roll =
                String(s.roll || "")
                .toLowerCase();

            let className =
                String(s.className || "")
                .toLowerCase();

            let parent =
                String(s.parent || "")
                .toLowerCase();

            let phone =
                String(s.phone || "")
                .toLowerCase();

            let group =
                String(s.group || "")
                .toLowerCase();


            return (

                name.includes(search) ||

                roll.includes(search) ||

                className.includes(search) ||

                parent.includes(search) ||

                phone.includes(search) ||

                group.includes(search)

            );

        });


    if(matches.length === 0){

        container.innerHTML = `

<div class="empty">

❌ No matching student found.

</div>

`;

        return;

    }


    let displayMatches =
        matches.slice(0,50);


    container.innerHTML = "";


    displayMatches.forEach(student=>{

        let item =
            document.createElement("div");


        item.className =
            "history-student-item";


        if(
            selectedHistoryStudentId ===
            student.id
        ){

            item.classList.add("active");

        }


        let photoHTML;


        if(student.photo){

            photoHTML = `

<img
src="${escapeHTML(student.photo)}"
alt="${escapeHTML(student.name)}">

`;

        }
        else{

            photoHTML = `

<div class="history-avatar">
👤
</div>

`;

        }


        item.innerHTML = `

${photoHTML}

<div class="history-student-info">

<strong>
${escapeHTML(student.name)}
</strong>

<span>

Class ${escapeHTML(student.className)}

&nbsp; • &nbsp;

Roll ${escapeHTML(student.roll)}

&nbsp; • &nbsp;

Group ${escapeHTML(student.group)}

</span>

</div>

`;


        item.onclick = function(){

            selectHistoryStudent(
                student.id
            );

        };


        container.appendChild(item);

    });


    if(matches.length > 50){

        let more =
            document.createElement("div");

        more.className = "empty";

        more.innerHTML =
            "Showing first 50 matches. Refine your search.";

        container.appendChild(more);

    }

}


/* =====================================================
   SELECT HISTORY STUDENT
===================================================== */

function selectHistoryStudent(id){

    selectedHistoryStudentId = id;


    let student =
        students.find(
            s => s.id === id
        );


    if(!student)
        return;


    let search =
        document.getElementById(
            "historySearch"
        );


    search.value =
        student.name;


    let selected =
        document.getElementById(
            "historySelected"
        );


    selected.style.display =
        "block";


    selected.innerHTML =

        "👤 Selected: <b>" +
        escapeHTML(student.name) +
        "</b> — Class " +
        escapeHTML(student.className) +
        ", Roll " +
        escapeHTML(student.roll) +
        ", Group " +
        escapeHTML(student.group);


    searchHistoryStudents();


    renderStudentHistory();

}


/* =====================================================
   STUDENT HISTORY
===================================================== */
function renderStudentHistory() {

    if (!selectedHistoryStudentId) {
        document.getElementById("studentHistoryContent").innerHTML = `
            <div class="panel">
                <div class="empty">
                    🔎 Search for a student above to view their complete history.
                </div>
            </div>
        `;
        return;
    }

    let id = selectedHistoryStudentId;
    let student = students.find(s => s.id === id);

    if (!student) {
        document.getElementById("studentHistoryContent").innerHTML = "";
        return;
    }

    let content = document.getElementById("studentHistoryContent");

    let present = 0;
    let absent = 0;
    let attendanceRows = "";

    Object.keys(attendance)
        .sort()
        .reverse()
        .forEach(date => {
            let status = attendance[date][id];
            if (!status) return;

            if (status === "present") present++;
            if (status === "absent") absent++;

            attendanceRows += `
                <tr>
                    <td>${date}</td>
                    <td class="${status === "present" ? "present" : "absent"}">
                        ${status === "present" ? "Present ✓" : "Absent ✗"}
                    </td>
                </tr>
            `;
        });

    let totalAttendance = present + absent;
    let attendancePercent = totalAttendance === 0 ? 0 : (present / totalAttendance) * 100;

    /* FEE HISTORY */
    let feeRows = "";
    fees
        .filter(f => f.studentId === id)
        .slice()
        .reverse()
        .forEach(f => {
            feeRows += `
                <tr>
                    <td>${escapeHTML(f.month)}</td>
                    <td>Rs. ${f.amount}</td>
                    <td class="paid">Paid</td>
                    <td>${escapeHTML(f.paidDate)}</td>
                </tr>
            `;
        });

    /* EXAM HISTORY (ALL EXAMS SHOWN) */
    let examRows = "";
    let examsTaken = 0;
    let percentageTotal = 0;

    exams
        .slice()
        .reverse()
        .forEach(exam => {
            let r = results[exam.id] ? results[exam.id][id] : null;

            let total = 0;
            let percentage = 0;
            let grade = "F";
            let pass = false;

            if (r) {
                total =
                    Number(r.english || 0) +
                    Number(r.nepali || 0) +
                    Number(r.math || 0) +
                    Number(r.science || 0);

                percentage = total;
                grade = typeof getGrade === "function" ? getGrade(percentage) : "F";

                pass =
                    Number(r.english || 0) >= 10 &&
                    Number(r.nepali || 0) >= 10 &&
                    Number(r.math || 0) >= 10 &&
                    Number(r.science || 0) >= 10;

                examsTaken++;
                percentageTotal += total;
            }

            examRows += `
                <tr>
                    <td>${escapeHTML(exam.name)}</td>
                    <td>${exam.date || "N/A"}</td>
                    <td>${total}/100</td>
                    <td>${percentage.toFixed(1)}%</td>
                    <td>
                        <span class="${grade === "F" ? "grade-fail" : "grade-good"}">
                            <b>${grade}</b>
                        </span>
                    </td>
                    <td class="${pass ? "present" : "absent"}">
                        ${pass ? "PASS" : "FAIL"}
                    </td>
                </tr>
            `;
        });

    let totalFees = fees
        .filter(f => f.studentId === id)
        .reduce((sum, f) => sum + Number(f.amount || 0), 0);

    let averagePercentage = exams.length === 0 ? 0 : percentageTotal / exams.length;

    /* DISPLAY */
    content.innerHTML = `
        <div class="panel">
            <div class="student-profile">
                ${studentPhotoHTML(student, "student-photo-large")}
                <div class="recent-student-info">
                    <h4>${escapeHTML(student.name)}</h4>
                    <div class="recent-student-meta">
                        <span>Class ${escapeHTML(student.className)}</span>
                        <span>Roll ${escapeHTML(student.roll)}</span>
                        <span>Group ${escapeHTML(student.group)}</span>
                    </div>
                    <div class="recent-student-contact">
                        👨‍👩‍👦 ${escapeHTML(student.parent || "Not provided")} &nbsp;•&nbsp; 📞 ${phoneLinkHTML(student.phone)}
                    </div>
                    <div class="recent-student-contact">
                        🗓️ Joined ${escapeHTML(student.joined || "Not available")}
                    </div>
                </div>
            </div>
        </div>

        <!-- QUICK SUMMARY -->
        <div class="history-summary-grid">
            <div class="history-summary-card">
                <div class="history-summary-icon">📅</div>
                <div>
                    <span>Attendance</span>
                    <strong>${attendancePercent.toFixed(1)}%</strong>
                </div>
            </div>

            <div class="history-summary-card">
                <div class="history-summary-icon">💰</div>
                <div>
                    <span>Total Fees</span>
                    <strong>Rs. ${totalFees}</strong>
                </div>
            </div>

            <div class="history-summary-card">
                <div class="history-summary-icon">📝</div>
                <div>
                    <span>Exams Graded</span>
                    <strong>${examsTaken}/${exams.length}</strong>
                </div>
            </div>

            <div class="history-summary-card">
                <div class="history-summary-icon">📊</div>
                <div>
                    <span>Average</span>
                    <strong>${averagePercentage.toFixed(1)}%</strong>
                </div>
            </div>
        </div>

        <div class="panel">
            <h3>📅 Attendance Summary</h3>
            <p>Present: <b class="present">${present}</b></p>
            <p>Absent: <b class="absent">${absent}</b></p>
            <p>Total Recorded: <b>${totalAttendance}</b></p>
            <p>Attendance: <b>${attendancePercent.toFixed(1)}%</b></p>
            <br>
            <table>
                <thead>
                    <tr><th>Date</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${attendanceRows || `<tr><td colspan="2" class="empty">No attendance recorded.</td></tr>`}
                </tbody>
            </table>
        </div>

        <div class="panel">
            <h3>💰 Fee History</h3>
            <div class="table-scroll">
            <table>
                <thead>
                    <tr><th>Month</th><th>Amount</th><th>Status</th><th>Paid Date</th></tr>
                </thead>
                <tbody>
                    ${feeRows || `<tr><td colspan="4" class="empty">No fee records.</td></tr>`}
                </tbody>
            </table>
            </div>
        </div>

        <div class="panel">
            <h3>📝 Exam History</h3>
            <div class="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Exam</th>
                        <th>Date</th>
                        <th>Total</th>
                        <th>Percentage</th>
                        <th>Grade</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
                    ${examRows || `<tr><td colspan="6" class="empty">No exams found.</td></tr>`}
                </tbody>
            </table>
            </div>
        </div>
    `;
}


/* =====================================================
   DASHBOARD
===================================================== */
function renderDashboard(){

    let dashboardDateEl = document.getElementById("dashboardDate");
    if (dashboardDateEl) {
        dashboardDateEl.innerText = new Date().toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    document.getElementById("totalStudents").innerText = students.length;

    /* Group cards - one per actual group, A/B/C first if present, then
       whichever other groups exist, so this keeps working no matter how
       many groups get added later. */
    let groupStatContainer = document.getElementById("dashboardGroupStats");
    if (groupStatContainer) {
        let orderedNames = groups;

        groupStatContainer.innerHTML = orderedNames.map(name => {
            let count = students.filter(s => s.group === name).length;
            return `
<div class="group-stat-card">
    <div class="group-stat-icon">${escapeHTML(name)}</div>
    <div class="group-stat-info">
        <span>GROUP ${escapeHTML(name.toUpperCase())}</span>
        <strong>${count}</strong>
        <small>Students</small>
    </div>
    <div class="group-stat-decoration">${escapeHTML(name)}</div>
</div>
`;
        }).join("");
    }

    /* Today's attendance */
    let date = today();
    let todayData = attendance[date] || {};

    let present = Object.values(todayData).filter(v => v === "present").length;
    let absent = Object.values(todayData).filter(v => v === "absent").length;

    document.getElementById("presentToday").innerText = present;
    document.getElementById("absentToday").innerText = absent;

    /* Total donations / income received (was "Total Fees" - this NGO
       doesn't charge tuition fees, so this now reflects the Financial
       Management section's income total instead). */
    let totalDonations = finance
        .filter(f => f.type === "income")
        .reduce((sum, f) => sum + Number(f.amount || 0), 0);
    document.getElementById("dashboardTotalFees").innerText = "Rs. " + totalDonations;

    /* Total exams */
    document.getElementById("dashboardTotalExams").innerText = exams.length;

    /* Overall attendance */
    let overallPresent = 0;
    let overallAbsent = 0;

    Object.values(attendance).forEach(day => {
        Object.values(day).forEach(status => {
            if(status === "present") overallPresent++;
            if(status === "absent") overallAbsent++;
        });
    });

    let totalAttendance = overallPresent + overallAbsent;
    let overallPercentage = totalAttendance === 0 ? 0 : (overallPresent / totalAttendance) * 100;

    document.getElementById("dashboardAttendance").innerText = overallPercentage.toFixed(1) + "%";

    /* Students with records */
    let studentsWithRecords = new Set();

    Object.values(attendance).forEach(day => {
        Object.keys(day).forEach(studentId => {
            studentsWithRecords.add(studentId);
        });
    });

    fees.forEach(fee => {
        studentsWithRecords.add(fee.studentId);
    });

    Object.values(results).forEach(examResults => {
        Object.keys(examResults).forEach(studentId => {
            studentsWithRecords.add(studentId);
        });
    });

    document.getElementById("dashboardStudentsWithRecords").innerText = studentsWithRecords.size;

    /* Recent students (Compact Grid Layout) */
    let container = document.getElementById("dashboardStudents");
    if (!container) return;

    let recentStudents = students.slice(-10).reverse();

    if (recentStudents.length === 0) {
        container.innerHTML = `<div class="empty">No recent students added yet.</div>`;
        return;
    }

    let html = `<div class="recent-students-grid">`;

    recentStudents.forEach(s => {
        html += `
            <div class="recent-student-card">
                ${studentPhotoHTML(s, "recent-student-avatar")}
                <div class="recent-student-info">
                    <strong>${escapeHTML(s.name)}</strong>
                    <div class="recent-student-meta">
                        <span>Class ${escapeHTML(s.className)}</span>
                        <span>Roll ${escapeHTML(s.roll)}</span>
                        <span>Group ${escapeHTML(s.group)}</span>
                    </div>
                    <div class="recent-student-contact">
                        👨‍👩‍👦 ${escapeHTML(s.parent || "N/A")} | 📞 ${phoneLinkHTML(s.phone, "N/A")}
                    </div>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

/* Data Summary counts on the Backup screen (previously static "0"
   placeholders that no code ever updated). */
function renderBackupSummary(){
    let studentsEl = document.getElementById("backupStudents");
    let attendanceEl = document.getElementById("backupAttendance");
    let feesEl = document.getElementById("backupFees");
    let financeEl = document.getElementById("backupFinance");
    let examsEl = document.getElementById("backupExams");
    let groupsEl = document.getElementById("backupGroups");

    if(studentsEl) studentsEl.innerText = students.length;
    if(attendanceEl) attendanceEl.innerText = Object.keys(attendanceIds).length;
    if(feesEl) feesEl.innerText = fees.length;
    if(financeEl) financeEl.innerText = finance.length;
    if(examsEl) examsEl.innerText = exams.length;
    if(groupsEl) groupsEl.innerText = groups.length;
}


/* =====================================================
   BACKUP
===================================================== */
async function exportData(){

    if(denyIfNotOwner(true, "Backup is restricted to the owner account.")) return;

    try{

        const [
            studentsResponse,
            attendanceResponse,
            feesResponse,
            examsResponse,
            resultsResponse,
            groupsResponse,
            financeResponse,
            eventsResponse
        ] = await Promise.all([

            supabaseClient
                .from("students")
                .select("*"),

            supabaseClient
                .from("attendance")
                .select("*"),

            supabaseClient
                .from("fees")
                .select("*"),

            supabaseClient
                .from("exams")
                .select("*"),

            supabaseClient
                .from("results")
                .select("*"),

            supabaseClient
                .from("groups")
                .select("*")
                .order("id", { ascending: true }),

            // Finance is owner-only - a non-owner session doesn't even
            // attempt this query (RLS should also block it once locked
            // down, but this stops it being requested at all right now).
            isOwner()
                ? supabaseClient.from("finance").select("*")
                : Promise.resolve({ data: [], error: null }),

            supabaseClient
                .from("events")
                .select("*")

        ]);


        if(studentsResponse.error)
            throw studentsResponse.error;

        if(attendanceResponse.error)
            throw attendanceResponse.error;

        if(feesResponse.error)
            throw feesResponse.error;

        if(examsResponse.error)
            throw examsResponse.error;

        if(resultsResponse.error)
            throw resultsResponse.error;

        if(groupsResponse.error)
            throw groupsResponse.error;

        if(financeResponse.error)
            throw financeResponse.error;

        if(eventsResponse.error)
            throw eventsResponse.error;


        let backup = {

            students:
                studentsResponse.data || [],

            attendance:
                attendanceResponse.data || [],

            fees:
                feesResponse.data || [],

            exams:
                examsResponse.data || [],

            results:
                resultsResponse.data || [],

            groups:
                groupsResponse.data || [],

            finance:
                financeResponse.data || [],

            events:
                eventsResponse.data || [],

            backupDate:
                new Date().toISOString()

        };


        let blob =
            new Blob(
                [
                    JSON.stringify(
                        backup,
                        null,
                        2
                    )
                ],
                {
                    type:
                        "application/json"
                }
            );


        let url =
            URL.createObjectURL(blob);


        let a =
            document.createElement("a");


        a.href = url;


        a.download =
            "rampur-free-tuition-backup-" +
            today() +
            ".json";


        a.click();


        URL.revokeObjectURL(url);


        alert(
            "Cloud backup downloaded successfully."
        );

    }

    catch(error){

        console.error(
            "BACKUP ERROR:",
            error
        );

        alert(
            "Could not create backup:\n" +
            error.message
        );

    }

}

/* =====================================================
   IMPORT BACKUP
===================================================== */

async function importData(){

    if(denyIfNotOwner(true, "Restore is restricted to the owner account.")) return;

    let file =
        document.getElementById(
            "importFile"
        ).files[0];

    if(!file){
        alert(
            "Please select a backup file first."
        );
        return;
    }

    let reader =
        new FileReader();

    reader.onload = async function(e){

        try{

            let data =
                JSON.parse(
                    e.target.result
                );

            // Backups made before Financial Management existed won't have a
            // "finance" array - treat that as simply no financial records
            // to restore, rather than rejecting the whole (otherwise valid)
            // backup file.
            if(data && !Array.isArray(data.finance)){
                data.finance = [];
            }

            // Backups made before Events & Notices existed won't have an
            // "events" array either - same treatment as finance above.
            if(data && !Array.isArray(data.events)){
                data.events = [];
            }

            if(
                !data ||
                !Array.isArray(data.students) ||
                !Array.isArray(data.attendance) ||
                !Array.isArray(data.fees) ||
                !Array.isArray(data.exams) ||
                !Array.isArray(data.results) ||
                !Array.isArray(data.groups) ||
                !Array.isArray(data.finance) ||
                !Array.isArray(data.events)
            ){

                alert(
                    "Invalid cloud backup file."
                );

                return;
            }


            let confirmed =
                confirm(
                    "⚠️ WARNING!\n\n" +
                    "This will DELETE your current cloud data and replace it with this backup.\n\n" +
                    "Students, attendance, fees, exams, results, groups and events/notices will be replaced" +
                    (isOwner() ? ", along with financial records." : ". (Financial records are owner-only and are not affected by your account.)") + "\n\n" +
                    "Are you absolutely sure?"
                );

            if(!confirmed)
                return;


            /* =========================
               DELETE OLD DATA
               ========================= */

            let response =
                await supabaseClient
                .from("results")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            response =
                await supabaseClient
                .from("attendance")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            response =
                await supabaseClient
                .from("fees")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            // Finance is owner-only - a non-owner session doesn't touch
            // it at all during restore (RLS should also block this once
            // locked down, but this stops it being attempted at all
            // right now).
            if(isOwner()){
                response =
                    await supabaseClient
                    .from("finance")
                    .delete()
                    .not("id", "is", null);

                if(response.error)
                    throw response.error;
            }


            response =
                await supabaseClient
                .from("exams")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            /* Delete old events/notices */
            response =
                await supabaseClient
                .from("events")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            response =
                await supabaseClient
                .from("students")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            /* Delete old groups */
            response =
                await supabaseClient
                .from("groups")
                .delete()
                .not("id", "is", null);

            if(response.error)
                throw response.error;


            /* =========================
               RESTORE GROUPS
               ========================= */

            if(data.groups.length > 0){

                let groupRows =
                    data.groups.map(group => {

                        /*
                         * If backup contains full
                         * Supabase group rows,
                         * keep only the name.
                         *
                         * New IDs will be generated
                         * automatically.
                         */

                        return {
                            name:
                                typeof group === "string"
                                    ? group
                                    : group.name
                        };

                    });

                response =
                    await supabaseClient
                    .from("groups")
                    .insert(
                        groupRows
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE STUDENTS
               ========================= */

            if(data.students.length > 0){

                response =
                    await supabaseClient
                    .from("students")
                    .insert(
                        data.students
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE EXAMS
               ========================= */

            if(data.exams.length > 0){

                response =
                    await supabaseClient
                    .from("exams")
                    .insert(
                        data.exams
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE ATTENDANCE
               ========================= */

            if(data.attendance.length > 0){

                response =
                    await supabaseClient
                    .from("attendance")
                    .insert(
                        data.attendance
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE FEES
               ========================= */

            if(data.fees.length > 0){

                response =
                    await supabaseClient
                    .from("fees")
                    .insert(
                        data.fees
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE RESULTS
               ========================= */

            if(data.results.length > 0){

                response =
                    await supabaseClient
                    .from("results")
                    .insert(
                        data.results
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE FINANCIAL RECORDS
               (owner-only - see the delete step above for why)
               ========================= */

            if(isOwner() && data.finance.length > 0){

                response =
                    await supabaseClient
                    .from("finance")
                    .insert(
                        data.finance
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RESTORE EVENTS & NOTICES
               ========================= */

            if(data.events.length > 0){

                response =
                    await supabaseClient
                    .from("events")
                    .insert(
                        data.events
                    );

                if(response.error)
                    throw response.error;
            }


            /* =========================
               RELOAD EVERYTHING

               (Previously called six/seven separate
               loadXFromSupabase() helpers here that were never
               actually defined anywhere in this file - every
               restore threw a ReferenceError at this point and
               reported "Restore failed" below, even though the
               delete+insert above had already succeeded on
               Supabase. Fixed by reusing the sync functions that
               do exist and already do this correctly: pull the
               fresh server data back into IndexedDB, reload it
               into memory, then re-render.)
               ========================= */

            selectedHistoryStudentId =
                null;

            await pullAllFromSupabase();
            await pullFinanceFromSupabase();
            await loadAllFromLocal();
            applyOwnerVisibility();
            renderAll();


            document.getElementById(
                "importFile"
            ).value = "";


            alert(
                "✅ Cloud backup restored successfully!"
            );

        }

        catch(error){

            console.error(
                "RESTORE ERROR:",
                error
            );

            alert(
                "❌ Restore failed.\n\n" +
                error.message +
                "\n\n" +
                "Check the browser console for details."
            );

        }

    };


    reader.readAsText(file);

}

/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHTML(value){

    return String(value ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");

}


/* =====================================================
   PHONE -> tel: LINK (safe)

   Renders the phone number as tappable text that opens the
   Android dialer. Two layers of safety: the visible text goes
   through escapeHTML like anywhere else user input is shown,
   and the tel: URI itself is built from a separately-sanitized
   copy that only ever contains digits/+/-/spaces/parentheses,
   so nothing in the field can break out of the href attribute
   or turn into some other URI scheme.
===================================================== */

function phoneLinkHTML(phone, fallbackText){

    let raw = String(phone ?? "").trim();

    if(!raw){
        return escapeHTML(fallbackText ?? "Not provided");
    }

    let safeTel = raw.replace(/[^\d+\-\s()]/g, "");

    if(!safeTel){
        return escapeHTML(raw);
    }

    return `<a href="tel:${escapeHTML(safeTel)}" class="phone-link">${escapeHTML(raw)}</a>`;

}


/* =====================================================
   EVENTS & NOTICES

   Same offline-first pattern as everything else: write to
   IndexedDB + in-memory immediately, queue the change, try to
   sync now if online (saveAll()). Nothing here talks to Supabase
   directly except through the existing generic outbox.

   Permissions: Owner can add/edit/delete; Teacher can view only.
   This mirrors Finance's denyIfNotOwner() guard on every write,
   but (unlike Finance) the section and its data stay visible to
   Teachers - only the write paths and the per-card ⋮ menu are
   gated. Supabase RLS on the "events" table should also restrict
   insert/update/delete to the owner role, the same way it does
   for "finance" - this client-side check is a UI convenience, not
   the real security boundary.
===================================================== */

const EVENT_TYPE_ICONS = {
    "Event": "📅",
    "Notice": "📢",
    "Exam": "📝",
    "Holiday": "🏖️",
    "Meeting": "🤝",
    "Class": "📚",
    "Result": "🏆",
    "Important": "❗",
    "Other": "🔔"
};

const EVENT_PRIORITY_ICONS = {
    "Urgent": "🔴",
    "Important": "🟠",
    "Normal": "⚪"
};

function eventTypeIcon(type){
    return EVENT_TYPE_ICONS[type] || "🔔";
}

function eventPriorityIcon(priority){
    return EVENT_PRIORITY_ICONS[priority] || "⚪";
}

function formatEventDate(dateStr){
    if(!dateStr) return "";
    try{
        return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "numeric"
        });
    } catch(e){
        return dateStr;
    }
}

/* =========================
   ADD / EDIT (one form, same pattern as the rest of the app)
========================= */

function resetEventForm(){
    editingEventId = null;

    document.getElementById("eventTitle").value = "";
    document.getElementById("eventDate").value = "";
    document.getElementById("eventTime").value = "";
    document.getElementById("eventLocation").value = "";
    document.getElementById("eventDescription").value = "";
    document.getElementById("eventTargetGroup").value = "";
    document.getElementById("eventType").value = "Event";
    document.getElementById("eventPriority").value = "Normal";

    const saveBtn = document.getElementById("eventSaveButton");
    if(saveBtn) saveBtn.innerText = "+ Add Event / Notice";
}

function editEvent(id){
    if(denyIfNotOwner(true, "Only the owner can edit events.")) return;

    let ev = events.find(e => e.id === id);
    if(!ev){
        alert("Event/notice not found.");
        return;
    }

    editingEventId = id;

    document.getElementById("eventTitle").value = ev.title || "";
    document.getElementById("eventDate").value = ev.date || "";
    document.getElementById("eventTime").value = ev.time || "";
    document.getElementById("eventLocation").value = ev.location || "";
    document.getElementById("eventDescription").value = ev.description || "";
    document.getElementById("eventTargetGroup").value = ev.targetGroup || "";
    document.getElementById("eventType").value = ev.type || "Event";
    document.getElementById("eventPriority").value = ev.priority || "Normal";

    const saveBtn = document.getElementById("eventSaveButton");
    if(saveBtn) saveBtn.innerText = "💾 Update Event / Notice";

    document.getElementById("eventTitle").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveEvent(){
    if(denyIfNotOwner(true, "Only the owner can add or edit events.")) return;

    let title = document.getElementById("eventTitle").value.trim();
    let date = document.getElementById("eventDate").value;
    let type = document.getElementById("eventType").value;

    if(!title){
        alert("Please enter a title.");
        return;
    }
    if(!date){
        alert("Please select a date.");
        return;
    }
    if(!type){
        alert("Please select a type.");
        return;
    }

    let time = document.getElementById("eventTime").value.trim();
    let location = document.getElementById("eventLocation").value.trim();
    let description = document.getElementById("eventDescription").value.trim();
    let targetGroup = document.getElementById("eventTargetGroup").value;
    let priority = document.getElementById("eventPriority").value;

    let isEdit = !!editingEventId;
    let ev;

    if(isEdit){
        ev = events.find(e => e.id === editingEventId);
        if(!ev){
            alert("Event/notice not found.");
            return;
        }
    } else {
        ev = {
            id: RFT.newId(),
            createdBy: currentUserId || "",
            createdAt: new Date().toISOString()
        };
        events.push(ev);
    }

    ev.title = title;
    ev.date = date;
    ev.type = type;
    ev.time = time;
    ev.location = location;
    ev.description = description;
    ev.targetGroup = targetGroup;
    ev.priority = priority;

    const row = eventToRow(ev);

    // Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("events", row);
    await RFT.enqueue("events", "upsert", row);
    saveAll();

    resetEventForm();
    renderEvents();

    alert(isEdit ? "✅ Event/notice updated successfully." : "✅ Event/notice added successfully.");
}

async function deleteEvent(id){
    if(denyIfNotOwner(true, "Only the owner can delete events.")) return;

    let ev = events.find(e => e.id === id);
    if(!ev){
        alert("Event/notice not found.");
        return;
    }

    if(!confirm("Delete \"" + ev.title + "\"?\n\nThis cannot be undone.")){
        return;
    }

    await RFT.remove("events", id);
    await RFT.enqueue("events", "delete", { id });

    events = events.filter(e => e.id !== id);

    if(editingEventId === id){
        resetEventForm();
    }

    saveAll();
    renderEvents();

    alert("Event/notice deleted.");
}

function selectEventsView(view){
    eventsView = view;
    renderEvents();
}

/* =========================
   MENU (same viewport-aware pattern as student/fee/group/exam menus)
========================= */

function toggleEventMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".event-menu-dropdown"
        );

    let willOpen = !menu.classList.contains("show");

    document
        .querySelectorAll(
            ".event-menu-dropdown"
        )
        .forEach(otherMenu => {

            if(otherMenu !== menu){
                otherMenu.classList.remove(
                    "show"
                );
            }

        });

    if(willOpen) positionFloatingMenu(button, menu);
    menu.classList.toggle("show");

}

document.addEventListener("click", function(event){
    if(!event.target.closest(".event-menu")){
        document.querySelectorAll(".event-menu-dropdown.show")
            .forEach(menu => menu.classList.remove("show"));
    }
});

/* =========================
   TARGET GROUP DROPDOWN
========================= */

function renderEventTargetGroupSelect(){
    let select = document.getElementById("eventTargetGroup");
    if(!select) return;

    let previousValue = select.value;

    select.innerHTML = `<option value="">All Students</option>` +
        groups.map(g => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join("");

    if(previousValue && (previousValue === "" || groups.includes(previousValue))){
        select.value = previousValue;
    }
}

/* =========================
   RENDER
========================= */

function renderEvents(){
    let container = document.getElementById("eventsList");
    if(!container) return;

    renderEventTargetGroupSelect();

    let upcomingBtn = document.getElementById("eventsUpcomingBtn");
    let pastBtn = document.getElementById("eventsPastBtn");
    if(upcomingBtn) upcomingBtn.className = "btn " + (eventsView === "upcoming" ? "active" : "");
    if(pastBtn) pastBtn.className = "btn " + (eventsView === "past" ? "active" : "");

    let search =
        (document.getElementById("eventsSearch")?.value || "")
        .trim()
        .toLowerCase();

    let categoryFilter = document.getElementById("eventsCategoryFilter")?.value || "";

    let todayStr = today();

    let list = events.filter(ev => {
        if(eventsView === "upcoming" && ev.date < todayStr) return false;
        if(eventsView === "past" && ev.date >= todayStr) return false;

        if(categoryFilter && ev.type !== categoryFilter) return false;

        if(search){
            let haystack = (ev.title + " " + (ev.description || "") + " " + (ev.location || "")).toLowerCase();
            if(!haystack.includes(search)) return false;
        }

        return true;
    });

    list.sort((a, b) => {
        return eventsView === "past"
            ? String(b.date).localeCompare(String(a.date)) // most recent past first
            : String(a.date).localeCompare(String(b.date)); // soonest upcoming first
    });

    if(list.length === 0){
        container.innerHTML = `<div class="empty">${search || categoryFilter ? "No matching events/notices found." : (eventsView === "upcoming" ? "No upcoming events or notices." : "No past events or notices.")}</div>`;
        return;
    }

    let owner = isOwner();

    container.innerHTML = list.map(ev => {
        let metaParts = [`<span>${escapeHTML(ev.type)}</span>`, `<span>📅 ${escapeHTML(formatEventDate(ev.date))}</span>`];
        if(ev.time) metaParts.push(`<span>🕐 ${escapeHTML(ev.time)}</span>`);
        if(ev.location) metaParts.push(`<span>📍 ${escapeHTML(ev.location)}</span>`);
        metaParts.push(`<span>${escapeHTML(ev.targetGroup ? "Group " + ev.targetGroup : "All Students")}</span>`);

        return `
<div class="event-card event-priority-${escapeHTML((ev.priority || "Normal").toLowerCase())}">

<div class="event-card-top">

<span class="event-type-icon">${eventTypeIcon(ev.type)}</span>

<strong class="student-list-name">${eventPriorityIcon(ev.priority)} ${escapeHTML(ev.title)}</strong>

${owner ? `
<div class="event-menu">
<button class="event-menu-button" onclick="toggleEventMenu(this)">⋮</button>
<div class="event-menu-dropdown">
<button onclick="editEvent('${ev.id}')">✏️<span>Edit</span></button>
<button class="delete-option" onclick="deleteEvent('${ev.id}')">🗑️<span>Delete</span></button>
</div>
</div>
` : ""}

</div>

<div class="recent-student-meta">${metaParts.join("")}</div>

${ev.description ? `<div class="recent-student-contact">${escapeHTML(ev.description)}</div>` : ""}

<div class="event-footer">Added by Owner</div>

</div>
`;
    }).join("");
}


/* =====================================================
   RENDER EVERYTHING
===================================================== */

function renderAll(){

    /*
       Make sure groups are valid.
    */

    if(groups.length === 0){

        groups = ["A"];

    }


    if(!groups.includes(studentGroup))
        studentGroup = groups[0];

    if(!groups.includes(attendanceGroup))
        attendanceGroup = groups[0];

    if(!groups.includes(resultGroup))
        resultGroup = groups[0];


    renderGroupSelects();

    renderGroupButtons();

    renderManageGroups();

    renderStudents();

    renderAttendance();

    renderMonthlyAttendance();

    renderFinanceCategoryFilterOptions();

    renderFinance();

    renderFinanceSummary();

    renderExamSelect();

    renderResults();

    renderStudentHistory();

    renderEvents();

    renderDashboard();

    renderBackupSummary();

    

}


/* =====================================================
   DEFAULT DATES
===================================================== */

document.getElementById(
    "attendanceDate"
).value =
    today();


document.getElementById(
    "attendanceMonth"
).value =
    new Date()
    .toISOString()
    .slice(0,7);


document.getElementById(
    "financeDate"
).value =
    today();

// One-time initial population of the Add Financial Record category
// dropdown (defaults to Income). Deliberately NOT part of renderAll() -
// renderAll() runs on every background sync, and re-populating this here
// would reset whatever the teacher is mid-typing in that form, the same
// way the rest of the app's add-forms are left alone by renderAll().
onFinanceTypeChange();


/* =====================================================
   START APP
===================================================== */

// startApp() removed - initApp() (see top of file) is now the single startup path.

function toggleExamMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".exam-menu-dropdown"
        );

    let willOpen = !menu.classList.contains("show");

    document
        .querySelectorAll(
            ".exam-menu-dropdown"
        )
        .forEach(otherMenu => {

            if(otherMenu !== menu){
                otherMenu.classList.remove(
                    "show"
                );
            }

        });

    if(willOpen) positionFloatingMenu(button, menu);
    menu.classList.toggle("show");

}
function editSelectedExam(){

    let select = document.getElementById("examSelect");
    let examId = select.value;

    if(!examId){
        alert("Please select an exam first.");
        return;
    }

    let exam = exams.find(e => e.id === examId);
    if(!exam){
        alert("Exam not found.");
        return;
    }

    let newName = prompt("Enter new exam name:", exam.name);
    if(newName === null) return;
    newName = newName.trim();
    if(!newName){
        alert("Exam name cannot be empty.");
        return;
    }

    let newDate = prompt("Enter exam date (YYYY-MM-DD):", exam.date || "");
    if(newDate === null) return;
    newDate = newDate.trim();
    if(!newDate){
        alert("Exam date cannot be empty.");
        return;
    }

    editExamLocal(examId, newName, newDate);
}

async function editExamLocal(examId, newName, newDate){

    let exam = exams.find(e => e.id === examId);
    if(!exam) return;

    exam.name = newName;
    exam.date = newDate;

    const row = examToRow(exam);
    await RFT.put("exams", row);
    await RFT.enqueue("exams", "upsert", row);
    saveAll();

    renderExamSelect();
    renderResults();

    alert("✅ Exam updated successfully.");

}

function deleteSelectedExam(){

    let select = document.getElementById("examSelect");
    let examId = select.value;

    if(!examId){
        alert("Please select an exam first.");
        return;
    }

    deleteExamById(examId);

}

async function deleteExamById(id){

    if(denyIfNotOwner(true, "Only the owner can delete exams.")) return;

    let exam = exams.find(e => e.id === id);

    if(!exam){
        alert("Exam not found.");
        return;
    }

    let confirmed = confirm(
        "⚠️ Delete this exam?\n\n" +
        "Exam: " + exam.name + "\n\n" +
        "All student marks/results for this exam will also be permanently deleted.\n\n" +
        "This action cannot be undone.\n\n" +
        "Are you sure?"
    );

    if(!confirmed) return;

    // 1. Remove locally (IndexedDB + memory) immediately - works offline.
    await RFT.remove("exams", id);

    const resultRows = (await RFT.getAll("results")).filter(r => r.exam_id === id);
    for (const row of resultRows) await RFT.remove("results", row.id);
    await purgeOutboxFor("results", r => r.exam_id === id);

    exams = exams.filter(exam => exam.id !== id);
    delete results[id];

    // 2. Queue the exam deletion for Supabase. Matching results rows that
    //    already made it to the server are removed via ON DELETE CASCADE.
    await RFT.enqueue("exams", "delete", { id });
    saveAll();

    renderExamSelect();
    renderResults();

    alert("✅ Exam and all its results were deleted successfully.");

}
document.addEventListener(
    "click",
    function(event){

        if(
            !event.target.closest(
                ".exam-menu"
            )
        ){

            document
                .querySelectorAll(
                    ".exam-menu-dropdown"
                )
                .forEach(menu => {

                    menu.classList.remove(
                        "show"
                    );

                });

        }

    }
);
function toggleStudentMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".student-menu-dropdown"
        );

    let willOpen = !menu.classList.contains("show");

    document
        .querySelectorAll(
            ".student-menu-dropdown"
        )
        .forEach(otherMenu => {

            if(otherMenu !== menu){
                otherMenu.classList.remove(
                    "show"
                );
            }

        });

    if(willOpen) positionFloatingMenu(button, menu);
    menu.classList.toggle("show");

}
document.addEventListener(
    "click",
    function(event){

        if(
            !event.target.closest(
                ".student-menu"
            )
        ){

            document
                .querySelectorAll(
                    ".student-menu-dropdown"
                )
                .forEach(menu => {

                    menu.classList.remove(
                        "show"
                    );

                });

        }

    }
);
window.addEventListener("load", function(){

    setTimeout(function(){

        const splash =
            document.getElementById("appSplash");

        if(splash){
            splash.remove();
        }

    }, 2100);

});
// (offline database v1 removed - offline-core.js + initApp()/syncNow() at the top of this file now own this)

/* =====================================================
   TEMPORARY (live verification of Stage 7D only) - ABSENCE ALERTS UI TEST TOOLS

   Owner-only controls that call the temporary "absence-alert-ui-test" Edge
   Function to create/resolve/delete ONE synthetic absence_alerts row at a
   time against a real existing student, so the screen above can be checked
   against real data. Never calls "absence-alert-notify" and never sends a
   push. Only ids this page itself created (tracked in memory only, never
   persisted) can be resolved/deleted from here.
   Remove this whole block, the panel in index.html, and the one line in
   applyOwnerVisibility() once Stage 7D has been verified live.
===================================================== */

let absenceUITestAlerts = [];      // [{ id, student_id }] - this session only
let absenceUITestInFlight = false;

const ABSENCE_UI_TEST_MESSAGES = {
    no_available_student: "Every existing student already has an open alert - nothing available to test with.",
    invalid_request: "Invalid request.",
    not_found: "That test alert no longer exists.",
    not_a_test_alert: "Refused: that id is not a synthetic test alert.",
    not_resolved_no_match: "Could not resolve it (already changed?).",
    not_deleted_no_match: "Could not delete it (already deleted?).",
    unauthenticated: "Please log in again.",
    owner_required: "Owner access required.",
    server_not_configured: "Server is not configured for this tool.",
    database_error: "A database error occurred on the server.",
    unknown_action: "Unexpected request."
};

async function absenceUITestInvoke(action, id) {
    const { data, error } = await supabaseClient.functions.invoke("absence-alert-ui-test", {
        body: id ? { action, id } : { action }
    });
    if (!error) return data;
    let body = null;
    try {
        if (error.context && typeof error.context.json === "function") body = await error.context.json();
    } catch (_) { /* unreadable body - fall through to generic message */ }
    return body || { ok: false, result: null };
}

function absenceUITestMessage(body) {
    const r = body && body.result;
    return (r && ABSENCE_UI_TEST_MESSAGES[r]) || "Request failed.";
}

function setAbsenceUITestStatus(text) {
    const el = document.getElementById("absenceUITestStatus");
    if (el) el.textContent = text;
}

function renderAbsenceUITestList() {
    const el = document.getElementById("absenceUITestList");
    if (!el) return;
    if (!absenceUITestAlerts.length) { el.innerHTML = ""; return; }
    el.innerHTML = absenceUITestAlerts.map(a =>
        '<p class="small">Test alert ' + escapeHTML(String(a.id).slice(0, 8)) + '… (student ' + escapeHTML(String(a.student_id).slice(0, 8)) + '…) ' +
        '<button class="btn" onclick="resolveAbsenceUITestAlert(\'' + escapeHTML(a.id) + '\')">↻ Mark Resolved (history test)</button> ' +
        '<button class="btn" onclick="deleteAbsenceUITestAlert(\'' + escapeHTML(a.id) + '\')">🧹 Delete</button></p>'
    ).join("");
}

function setAbsenceUITestButtonsDisabled(disabled) {
    ["absenceUITestCreateButton", "absenceUITestVerifyButton"].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = disabled;
    });
}

async function createAbsenceUITestAlert() {
    if (!isOwner()) return;
    if (absenceUITestInFlight) return;
    if (!navigator.onLine) { setAbsenceUITestStatus("Offline - cannot create a test alert."); return; }

    absenceUITestInFlight = true;
    setAbsenceUITestButtonsDisabled(true);
    setAbsenceUITestStatus("Creating test alert...");

    try {
        const body = await absenceUITestInvoke("create");
        if (body && body.ok) {
            absenceUITestAlerts.push({ id: body.id, student_id: body.student_id });
            setAbsenceUITestStatus("✅ Test alert created for an existing student.");
            renderAbsenceUITestList();
            await loadAbsenceAlerts();
        } else {
            setAbsenceUITestStatus("❌ " + absenceUITestMessage(body));
        }
    } catch (err) {
        console.warn("Create UI test alert failed:", err);
        setAbsenceUITestStatus("❌ Could not reach the server.");
    } finally {
        absenceUITestInFlight = false;
        setAbsenceUITestButtonsDisabled(false);
    }
}

async function resolveAbsenceUITestAlert(id) {
    if (!isOwner()) return;
    if (absenceUITestInFlight) return;
    if (!navigator.onLine) { setAbsenceUITestStatus("Offline - cannot resolve the test alert."); return; }

    absenceUITestInFlight = true;
    setAbsenceUITestButtonsDisabled(true);
    setAbsenceUITestStatus("Marking test alert resolved...");

    try {
        const body = await absenceUITestInvoke("resolve", id);
        if (body && body.ok) {
            setAbsenceUITestStatus("✅ Test alert marked resolved - check \"Show Resolved History\".");
            await loadAbsenceAlerts();
        } else {
            setAbsenceUITestStatus("❌ " + absenceUITestMessage(body));
        }
    } catch (err) {
        console.warn("Resolve UI test alert failed:", err);
        setAbsenceUITestStatus("❌ Could not reach the server.");
    } finally {
        absenceUITestInFlight = false;
        setAbsenceUITestButtonsDisabled(false);
    }
}

async function deleteAbsenceUITestAlert(id) {
    if (!isOwner()) return;
    if (absenceUITestInFlight) return;
    if (!navigator.onLine) { setAbsenceUITestStatus("Offline - cannot delete the test alert."); return; }

    absenceUITestInFlight = true;
    setAbsenceUITestButtonsDisabled(true);
    setAbsenceUITestStatus("Deleting test alert...");

    try {
        const body = await absenceUITestInvoke("delete", id);
        if (body && body.ok) {
            absenceUITestAlerts = absenceUITestAlerts.filter(a => a.id !== id);
            setAbsenceUITestStatus("✅ Test alert deleted.");
            renderAbsenceUITestList();
            await loadAbsenceAlerts();
        } else {
            setAbsenceUITestStatus("❌ " + absenceUITestMessage(body));
        }
    } catch (err) {
        console.warn("Delete UI test alert failed:", err);
        setAbsenceUITestStatus("❌ Could not reach the server.");
    } finally {
        absenceUITestInFlight = false;
        setAbsenceUITestButtonsDisabled(false);
    }
}

async function deleteAllAbsenceUITestAlerts() {
    if (!isOwner()) return;
    for (const a of absenceUITestAlerts.slice()) {
        await deleteAbsenceUITestAlert(a.id);
    }
}

async function verifyAbsenceUITestClean() {
    if (!isOwner()) return;
    if (absenceUITestInFlight) return;
    if (!navigator.onLine) { setAbsenceUITestStatus("Offline - cannot verify."); return; }

    absenceUITestInFlight = true;
    setAbsenceUITestButtonsDisabled(true);
    setAbsenceUITestStatus("Checking for leftover test alerts...");

    try {
        const body = await absenceUITestInvoke("verify_clean");
        if (body && body.ok) {
            setAbsenceUITestStatus(body.remaining === 0
                ? "✅ Clean - zero synthetic test alerts remain in the database."
                : "⚠ " + body.remaining + " synthetic test alert(s) still exist in the database.");
        } else {
            setAbsenceUITestStatus("❌ " + absenceUITestMessage(body));
        }
    } catch (err) {
        console.warn("Verify clean failed:", err);
        setAbsenceUITestStatus("❌ Could not reach the server.");
    } finally {
        absenceUITestInFlight = false;
        setAbsenceUITestButtonsDisabled(false);
    }
}


/* =====================================================
   STAGE 7D - ABSENCE ALERTS UI (Attendance section)

   Reads/updates the existing "absence_alerts" table only. Does not
   create alerts, does not call the notification engine or sender, and
   never touches notification_logs / notification_settings / attendance.
   RLS (Owner/Teacher SELECT+UPDATE, set up in Stage 2) is the real
   security boundary; nothing here assumes otherwise.
===================================================== */

let absenceAlerts = [];
let absenceAlertsLoading = false;
let absenceAlertsLoadError = null;
let absenceAlertsFilter = "open";           // 'open' | 'pending' | 'not_informed' | 'resolved'
let absenceAlertsHistoryVisible = false;
const absenceAlertResponseInFlight = new Set();

function absenceAlertStatusLabel(status) {
    if (status === "pending") return "Pending";
    if (status === "informed") return "Informed";
    if (status === "not_informed") return "Not Informed";
    if (status === "resolved") return "Resolved";
    return status ? String(status) : "Unknown";
}

/* `studentList` is injected (defaults to the app's global `students`)
   so this stays a pure, independently testable function. */
function lookupStudentName(studentId, studentList) {
    const list = studentList || (typeof students !== "undefined" ? students : []);
    const s = Array.isArray(list) ? list.find(x => x && x.id === studentId) : null;
    return (s && s.name) ? s.name : "Unknown student";
}

function filterAbsenceAlerts(alerts, filter) {
    const list = Array.isArray(alerts) ? alerts : [];
    if (filter === "pending") return list.filter(a => a && a.status === "pending");
    if (filter === "not_informed") return list.filter(a => a && a.status === "not_informed");
    if (filter === "resolved") return list.filter(a => a && a.status === "resolved");
    // 'open' = not yet resolved (matches the engine/sender's OPEN_STATUSES),
    // so an already-informed alert stays visible instead of vanishing until
    // the engine eventually resolves it.
    return list.filter(a => a && (a.status === "pending" || a.status === "informed" || a.status === "not_informed"));
}

function absenceAlertConfirmedLine(alert) {
    if (!alert.confirmed_by || !alert.confirmed_at) return "";
    const who = String(alert.confirmed_by).slice(0, 8) + "…";
    let when = alert.confirmed_at;
    try { when = formatEventDate(String(alert.confirmed_at).slice(0, 10)) + " " + new Date(alert.confirmed_at).toLocaleTimeString(); }
    catch (_) { /* keep raw value */ }
    return '<p class="small">Confirmed by: ' + escapeHTML(who) + '<br>Confirmed at: ' + escapeHTML(when) + "</p>";
}

/* Builds one alert card's HTML. `isHistory` suppresses the response
   buttons even for a (should-never-happen) open-status row rendered
   into the resolved-history list. */
function buildAbsenceAlertCardHTML(alert, studentName, isHistory) {
    const count = Number.isFinite(Number(alert.absent_count)) ? Number(alert.absent_count) : 0;
    const started = formatEventDate(alert.absence_start_date);
    const last = formatEventDate(alert.last_absent_date);
    const statusLabel = absenceAlertStatusLabel(alert.status);
    const isOpen = !isHistory && (alert.status === "pending" || alert.status === "not_informed");

    const followUpNote = alert.status === "not_informed"
        ? '<p class="small">Remains eligible for future follow-up.</p>' : "";

    const actions = isOpen
        ? '<button class="btn" onclick="respondToAbsenceAlert(\'' + escapeHTML(alert.id) + '\',\'informed\')">✅ Informed</button> ' +
          '<button class="btn" onclick="respondToAbsenceAlert(\'' + escapeHTML(alert.id) + '\',\'not_informed\')">❌ Not Informed</button>'
        : "";

    return '' +
        '<div class="panel absence-alert-card" data-alert-id="' + escapeHTML(alert.id) + '" data-status="' + escapeHTML(alert.status) + '">' +
            "<h4>⚠️ " + escapeHTML(studentName) + "</h4>" +
            "<p>" + count + " consecutive absences</p>" +
            '<p class="small">Started: ' + escapeHTML(started) + "<br>Last absent: " + escapeHTML(last) + "</p>" +
            '<p class="small">Status: ' + escapeHTML(statusLabel) + "</p>" +
            absenceAlertConfirmedLine(alert) +
            followUpNote +
            actions +
        "</div>";
}

async function loadAbsenceAlerts() {
    if (absenceAlertsLoading) return;
    absenceAlertsLoading = true;
    absenceAlertsLoadError = null;
    renderAbsenceAlerts();

    try {
        const { data, error } = await supabaseClient
            .from("absence_alerts")
            .select("id,student_id,absence_start_date,last_absent_date,absent_count,status,notification_count,last_notified_at,confirmed_by,confirmed_at,created_at,updated_at")
            .order("updated_at", { ascending: false });
        if (error) throw error;
        absenceAlerts = Array.isArray(data) ? data : [];
    } catch (err) {
        console.warn("Could not load absence alerts:", err);
        absenceAlertsLoadError = navigator.onLine
            ? "Could not load absence alerts."
            : "Offline — showing the last loaded absence alerts, if any.";
    } finally {
        absenceAlertsLoading = false;
        renderAbsenceAlerts();
    }
}

function setAbsenceAlertsFilter(filter) {
    absenceAlertsFilter = filter;
    renderAbsenceAlerts();
}

function toggleAbsenceAlertsHistory() {
    absenceAlertsHistoryVisible = !absenceAlertsHistoryVisible;
    renderAbsenceAlerts();
}

function renderAbsenceAlerts() {
    const listEl = document.getElementById("absenceAlertsList");
    if (!listEl) return;   // Attendance section not in this page build - defensive no-op

    if (absenceAlertsLoading) {
        listEl.innerHTML = '<p class="small">Loading absence alerts…</p>';
    } else if (absenceAlertsLoadError && absenceAlerts.length === 0) {
        listEl.innerHTML = "<p class=\"small\">" + escapeHTML(absenceAlertsLoadError) + "</p>";
    } else {
        const shown = filterAbsenceAlerts(absenceAlerts, absenceAlertsFilter);
        listEl.innerHTML = shown.length
            ? shown.map(a => buildAbsenceAlertCardHTML(a, lookupStudentName(a.student_id))).join("")
            : '<p class="small">No active absence alerts.</p>';
    }

    const filterButtons = {
        open: document.getElementById("absenceAlertsFilterOpen"),
        pending: document.getElementById("absenceAlertsFilterPending"),
        not_informed: document.getElementById("absenceAlertsFilterNotInformed")
    };
    Object.keys(filterButtons).forEach(key => {
        const btn = filterButtons[key];
        if (btn) btn.classList.toggle("active", absenceAlertsFilter === key);
    });

    const historyPanel = document.getElementById("absenceAlertsHistoryPanel");
    const historyToggle = document.getElementById("absenceAlertsHistoryToggle");
    if (historyToggle) historyToggle.textContent = absenceAlertsHistoryVisible ? "Hide Resolved History" : "Show Resolved History";
    if (historyPanel) {
        historyPanel.style.display = absenceAlertsHistoryVisible ? "" : "none";
        if (absenceAlertsHistoryVisible) {
            const historyList = document.getElementById("absenceAlertsHistoryList");
            if (historyList) {
                const resolved = filterAbsenceAlerts(absenceAlerts, "resolved");
                historyList.innerHTML = resolved.length
                    ? resolved.map(a => buildAbsenceAlertCardHTML(a, lookupStudentName(a.student_id), true)).join("")
                    : '<p class="small">No resolved absence episodes yet.</p>';
            }
        }
    }

    // Responding needs connectivity (no parallel offline sync queue for this table -
    // see Stage 7D notes); viewing already-loaded alerts still works offline.
    if (!navigator.onLine) {
        listEl.querySelectorAll("button").forEach(b => {
            b.disabled = true;
            b.title = "Requires internet connection to respond.";
        });
    }
}

/* Only ever sets 'informed' or 'not_informed' - never 'resolved' (that
   belongs solely to the Stage 7B engine) and never touches absent_count /
   notification_count / last_notified_at. The update itself is the atomic
   safety net: .eq("id", alertId).in("status", OPEN) only succeeds if the
   row is still open, so two concurrent responses can't silently overwrite
   one another - whichever commits second sees 0 rows changed. */
async function respondToAbsenceAlert(alertId, newStatus) {
    if (newStatus !== "informed" && newStatus !== "not_informed") return;
    if (!currentUserId) { alert("Please log in first."); return; }
    if (!navigator.onLine) { alert("Requires internet connection to respond."); return; }
    if (absenceAlertResponseInFlight.has(alertId)) return;
    absenceAlertResponseInFlight.add(alertId);

    try {
        const { data: current, error: readErr } = await supabaseClient
            .from("absence_alerts").select("id,status").eq("id", alertId).maybeSingle();

        if (readErr) { alert("Could not check this alert's current status. Please try again."); return; }
        if (!current) { alert("This alert no longer exists."); await loadAbsenceAlerts(); return; }
        if (current.status !== "pending" && current.status !== "not_informed") {
            alert("This alert has already changed (now: " + absenceAlertStatusLabel(current.status) + "). Showing the latest state.");
            await loadAbsenceAlerts();
            return;
        }

        const nowIso = new Date().toISOString();
        const { data: updated, error: updErr } = await supabaseClient
            .from("absence_alerts")
            .update({ status: newStatus, confirmed_by: currentUserId, confirmed_at: nowIso })
            .eq("id", alertId)
            .in("status", ["pending", "not_informed"])
            .select("id");

        if (updErr) { alert("Could not save your response. Please try again."); return; }
        if (!updated || updated.length === 0) {
            alert("Someone else already responded to this alert. Showing the latest state.");
        }
        await loadAbsenceAlerts();
    } catch (err) {
        console.warn("Absence alert response failed:", err);
        alert("Could not save your response. Please try again.");
    } finally {
        absenceAlertResponseInFlight.delete(alertId);
    }
}

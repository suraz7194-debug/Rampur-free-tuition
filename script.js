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
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;

            localStorage.setItem("adminLoggedIn", "true");
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
        if (message) message.innerText = "";
        document.getElementById("loginScreen").style.display = "none";
        await initApp();
    } else {
        if (message) message.innerText = "No internet connection. Please connect once to log in for the first time.";
    }
}

function adminLogout() {
    localStorage.removeItem("adminLoggedIn");
    if (navigator.onLine && supabaseClient.auth) {
        supabaseClient.auth.signOut();
    }

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
   CHECK ADMIN SESSION

   Runs immediately on script load. Always loads app data
   after confirming the session - this fixes the old bug
   where a returning (already logged-in) teacher saw a blank
   app because nothing ever loaded their data.
===================================================== */

async function checkAdminSession() {
    const isLoggedInLocally = localStorage.getItem("adminLoggedIn") === "true";

    if (isLoggedInLocally) {
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
let exams = [];
let results = {};        // { examId: { studentId: {id, english, nepali, math, science, total} } }
let groups = [];
let groupIds = {};       // name -> id
let attendance = {};     // { date: { studentId: status } }
let attendanceIds = {};  // { "date|studentId": id } - lets us upsert instead of duplicate-insert

let studentGroup = "A";
let attendanceGroup = "A";
let resultGroup = "A";

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
        photo: s.photo || ""
    };
    if (s.createdAt) row.created_at = s.createdAt;
    return row;
}

function feeFromRow(row) {
    return { id: row.id, studentId: row.student_id, month: row.month, amount: Number(row.amount), paidDate: row.date };
}
function feeToRow(f) {
    return { id: f.id, student_id: f.studentId, month: f.month, amount: Number(f.amount), date: f.paidDate };
}

function examFromRow(row) {
    return { id: row.id, name: row.exam_name, date: row.date, createdAt: row.created_at || null };
}
function examToRow(e) {
    const row = { id: e.id, exam_name: e.name, date: e.date };
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
            total: Number(row.total || 0)
        };
    });
}

function rebuildGroupsCache(rows) {
    let sorted = rows.slice().sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    groupIds = {};
    groups = sorted.map(row => String(row.name).trim()).filter(Boolean);
    sorted.forEach(row => { groupIds[String(row.name).trim()] = row.id; });

    if (groups.length === 0) {
        groups = ["A"];
    }

    studentGroup = groups.includes(studentGroup) ? studentGroup : groups[0];
    attendanceGroup = groups.includes(attendanceGroup) ? attendanceGroup : groups[0];
    resultGroup = groups.includes(resultGroup) ? resultGroup : groups[0];
}

/* =====================================================
   LOAD ALL DATA FROM LOCAL INDEXEDDB
   Always works, online or offline, and is fast because it
   never waits on the network.
===================================================== */

async function loadAllFromLocal() {
    const [studentRows, feeRows, examRows, groupRows, attendanceRows, resultRows] = await Promise.all([
        RFT.getAll("students"),
        RFT.getAll("fees"),
        RFT.getAll("exams"),
        RFT.getAll("groups"),
        RFT.getAll("attendance"),
        RFT.getAll("results")
    ]);

    students = studentRows.map(studentFromRow)
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    fees = feeRows.map(feeFromRow)
        .sort((a, b) => String(a.paidDate || "").localeCompare(String(b.paidDate || "")));

    exams = examRows.map(examFromRow)
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    rebuildGroupsCache(groupRows);
    rebuildAttendanceCache(attendanceRows);
    rebuildResultsCache(resultRows);
}

/* =====================================================
   PULL FRESH DATA FROM SUPABASE INTO INDEXEDDB
   (download direction of sync - this is how one teacher's
   device sees another teacher's changes)
===================================================== */

async function pullAllFromSupabase() {
    for (const table of RFT.TABLES) {
        const { data, error } = await supabaseClient.from(table).select("*");
        if (error) {
            console.error(`Could not pull ${table} from Supabase:`, error);
            continue; // keep whatever is already cached locally for this table
        }
        await RFT.clearStore(table);
        await RFT.putMany(table, data || []);
    }
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
    renderAll();

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

async function syncNow() {
    if (!navigator.onLine) return;
    updateSyncBadge("Syncing...");
    try {
        await RFT.processOutbox(supabaseClient);
        await pullAllFromSupabase();
        await loadAllFromLocal();
        renderAll();
    } catch (err) {
        console.error("Sync failed:", err);
    }
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
function toggleGroupMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".group-menu-dropdown"
        );

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

    const groupRow = { id: groupId, name: newName };
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
src="${student.photo}"
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

<tr>

<td colspan="6"
class="empty">

No students found.

</td>

</tr>

`;

        return;

    }

    list.forEach(s=>{

        table.innerHTML += `

<tr>

<td>

${studentPhotoHTML(s)}

<b>${escapeHTML(s.name)}</b>

</td>

<td>${escapeHTML(s.className)}</td>

<td>${escapeHTML(s.roll)}</td>

<td>${escapeHTML(s.parent || "")}</td>

<td>${escapeHTML(s.phone || "")}</td>

<td>

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

<button
class="delete-option"
onclick="deleteStudent('${s.id}')">
🗑️
<span>Delete Student</span>
</button>

</div>

</div>

</td>

</tr>

`;

    });

}

/* =====================================================
   DELETE STUDENT
===================================================== */
async function deleteStudent(id){

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

    const row = { id, student_id: studentId, date, status: newStatus };

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
   FEES
===================================================== */

function renderFeeStudentSelect(){

    let select =
        document.getElementById(
            "feeStudent"
        );


    select.innerHTML = "";


    students.forEach(s=>{

        select.innerHTML += `

<option value="${s.id}">

${escapeHTML(s.name)} - Group ${escapeHTML(s.group)}

</option>

`;

    });

}


/* =====================================================
   ADD FEE
===================================================== */
/* =====================================================
   ADD FEE (OFFLINE-CAPABLE)
===================================================== */

async function addFee() {
    let studentId = document.getElementById("feeStudent").value;
    let month = document.getElementById("feeMonth").value;
    let amount = Number(document.getElementById("feeAmount").value);

    if (!studentId) {
        alert("Please select a student.");
        return;
    }

    if (!month) {
        alert("Please select a month.");
        return;
    }

    if (!amount || amount <= 0) {
        alert("Please enter a valid amount.");
        return;
    }

    const newFee = {
        id: RFT.newId(),
        studentId,
        month,
        amount,
        paidDate: today()
    };

    const row = feeToRow(newFee);

    // 1. Local-first: write to IndexedDB + in-memory immediately - works offline.
    await RFT.put("fees", row);
    await RFT.enqueue("fees", "upsert", row);

    fees.push(newFee);
    saveAll();

    // Reset the form so the next entry starts clean instead of keeping
    // the previous student/amount selected.
    document.getElementById("feeStudent").value = "";
    document.getElementById("feeAmount").value = "";

    let selected = document.getElementById("feeSelectedStudent");
    if (selected) {
        selected.style.display = "none";
        selected.innerHTML = "";
    }

    let searchInput = document.getElementById("feeStudentSearch");
    if (searchInput) searchInput.value = "";

    let searchResults = document.getElementById("feeStudentSearchResults");
    if (searchResults) searchResults.innerHTML = "";

    renderFees();
    renderDashboard();

    alert("Fee recorded successfully.");
}


/* =====================================================
   RENDER FEES
===================================================== */
function renderFees(){

    let table =
        document.getElementById(
            "feeTable"
        );

    table.innerHTML = "";

    fees
    .slice()
    .reverse()
    .forEach(f=>{

        let student =
            students.find(
                s => s.id === f.studentId
            );

        if(!student)
            return;

        table.innerHTML += `

<tr>

<td>

${studentPhotoHTML(student)}

${escapeHTML(student.name)}

</td>

<td>${f.month}</td>

<td>Rs. ${f.amount}</td>

<td class="paid">
PAID
</td>

<td>

<div class="fee-menu">

<button
class="fee-menu-button"
onclick="toggleFeeMenu(this)">
⋮
</button>

<div class="fee-menu-dropdown">

<button
onclick="editFee('${f.id}')">
✏️
<span>Edit Fee</span>
</button>

<button
class="delete-option"
onclick="deleteFee('${f.id}')">
🗑️
<span>Delete Fee</span>
</button>

</div>

</div>

</td>

</tr>

`;

    });

}
/* =====================================================
   FEE STUDENT SEARCH & SELECTION
===================================================== */

function searchFeeStudents() {
    let input = document.getElementById("feeStudentSearch");
    let container = document.getElementById("feeStudentSearchResults");

    if (!input || !container) return;

    let search = input.value.trim().toLowerCase();

    if (!search) {
        container.innerHTML = "";
        return;
    }

    let matches = (students || []).filter(student => {
        let name = String(student.name || "").toLowerCase();
        let roll = String(student.roll || "").toLowerCase();
        let className = String(student.className || "").toLowerCase();
        let group = String(student.group || "").toLowerCase();

        return (
            name.includes(search) ||
            roll.includes(search) ||
            className.includes(search) ||
            group.includes(search)
        );
    });

    if (matches.length === 0) {
        container.innerHTML = `
            <div class="fee-search-empty">
                ❌ No student found.
            </div>
        `;
        return;
    }

    let displayMatches = matches.slice(0, 30);
    container.innerHTML = "";

    displayMatches.forEach(student => {
        let item = document.createElement("div");
        item.className = "fee-student-result";

        let photoHTML = student.photo
            ? `<img src="${student.photo}" alt="${escapeHTML(student.name)}">`
            : `<div class="fee-student-avatar">👤</div>`;

        item.innerHTML = `
            ${photoHTML}
            <div class="fee-student-info">
                <strong>${escapeHTML(student.name)}</strong>
                <span>
                    Class ${escapeHTML(student.className)}
                    &nbsp; • &nbsp;
                    Roll ${escapeHTML(student.roll)}
                    &nbsp; • &nbsp;
                    Group ${escapeHTML(student.group)}
                </span>
            </div>
        `;

        item.onclick = function() {
            selectFeeStudent(student.id);
        };

        container.appendChild(item);
    });

    if (matches.length > 30) {
        let more = document.createElement("div");
        more.className = "fee-search-empty";
        more.innerText = "Showing first 30 matches. Refine your search.";
        container.appendChild(more);
    }
}

function selectFeeStudent(id) {
    let student = (students || []).find(s => s.id === id);
    if (!student) return;

    let select = document.getElementById("feeStudent");
    if (select) {
        select.value = String(id);
    }

    let selected = document.getElementById("feeSelectedStudent");
    if (selected) {
        selected.style.display = "block";
        selected.innerHTML = `
            <span>👤 Selected:</span>
            <strong>${escapeHTML(student.name)}</strong>
            <span>
                — Class ${escapeHTML(student.className)}
                • Roll ${escapeHTML(student.roll)}
                • Group ${escapeHTML(student.group)}
            </span>
        `;
    }

    let searchInput = document.getElementById("feeStudentSearch");
    if (searchInput) searchInput.value = "";

    let searchResults = document.getElementById("feeStudentSearchResults");
    if (searchResults) searchResults.innerHTML = "";
}

/* =====================================================
   DELETE FEE (OFFLINE-CAPABLE)
===================================================== */

async function deleteFee(id) {
    if (!confirm("Are you sure you want to delete this fee record?")) {
        return;
    }

    // 1. Local-first: remove immediately, works offline.
    await RFT.remove("fees", id);
    await RFT.enqueue("fees", "delete", { id });

    fees = fees.filter(f => f.id !== id);
    saveAll();

    renderFees();
    renderDashboard();

    alert("Fee deleted.");
}


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

            if(!results[examId][s.id]){

                results[examId][s.id] = {
                    english: 0,
                    nepali: 0,
                    math: 0,
                    science: 0
                };

            }

            let r =
                results[examId][s.id];

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

        if(!results[examId][s.id]){

            results[examId][s.id] = {
                english: 0,
                nepali: 0,
                math: 0,
                science: 0
            };

        }

        let r =
            results[examId][s.id];

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

    if(!results[examId][studentId]){

        results[examId][studentId] = {
            english: 0,
            nepali: 0,
            math: 0,
            science: 0
        };

    }

    let r =
        results[examId][studentId];

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

    if(!results[examId][studentId]){
        results[examId][studentId] = {
            id: RFT.newId(),
            english: 0,
            nepali: 0,
            math: 0,
            science: 0
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
        total: total
    };

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
src="${student.photo}"
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
                    <td>${f.month}</td>
                    <td>Rs. ${f.amount}</td>
                    <td class="paid">Paid</td>
                    <td>${f.paidDate}</td>
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
                        👨‍👩‍👦 ${escapeHTML(student.parent || "Not provided")} &nbsp;•&nbsp; 📞 ${escapeHTML(student.phone || "Not provided")}
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
            <table>
                <thead>
                    <tr><th>Month</th><th>Amount</th><th>Status</th><th>Paid Date</th></tr>
                </thead>
                <tbody>
                    ${feeRows || `<tr><td colspan="4" class="empty">No fee records.</td></tr>`}
                </tbody>
            </table>
        </div>

        <div class="panel">
            <h3>📝 Exam History</h3>
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

    /* Dynamic group cards */
    let groupACount = students.filter(s => s.group === "A").length;
    let groupBCount = students.filter(s => s.group === "B").length;
    let groupCCount = students.filter(s => s.group === "C").length;

    document.getElementById("groupA").innerText = groupACount;
    document.getElementById("groupB").innerText = groupBCount;
    document.getElementById("groupC").innerText = groupCCount;

    /* Today's attendance */
    let date = today();
    let todayData = attendance[date] || {};

    let present = Object.values(todayData).filter(v => v === "present").length;
    let absent = Object.values(todayData).filter(v => v === "absent").length;

    document.getElementById("presentToday").innerText = present;
    document.getElementById("absentToday").innerText = absent;

    /* Total fees */
    let totalFees = fees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
    document.getElementById("dashboardTotalFees").innerText = "Rs. " + totalFees;

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
                        👨‍👩‍👦 ${escapeHTML(s.parent || "N/A")} | 📞 ${escapeHTML(s.phone || "N/A")}
                    </div>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}


/* =====================================================
   BACKUP
===================================================== */
async function exportData(){

    try{

        const [
            studentsResponse,
            attendanceResponse,
            feesResponse,
            examsResponse,
            resultsResponse,
            groupsResponse
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
                .order("id", { ascending: true })

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

            if(
                !data ||
                !Array.isArray(data.students) ||
                !Array.isArray(data.attendance) ||
                !Array.isArray(data.fees) ||
                !Array.isArray(data.exams) ||
                !Array.isArray(data.results) ||
                !Array.isArray(data.groups)
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
                    "Students, attendance, fees, exams, results and groups will be replaced.\n\n" +
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


            response =
                await supabaseClient
                .from("exams")
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
               RELOAD EVERYTHING
               ========================= */

            selectedHistoryStudentId =
                null;


            await loadGroupsFromSupabase();

            await loadStudentsFromSupabase();

            await loadAttendanceFromSupabase();

            await loadFeesFromSupabase();

            await loadExamsFromSupabase();

            await loadResultsFromSupabase();


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

    renderFeeStudentSelect();

    renderFees();

    renderExamSelect();

    renderResults();

    renderStudentHistory();

    renderDashboard();

    

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
    "feeMonth"
).value =
    new Date()
    .toISOString()
    .slice(0,7);


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
function toggleFeeMenu(button){

    let menu =
        button.parentElement
        .querySelector(
            ".fee-menu-dropdown"
        );

    document
        .querySelectorAll(
            ".fee-menu-dropdown"
        )
        .forEach(otherMenu => {

            if(otherMenu !== menu){
                otherMenu.classList.remove(
                    "show"
                );
            }

        });

    menu.classList.toggle("show");

}
document.addEventListener(
    "click",
    function(event){

        if(
            !event.target.closest(
                ".fee-menu"
            )
        ){

            document
                .querySelectorAll(
                    ".fee-menu-dropdown"
                )
                .forEach(menu => {

                    menu.classList.remove(
                        "show"
                    );

                });

        }

    }
);
async function editFee(id){

    let fee = fees.find(f => f.id === id);

    if(!fee){
        alert("Fee record not found.");
        return;
    }

    let newMonth = prompt("Enter fee month (YYYY-MM):", fee.month);
    if(newMonth === null) return;
    newMonth = newMonth.trim();
    if(!newMonth){
        alert("Month cannot be empty.");
        return;
 }
    let newAmount = prompt("Enter fee amount:", fee.amount);
    if(newAmount === null) return;
    newAmount = newAmount.trim();
    if(!newAmount){
        alert("Amount cannot be empty.");
        return;
    }
    let amount = Number(newAmount);
    if(!Number.isFinite(amount) || amount < 0){
        alert("Please enter a valid amount.");
        return;
    }

    fee.month = newMonth;
    fee.amount = amount;

    const row = feeToRow(fee);
    await RFT.put("fees", row);
    await RFT.enqueue("fees", "upsert", row);
    saveAll();

    renderFees();

    alert("✅ Fee updated successfully.");

}
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

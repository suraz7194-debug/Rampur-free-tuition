/* =====================================================
   SUPABASE INITIALIZATION
===================================================== */

const SUPABASE_URL = "https://gkbhqpikqnhmwqyeamwq.supabase.co";
const SUPABASE_KEY = "sb_publishable_jEydXwqKEqmdmlRPYLAQ9g_wMesM0Kh";

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

/* =====================================================
   OFFLINE DATABASE & UTILITIES
===================================================== */

let offlineDB = null;
const OFFLINE_DB_NAME = "RampurTuitionDB";
const OFFLINE_DB_VERSION = 1;

function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function today() {
    let d = new Date();
    return d.toISOString().split("T")[0];
}

function renderAll() {
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
    renderDashboard();
}

/* =====================================================
   ADMIN LOGIN & SESSION
===================================================== */

async function adminLogin() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const message = document.getElementById("loginMessage");

    if (!email || !password) {
        message.innerText = "Please enter email and password.";
        return;
    }

    message.style.color = "#dc2626";
    message.innerText = "Logging in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        message.innerText = "Invalid email or password.";
        console.error(error);
        return;
    }

    message.style.color = "#16a34a";
    message.innerText = "Login successful!";

    document.getElementById("loginScreen").style.display = "none";
}

async function checkAdminSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        document.getElementById("loginScreen").style.display = "none";
    }
}

checkAdminSession();

async function adminLogout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error("Logout error:", error);
        return;
    }

    document.getElementById("loginMessage").innerText = "";
    document.getElementById("loginScreen").style.display = "flex";
}

/* =====================================================
   NAVIGATION
===================================================== */

function showSection(id, button) {
    document.querySelectorAll(".section").forEach(section => {
        section.classList.remove("active");
    });
    document.getElementById(id).classList.add("active");

    document.querySelectorAll("nav button").forEach(btn => {
        btn.classList.remove("active");
    });
    button.classList.add("active");

    renderAll();
}

/* =====================================================
   DATA STATE & INDEXEDDB
===================================================== */

let students = [];
let attendance = {};
let fees = [];
let exams = [];
let results = {};
let groups = [];
let groupIds = {};

let studentGroup = "A";
let attendanceGroup = "A";
let resultGroup = "A";

let selectedStudentPhoto = "";
let selectedEditPhoto = "";
let selectedHistoryStudentId = null;

function openOfflineDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("students")) db.createObjectStore("students", { keyPath: "id" });
            if (!db.objectStoreNames.contains("groups")) db.createObjectStore("groups", { keyPath: "id" });
            if (!db.objectStoreNames.contains("attendance")) db.createObjectStore("attendance", { keyPath: "id" });
            if (!db.objectStoreNames.contains("fees")) db.createObjectStore("fees", { keyPath: "id" });
            if (!db.objectStoreNames.contains("exams")) db.createObjectStore("exams", { keyPath: "id" });
            if (!db.objectStoreNames.contains("results")) db.createObjectStore("results", { keyPath: "id" });
            if (!db.objectStoreNames.contains("syncQueue")) db.createObjectStore("syncQueue", { keyPath: "queueId", autoIncrement: true });
        };

        request.onsuccess = function(event) {
            offlineDB = event.target.result;
            console.log("Offline database ready.");
            resolve(offlineDB);
        };

        request.onerror = function() {
            console.error("Offline database error:", request.error);
            reject(request.error);
        };
    });
}

function saveAll() {
    saveStudentsToOfflineDB();
    saveAttendanceToOfflineDB();
    saveFeesToOfflineDB();
    saveExamsToOfflineDB();
    saveResultsToOfflineDB();
    saveGroupsToOfflineDB();
}

/* =====================================================
   STUDENT DATA OPS
===================================================== */

async function loadStudentsFromSupabase() {
    const { data, error } = await supabaseClient
        .from("students")
        .select("*")
        .order("id", { ascending: true });

    if (error) {
        console.error("SUPABASE LOAD ERROR:", error);
        console.log("Loading students from offline database...");
        await loadStudentsFromOfflineDB();
        return;
    }

    students = data.map(row => ({
        id: row.id,
        name: row.name,
        className: row.class,
        roll: row.roll,
        parent: row.parent,
        phone: row.phone,
        group: row.group,
        joined: row.date_joined,
        photo: row.photo || ""
    }));

    renderAll();
    await saveStudentsToOfflineDB();
}

async function saveStudentsToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("students", "readwrite");
        const store = transaction.objectStore("students");
        students.forEach(student => store.put(student));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function loadStudentsFromOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("students", "readonly");
        const store = transaction.objectStore("students");
        const request = store.getAll();
        request.onsuccess = function() {
            students = request.result || [];
            renderAll();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

/* =====================================================
   ATTENDANCE DATA OPS
===================================================== */

async function loadAttendanceFromSupabase() {
    const { data, error } = await supabaseClient
        .from("attendance")
        .select("*")
        .order("date", { ascending: true });

    if (error) {
        console.error("SUPABASE ATTENDANCE LOAD ERROR:", error);
        return;
    }

    attendance = {};
    data.forEach(row => {
        if (!attendance[row.date]) attendance[row.date] = {};
        attendance[row.date][row.student_id] = row.status;
    });

    renderAttendance();
    renderMonthlyAttendance();
    renderDashboard();
    await saveAttendanceToOfflineDB();
}

async function saveAttendanceToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("attendance", "readwrite");
        const store = transaction.objectStore("attendance");
        Object.keys(attendance).forEach(date => {
            Object.keys(attendance[date]).forEach(studentId => {
                store.put({
                    id: date + "_" + studentId,
                    date: date,
                    student_id: Number(studentId),
                    status: attendance[date][studentId]
                });
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/* =====================================================
   FEES DATA OPS
===================================================== */

async function loadFeesFromSupabase() {
    const { data, error } = await supabaseClient
        .from("fees")
        .select("*")
        .order("date", { ascending: true });

    if (error) {
        console.error("SUPABASE FEES LOAD ERROR:", error);
        return;
    }

    fees = data.map(row => ({
        id: row.id,
        studentId: row.student_id,
        month: row.month,
        amount: Number(row.amount),
        paidDate: row.date
    }));

    renderFees();
    await saveFeesToOfflineDB();
}

async function saveFeesToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("fees", "readwrite");
        const store = transaction.objectStore("fees");
        fees.forEach(fee => {
            store.put({
                id: fee.id,
                student_id: fee.studentId,
                month: fee.month,
                amount: Number(fee.amount),
                date: fee.paidDate
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/* =====================================================
   EXAMS DATA OPS
===================================================== */

async function loadExamsFromSupabase() {
    const { data, error } = await supabaseClient
        .from("exams")
        .select("*")
        .order("date", { ascending: true });

    if (error) {
        console.error("SUPABASE EXAMS LOAD ERROR:", error);
        return;
    }

    exams = data.map(row => ({
        id: row.id,
        name: row.exam_name,
        date: row.date
    }));

    renderExamSelect();
    await saveExamsToOfflineDB();
}

async function saveExamsToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("exams", "readwrite");
        const store = transaction.objectStore("exams");
        exams.forEach(exam => {
            store.put({
                id: exam.id,
                exam_name: exam.name,
                date: exam.date
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/* =====================================================
   RESULTS DATA OPS
===================================================== */

async function loadResultsFromSupabase() {
    const { data, error } = await supabaseClient.from("results").select("*");
    if (error) {
        console.error("SUPABASE RESULTS LOAD ERROR:", error);
        return;
    }

    results = {};
    data.forEach(row => {
        if (!results[row.exam_id]) results[row.exam_id] = {};
        results[row.exam_id][row.student_id] = {
            english: Number(row.english || 0),
            nepali: Number(row.nepali || 0),
            math: Number(row.maths || 0),
            science: Number(row.science || 0),
            total: Number(row.total || 0)
        };
    });

    renderResults();
    await saveResultsToOfflineDB();
}

async function saveResultsToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("results", "readwrite");
        const store = transaction.objectStore("results");
        Object.keys(results).forEach(examId => {
            Object.keys(results[examId]).forEach(studentId => {
                const result = results[examId][studentId];
                store.put({
                    id: String(examId) + "_" + String(studentId),
                    exam_id: Number(examId),
                    student_id: Number(studentId),
                    english: Number(result.english || 0),
                    nepali: Number(result.nepali || 0),
                    maths: Number(result.math || 0),
                    science: Number(result.science || 0),
                    total: Number(result.total || 0)
                });
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/* =====================================================
   GROUPS DATA OPS
===================================================== */

async function loadGroupsFromSupabase() {
    const { data, error } = await supabaseClient
        .from("groups")
        .select("*")
        .order("id", { ascending: true });

    if (error) {
        console.error("SUPABASE GROUPS LOAD ERROR:", error);
        return;
    }

    groupIds = {};
    data.forEach(row => {
        let name = String(row.name).trim();
        if (name) groupIds[name] = row.id;
    });

    groups = data.map(row => String(row.name).trim()).filter(Boolean);
    if (groups.length === 0) groups = ["A"];

    studentGroup = groups.includes(studentGroup) ? studentGroup : groups[0];
    attendanceGroup = groups.includes(attendanceGroup) ? attendanceGroup : groups[0];
    resultGroup = groups.includes(resultGroup) ? resultGroup : groups[0];

    renderAll();
    await saveGroupsToOfflineDB();
}

async function saveGroupsToOfflineDB() {
    if (!offlineDB) return;
    return new Promise((resolve, reject) => {
        const transaction = offlineDB.transaction("groups", "readwrite");
        const store = transaction.objectStore("groups");
        groups.forEach(groupName => {
            store.put({
                id: groupIds[groupName] || groupName,
                name: groupName
            });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

/* =====================================================
   GROUP MANAGEMENT INTERFACE
===================================================== */

function renderGroupSelects() {
    let addSelect = document.getElementById("studentGroup");
    let editSelect = document.getElementById("editStudentGroup");

    if (addSelect) {
        let oldValue = addSelect.value;
        addSelect.innerHTML = "";
        groups.forEach(group => {
            addSelect.innerHTML += `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`;
        });
        addSelect.value = groups.includes(oldValue) ? oldValue : groups[0] || "";
    }

    if (editSelect) {
        let oldValue = editSelect.value;
        editSelect.innerHTML = "";
        groups.forEach(group => {
            editSelect.innerHTML += `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`;
        });
        if (groups.includes(oldValue)) editSelect.value = oldValue;
    }
}

function renderGroupButtons() {
    const setupButtons = (containerId, currentVal, selectFn) => {
        let container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";
        groups.forEach(group => {
            let button = document.createElement("button");
            button.innerText = group;
            if (group === currentVal) button.classList.add("active");
            button.onclick = () => selectFn(group);
            container.appendChild(button);
        });
    };

    setupButtons("studentGroupButtons", studentGroup, selectStudentGroup);
    setupButtons("attendanceGroupButtons", attendanceGroup, selectAttendanceGroup);
    setupButtons("resultGroupButtons", resultGroup, selectResultGroup);
}

function renderManageGroups() {
    let container = document.getElementById("manageGroupsList");
    if (!container) return;
    container.innerHTML = "";

    groups.forEach(group => {
        let box = document.createElement("div");
        box.className = "modern-group-row";
        let count = students.filter(s => s.group === group).length;
        let groupId = groupIds[group];

        box.innerHTML = `
            <div class="modern-group-info">
                <div class="modern-group-icon">👥</div>
                <div>
                    <strong>${escapeHTML(group)}</strong>
                    <span>${count} student${count === 1 ? "" : "s"}</span>
                </div>
            </div>
            <div class="modern-group-menu">
                <button class="group-menu-button" onclick="toggleGroupMenu(this)">⋮</button>
                <div class="group-menu-dropdown">
                    <button onclick="editGroup('${groupId}')">✏️ <span>Edit Group</span></button>
                    <button class="delete-option" onclick="deleteGroup('${groupId}')">🗑️ <span>Delete Group</span></button>
                </div>
            </div>
        `;
        container.appendChild(box);
    });
}

function toggleGroupMenu(button) {
    let menu = button.parentElement.querySelector(".group-menu-dropdown");
    document.querySelectorAll(".group-menu-dropdown").forEach(other => {
        if (other !== menu) other.classList.remove("show");
    });
    menu.classList.toggle("show");
}

document.addEventListener("click", function(event) {
    if (!event.target.closest(".modern-group-menu")) {
        document.querySelectorAll(".group-menu-dropdown").forEach(menu => menu.classList.remove("show"));
    }
});

async function addGroup() {
    let input = document.getElementById("newGroupName");
    let name = input.value.trim();

    if (!name) return alert("Please enter a group name.");
    if (groups.some(g => g.toLowerCase() === name.toLowerCase())) return alert("This group already exists.");

    const { data, error } = await supabaseClient.from("groups").insert({ name: name }).select().single();
    if (error) return alert("Could not add group:\n" + error.message);

    groups.push(data.name);
    groupIds[data.name] = data.id;
    studentGroup = data.name;
    attendanceGroup = data.name;
    resultGroup = data.name;

    input.value = "";
    renderAll();
    alert("Group '" + data.name + "' added successfully.");
}

async function editGroup(groupId) {
    let oldName = Object.keys(groupIds).find(name => String(groupIds[name]) === String(groupId));
    if (!oldName) return alert("Group not found.");

    let newName = prompt("Enter new name for group:", oldName);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName) return alert("Group name cannot be empty.");

    if (groups.some(g => g !== oldName && g.toLowerCase() === newName.toLowerCase())) {
        return alert("A group with this name already exists.");
    }

    let response = await supabaseClient.from("students").update({ group: newName }).eq("group", oldName);
    if (response.error) return alert("Could not update students:\n" + response.error.message);

    response = await supabaseClient.from("groups").update({ name: newName }).eq("id", groupId);
    if (response.error) {
        await supabaseClient.from("students").update({ group: oldName }).eq("group", newName);
        return alert("Could not rename group:\n" + response.error.message);
    }

    students.forEach(student => { if (student.group === oldName) student.group = newName; });
    let index = groups.indexOf(oldName);
    if (index !== -1) groups[index] = newName;

    delete groupIds[oldName];
    groupIds[newName] = groupId;

    if (studentGroup === oldName) studentGroup = newName;
    if (attendanceGroup === oldName) attendanceGroup = newName;
    if (resultGroup === oldName) resultGroup = newName;

    renderAll();
    alert("✅ Group renamed successfully.");
}

async function deleteGroup(groupId) {
    let group = Object.keys(groupIds).find(name => String(groupIds[name]) === String(groupId));
    if (!group) return alert("Group not found.");
    if (groups.length <= 1) return alert("You must keep at least one group.");

    let studentCount = students.filter(s => s.group === group).length;
    let message = "Delete group '" + group + "'?";
    if (studentCount > 0) message += "\n\nThis group has " + studentCount + " student(s). They will be moved to another group.";

    if (!confirm(message)) return;

    let replacement = groups.find(g => g !== group);

    if (studentCount > 0) {
        let response = await supabaseClient.from("students").update({ group: replacement }).eq("group", group);
        if (response.error) return alert("Could not move students:\n" + response.error.message);
    }

    const { error } = await supabaseClient.from("groups").delete().eq("id", groupId);
    if (error) {
        if (studentCount > 0) await supabaseClient.from("students").update({ group: group }).eq("group", replacement);
        return alert("Could not delete group:\n" + error.message);
    }

    if (studentCount > 0) {
        students.forEach(student => { if (student.group === group) student.group = replacement; });
    }

    groups = groups.filter(g => g !== group);
    delete groupIds[group];

    if (studentGroup === group) studentGroup = replacement;
    if (attendanceGroup === group) attendanceGroup = replacement;
    if (resultGroup === group) resultGroup = replacement;

    renderAll();
    alert("✅ Group deleted successfully.");
}

/* =====================================================
   PHOTO COMPRESSION PIPELINE
===================================================== */

function compressImageFile(file, callback) {
    if (!file || !file.type.startsWith("image/")) {
        alert("Please select a valid image.");
        return;
    }
    let reader = new FileReader();
    reader.onload = function(e) {
        let img = new Image();
        img.onload = function() {
            let canvas = document.createElement("canvas");
            let maxSize = 500;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height = height * maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = width * maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            let ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function previewStudentPhoto(event) {
    compressImageFile(event.target.files[0], base64 => {
        selectedStudentPhoto = base64;
        let preview = document.getElementById("photoPreview");
        preview.src = base64;
        preview.style.display = "block";
    });
}

function previewEditStudentPhoto(event) {
    compressImageFile(event.target.files[0], base64 => {
        selectedEditPhoto = base64;
        let preview = document.getElementById("editPhotoPreview");
        preview.src = base64;
        preview.style.display = "block";
    });
}

/* =====================================================
   STUDENT MANAGEMENT
===================================================== */

async function addStudent() {
    let name = document.getElementById("studentName").value.trim();
    let className = document.getElementById("studentClass").value.trim();
    let roll = document.getElementById("studentRoll").value.trim();
    let parent = document.getElementById("parentName").value.trim();
    let phone = document.getElementById("parentPhone").value.trim();
    let group = document.getElementById("studentGroup").value;

    if (!name || !className || !roll) return alert("Please enter name, class and roll.");
    if (!group) return alert("Please select a group.");

    const { data, error } = await supabaseClient.from("students").insert({
        name: name,
        class: className,
        roll: roll,
        parent: parent,
        phone: phone,
        group: group,
        date_joined: today(),
        photo: selectedStudentPhoto || ""
    }).select().single();

    if (error) return alert("Could not save student to database.");

    students.push({
        id: data.id,
        name: data.name,
        className: data.class,
        roll: data.roll,
        parent: data.parent,
        phone: data.phone,
        group: data.group,
        joined: data.date_joined,
        photo: data.photo || ""
    });

    saveAll();

    document.getElementById("studentName").value = "";
    document.getElementById("studentClass").value = "";
    document.getElementById("studentRoll").value = "";
    document.getElementById("parentName").value = "";
    document.getElementById("parentPhone").value = "";
    document.getElementById("studentPhoto").value = "";

    let preview = document.getElementById("photoPreview");
    preview.style.display = "none";
    preview.src = "";
    selectedStudentPhoto = "";

    renderAll();
    alert("Student added.");
}

function selectStudentGroup(group) {
    studentGroup = group;
    renderGroupButtons();
    renderStudents();
}

function editStudent(id) {
    let student = students.find(s => s.id === id);
    if (!student) return alert("Student not found.");

    document.getElementById("editStudentBox").style.display = "block";
    document.getElementById("editStudentId").value = student.id;
    document.getElementById("editStudentName").value = student.name;
    document.getElementById("editStudentClass").value = student.className;
    document.getElementById("editStudentRoll").value = student.roll;
    document.getElementById("editParentName").value = student.parent || "";
    document.getElementById("editParentPhone").value = student.phone || "";

    renderGroupSelects();
    document.getElementById("editStudentGroup").value = student.group;

    selectedEditPhoto = "";
    let preview = document.getElementById("editPhotoPreview");
    if (student.photo) {
        preview.src = student.photo;
        preview.style.display = "block";
    } else {
        preview.src = "";
        preview.style.display = "none";
    }
    document.getElementById("editStudentPhoto").value = "";
    document.getElementById("editStudentBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveStudentEdit() {
    let id = Number(document.getElementById("editStudentId").value);
    let student = students.find(s => s.id === id);
    if (!student) return alert("Student not found.");

    let name = document.getElementById("editStudentName").value.trim();
    let className = document.getElementById("editStudentClass").value.trim();
    let roll = document.getElementById("editStudentRoll").value.trim();
    let parent = document.getElementById("editParentName").value.trim();
    let phone = document.getElementById("editParentPhone").value.trim();
    let group = document.getElementById("editStudentGroup").value;

    if (!name || !className || !roll) return alert("Name, class and roll are required.");

    let photo = selectedEditPhoto || student.photo || "";

    const { data, error } = await supabaseClient.from("students").update({
        name: name,
        class: className,
        roll: roll,
        parent: parent,
        phone: phone,
        group: group,
        photo: photo
    }).eq("id", id).select().single();

    if (error) return alert("Could not update student in database.");

    student.name = data.name;
    student.className = data.class;
    student.roll = data.roll;
    student.parent = data.parent;
    student.phone = data.phone;
    student.group = data.group;
    student.photo = data.photo || "";

    saveAll();
    selectedEditPhoto = "";
    document.getElementById("editStudentBox").style.display = "none";
    renderAll();
    alert("Student information updated successfully.");
}

function cancelStudentEdit() {
    document.getElementById("editStudentBox").style.display = "none";
    selectedEditPhoto = "";
}

function studentPhotoHTML(student, className = "student-photo") {
    if (student.photo) {
        return `<img src="${student.photo}" class="${className}" alt="${escapeHTML(student.name)}">`;
    }
    return `<span class="${className}" style="display:inline-flex;align-items:center;justify-content:center;background:#e5e7eb;font-size:18px;">👤</span>`;
}

function renderStudents() {
    let table = document.getElementById("studentTable");
    if (!table) return;

    let search = document.getElementById("studentSearch").value.toLowerCase();
    table.innerHTML = "";

    let list = students.filter(s =>
        s.group === studentGroup &&
        (
            String(s.name || "").toLowerCase().includes(search) ||
            String(s.roll || "").toLowerCase().includes(search) ||
            String(s.className || "").toLowerCase().includes(search) ||
            String(s.parent || "").toLowerCase().includes(search) ||
            String(s.phone || "").toLowerCase().includes(search)
        )
    );

    if (list.length === 0) {
        table.innerHTML = `<tr><td colspan="6" class="empty">No students found.</td></tr>`;
        return;
    }

    list.forEach(s => {
        table.innerHTML += `
            <tr>
                <td>${studentPhotoHTML(s)} <b>${escapeHTML(s.name)}</b></td>
                <td>${escapeHTML(s.className)}</td>
                <td>${escapeHTML(s.roll)}</td>
                <td>${escapeHTML(s.parent || "")}</td>
                <td>${escapeHTML(s.phone || "")}</td>
                <td>
                    <div class="student-menu">
                        <button class="student-menu-button" onclick="toggleStudentMenu(this)">⋮</button>
                        <div class="student-menu-dropdown">
                            <button onclick="editStudent(${s.id})">✏️ <span>Edit Student</span></button>
                            <button class="delete-option" onclick="deleteStudent(${s.id})">🗑️ <span>Delete Student</span></button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });
}

function toggleStudentMenu(button) {
    let menu = button.parentElement.querySelector(".student-menu-dropdown");
    document.querySelectorAll(".student-menu-dropdown").forEach(m => {
        if (m !== menu) m.classList.remove("show");
    });
    menu.classList.toggle("show");
}

async function deleteStudent(id) {
    if (!confirm("⚠️ Delete this student and all their records?\n\nThis action cannot be undone.")) return;

    try {
        await supabaseClient.from("results").delete().eq("student_id", id);
        await supabaseClient.from("attendance").delete().eq("student_id", id);
        await supabaseClient.from("fees").delete().eq("student_id", id);
        const { error } = await supabaseClient.from("students").delete().eq("id", id);
        if (error) throw error;

        students = students.filter(s => s.id !== id);
        Object.keys(attendance).forEach(date => { delete attendance[date][id]; });
        fees = fees.filter(f => f.studentId !== id);
        Object.keys(results).forEach(examId => { delete results[examId][id]; });

        if (selectedHistoryStudentId === id) selectedHistoryStudentId = null;

        saveAll();
        renderAll();
        alert("✅ Student and all records deleted successfully.");
    } catch (error) {
        console.error("DELETE STUDENT ERROR:", error);
        alert("❌ Could not delete student from cloud.\n\n" + error.message);
    }
}

/* =====================================================
   ATTENDANCE MANAGEMENT
===================================================== */

function selectAttendanceGroup(group) {
    attendanceGroup = group;
    renderGroupButtons();
    renderAttendance();
    renderMonthlyAttendance();
}

function renderAttendance() {
    let dateInput = document.getElementById("attendanceDate");
    let date = dateInput.value || today();
    dateInput.value = date;

    if (!attendance[date]) attendance[date] = {};

    let table = document.getElementById("attendanceTable");
    table.innerHTML = "";

    let list = students.filter(s => s.group === attendanceGroup);
    if (list.length === 0) {
        table.innerHTML = `<tr><td colspan="4" class="empty">No students in this group.</td></tr>`;
        return;
    }

    list.forEach(s => {
        let status = attendance[date][s.id] || "unmarked";
        let buttonText = status === "present" ? "Present ✓" : status === "absent" ? "Absent ✗" : "Not Marked";
        let cls = status === "present" ? "green" : status === "absent" ? "red" : "gray";

        table.innerHTML += `
            <tr>
                <td>${studentPhotoHTML(s)} <b>${escapeHTML(s.name)}</b></td>
                <td>${escapeHTML(s.className)}</td>
                <td>${escapeHTML(s.roll)}</td>
                <td>
                    <button class="btn ${cls}" onclick="toggleAttendance(${s.id}, '${date}')">
                        ${buttonText}
                    </button>
                </td>
            </tr>
        `;
    });
}

async function toggleAttendance(id, date) {
    if (!attendance[date]) attendance[date] = {};
    let current = attendance[date][id];
    let newStatus = current === "present" ? "absent" : "present";

    const { data: existing } = await supabaseClient
        .from("attendance")
        .select("*")
        .eq("student_id", id)
        .eq("date", date)
        .maybeSingle();

    if (existing) {
        const { error } = await supabaseClient
            .from("attendance")
            .update({ status: newStatus })
            .eq("id", existing.id);
        if (error) return alert("Could not update attendance.");
    } else {
        const { error } = await supabaseClient
            .from("attendance")
            .insert({ student_id: id, date: date, status: newStatus });
        if (error) return alert("Could not save attendance.");
    }

    attendance[date][id] = newStatus;
    renderAttendance();
    renderMonthlyAttendance();
    renderDashboard();
}

function renderMonthlyAttendance() {
    let monthInput = document.getElementById("attendanceMonth");
    let month = monthInput.value || new Date().toISOString().slice(0, 7);
    monthInput.value = month;

    let table = document.getElementById("monthlyAttendanceTable");
    table.innerHTML = "";

    let list = students.filter(s => s.group === attendanceGroup);
    list.forEach(s => {
        let present = 0, absent = 0;
        Object.keys(attendance).forEach(date => {
            if (date.startsWith(month)) {
                let status = attendance[date][s.id];
                if (status === "present") present++;
                if (status === "absent") absent++;
            }
        });

        let total = present + absent;
        let percent = total === 0 ? 0 : (present / total) * 100;

        table.innerHTML += `
            <tr>
                <td>${studentPhotoHTML(s)} <b>${escapeHTML(s.name)}</b></td>
                <td class="present">${present}</td>
                <td class="absent">${absent}</td>
                <td>${total}</td>
                <td>${percent.toFixed(1)}%</td>
            </tr>
        `;
    });
}

/* =====================================================
   FEES MANAGEMENT
===================================================== */

function renderFeeStudentSelect() {
    let select = document.getElementById("feeStudent");
    if (!select) return;
    select.innerHTML = "";
    students.forEach(s => {
        select.innerHTML += `<option value="${s.id}">${escapeHTML(s.name)} - Group ${escapeHTML(s.group)}</option>`;
    });
}

async function addFee() {
    let studentId = Number(document.getElementById("feeStudent").value);
    let month = document.getElementById("feeMonth").value;
    let amount = Number(document.getElementById("feeAmount").value);

    if (!studentId) return alert("Please select a student.");
    if (!month) return alert("Please select a month.");
    if (!amount || amount <= 0) return alert("Please enter a valid amount.");

    const { data, error } = await supabaseClient.from("fees").insert({
        student_id: studentId,
        date: today(),
        amount: amount,
        month: month
    }).select().single();

    if (error) return alert("Could not save fee.");

    fees.push({
        id: data.id,
        studentId: data.student_id,
        month: data.month,
        amount: Number(data.amount),
        paidDate: data.date
    });

    saveAll();
    renderFees();
    renderDashboard();
    alert("Fee recorded successfully.");
}

function searchFeeStudents() {
    let input = document.getElementById("feeStudentSearch");
    let container = document.getElementById("feeStudentSearchResults");
    let search = input.value.trim().toLowerCase();

    if (!search) {
        container.innerHTML = "";
        return;
    }

    let matches = students.filter(s =>
        String(s.name || "").toLowerCase().includes(search) ||
        String(s.roll || "").toLowerCase().includes(search) ||
        String(s.className || "").toLowerCase().includes(search) ||
        String(s.group || "").toLowerCase().includes(search)
    );

    if (matches.length === 0) {
        container.innerHTML = `<div class="fee-search-empty">❌ No student found.</div>`;
        return;
    }

    container.innerHTML = "";
    matches.slice(0, 30).forEach(student => {
        let item = document.createElement("div");
        item.className = "fee-student-result";
        let photoHTML = student.photo
            ? `<img src="${student.photo}" alt="${escapeHTML(student.name)}">`
            : `<div class="fee-student-avatar">👤</div>`;

        item.innerHTML = `
            ${photoHTML}
            <div class="fee-student-info">
                <strong>${escapeHTML(student.name)}</strong>
                <span>Class ${escapeHTML(student.className)} • Roll ${escapeHTML(student.roll)} • Group ${escapeHTML(student.group)}</span>
            </div>
        `;
        item.onclick = () => selectFeeStudent(student.id);
        container.appendChild(item);
    });
}

function selectFeeStudent(id) {
    let student = students.find(s => s.id === id);
    if (!student) return;

    document.getElementById("feeStudent").value = String(id);
    let selected = document.getElementById("feeSelectedStudent");
    selected.style.display = "block";
    selected.innerHTML = `
        <span>👤 Selected:</span>
        <strong>${escapeHTML(student.name)}</strong>
        <span>— Class ${escapeHTML(student.className)} • Roll ${escapeHTML(student.roll)} • Group ${escapeHTML(student.group)}</span>
    `;

    document.getElementById("feeStudentSearch").value = "";
    document.getElementById("feeStudentSearchResults").innerHTML = "";
}

function renderFees() {
    let table = document.getElementById("feeTable");
    if (!table) return;
    table.innerHTML = "";

    fees.slice().reverse().forEach(f => {
        let student = students.find(s => s.id === f.studentId);
        if (!student) return;

        table.innerHTML += `
            <tr>
                <td>${studentPhotoHTML(student)} ${escapeHTML(student.name)}</td>
                <td>${f.month}</td>
                <td>Rs. ${f.amount}</td>
                <td class="paid">PAID</td>
                <td>
                    <div class="fee-menu">
                        <button class="fee-menu-button" onclick="toggleFeeMenu(this)">⋮</button>
                        <div class="fee-menu-dropdown">
                            <button class="delete-option" onclick="deleteFee(${f.id})">🗑️ <span>Delete Fee</span></button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });
}

function toggleFeeMenu(button) {
    let menu = button.parentElement.querySelector(".fee-menu-dropdown");
    document.querySelectorAll(".fee-menu-dropdown").forEach(m => {
        if (m !== menu) m.classList.remove("show");
    });
    menu.classList.toggle("show");
}

async function deleteFee(id) {
    const { error } = await supabaseClient.from("fees").delete().eq("id", id);
    if (error) return alert("Could not delete fee.");

    fees = fees.filter(f => f.id !== id);
    saveAll();
    renderFees();
    renderDashboard();
    alert("Fee deleted.");
}

/* =====================================================
   EXAMS & RESULTS
===================================================== */

async function createExam() {
    let name = document.getElementById("examName").value.trim();
    let date = document.getElementById("examDate").value;

    if (!name) return alert("Please enter exam name.");
    if (!date) return alert("Please select exam date.");

    const { data, error } = await supabaseClient.from("exams").insert({
        exam_name: name,
        date: date
    }).select().single();

    if (error) return alert("Could not save exam.");

    exams.push({ id: data.id, name: data.exam_name, date: data.date });
    saveAll();

    document.getElementById("examName").value = "";
    document.getElementById("examDate").value = "";
    renderExamSelect();
    alert("Exam created successfully.");
}

async function deleteExam() {
    let id = Number(document.getElementById("examSelect").value);
    if (!id) return alert("Please select an exam to delete.");

    const { error } = await supabaseClient.from("exams").delete().eq("id", id);
    if (error) return alert("Could not delete exam:\n" + error.message);

    exams = exams.filter(exam => exam.id !== id);
    delete results[id];

    saveAll();
    renderExamSelect();
    alert("Exam deleted successfully.");
}

function renderExamSelect() {
    let select = document.getElementById("examSelect");
    if (!select) return;
    select.innerHTML = "";

    if (exams.length === 0) {
        select.innerHTML = `<option value="">No exams created</option>`;
        return;
    }

    exams.forEach(exam => {
        select.innerHTML += `<option value="${exam.id}">${escapeHTML(exam.name)} - ${exam.date}</option>`;
    });
}

function selectResultGroup(group) {
    resultGroup = group;
    renderGroupButtons();
    renderResults();
}

let resultsView = "summary";
let resultSearchText = "";
let selectedResultStudentId = null;

function setResultsView(view) {
    resultsView = view;
    document.getElementById("resultSummaryBtn").classList.toggle("active", view === "summary");
    document.getElementById("resultEntryBtn").classList.toggle("active", view === "entry");
    selectedResultStudentId = null;
    renderResults();
}

function searchResultStudents() {
    resultSearchText = document.getElementById("resultStudentSearch").value.trim().toLowerCase();
    renderResults();
}

function getResultStudents() {
    let list = students.filter(s => s.group === resultGroup);
    if (!resultSearchText) return list;
    return list.filter(s =>
        String(s.name || "").toLowerCase().includes(resultSearchText) ||
        String(s.roll || "").toLowerCase().includes(resultSearchText)
    );
}

function getGrade(p) {
    if (p >= 90) return "A+";
    if (p >= 80) return "A";
    if (p >= 70) return "B+";
    if (p >= 60) return "B";
    if (p >= 50) return "C+";
    if (p >= 40) return "C";
    return "F";
}

function renderResults() {
    let table = document.getElementById("resultsTable");
    let head = document.getElementById("resultsTableHead");
    if (!table || !head) return;

    table.innerHTML = "";
    head.innerHTML = "";

    let examId = Number(document.getElementById("examSelect").value);
    if (!examId) {
        head.innerHTML = `<tr><th>Student</th><th>Total</th><th>%</th><th>Grade</th><th>Result</th></tr>`;
        table.innerHTML = `<tr><td colspan="5" class="empty">Create an exam first.</td></tr>`;
        return;
    }

    if (!results[examId]) results[examId] = {};
    let list = getResultStudents();

    if (list.length === 0) {
        head.innerHTML = `<tr><th>Student</th><th>Total</th><th>%</th><th>Grade</th><th>Result</th></tr>`;
        table.innerHTML = `<tr><td colspan="5" class="empty">No students found.</td></tr>`;
        return;
    }

    if (selectedResultStudentId) {
        renderResultStudentDetail(examId, selectedResultStudentId);
        return;
    }

    if (resultsView === "summary") {
        head.innerHTML = `<tr><th>Student</th><th>Total /100</th><th>%</th><th>Grade</th><th>Result</th></tr>`;
        list.forEach(s => {
            if (!results[examId][s.id]) {
                results[examId][s.id] = { english: 0, nepali: 0, math: 0, science: 0 };
            }
            let r = results[examId][s.id];
            let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
            let percentage = total;
            let grade = getGrade(percentage);
            let pass = Number(r.english || 0) >= 10 && Number(r.nepali || 0) >= 10 && Number(r.math || 0) >= 10 && Number(r.science || 0) >= 10;

            let row = document.createElement("tr");
            row.innerHTML = `
                <td>
                    <div class="result-student-summary" onclick="openResultStudent(${s.id})">
                        ${studentPhotoHTML(s)}
                        <div>
                            <b>${escapeHTML(s.name)}</b>
                            <small>Roll ${escapeHTML(s.roll)}</small>
                        </div>
                    </div>
                </td>
                <td><b>${total}/100</b></td>
                <td>${percentage.toFixed(1)}%</td>
                <td class="${grade === "F" ? "grade-fail" : "grade-good"}"><b>${grade}</b></td>
                <td class="${pass ? "present" : "absent"}">${pass ? "PASS" : "FAIL"}</td>
            `;
            table.appendChild(row);
        });
        return;
    }

    head.innerHTML = `<tr><th>Student</th><th>English /25</th><th>Nepali /25</th><th>Math /25</th><th>Science /25</th><th>Total /100</th><th>%</th><th>Grade</th><th>Result</th></tr>`;
    list.forEach(s => {
        if (!results[examId][s.id]) {
            results[examId][s.id] = { english: 0, nepali: 0, math: 0, science: 0 };
        }
        let r = results[examId][s.id];
        let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
        let percentage = total;
        let grade = getGrade(percentage);
        let pass = Number(r.english || 0) >= 10 && Number(r.nepali || 0) >= 10 && Number(r.math || 0) >= 10 && Number(r.science || 0) >= 10;

        table.innerHTML += `
            <tr data-student-id="${s.id}">
                <td>${studentPhotoHTML(s)} <b>${escapeHTML(s.name)}</b></td>
                <td><input class="marks-input" type="number" min="0" max="25" value="${r.english}" onchange="updateMark(${examId}, ${s.id}, 'english', this.value, this)"></td>
                <td><input class="marks-input" type="number" min="0" max="25" value="${r.nepali}" onchange="updateMark(${examId}, ${s.id}, 'nepali', this.value, this)"></td>
                <td><input class="marks-input" type="number" min="0" max="25" value="${r.math}" onchange="updateMark(${examId}, ${s.id}, 'math', this.value, this)"></td>
                <td><input class="marks-input" type="number" min="0" max="25" value="${r.science}" onchange="updateMark(${examId}, ${s.id}, 'science', this.value, this)"></td>
                <td><b>${total}/100</b></td>
                <td>${percentage.toFixed(1)}%</td>
                <td class="${grade === "F" ? "grade-fail" : "grade-good"}"><b>${grade}</b></td>
                <td class="${pass ? "present" : "absent"}">${pass ? "PASS" : "FAIL"}</td>
            </tr>
        `;
    });
}

function openResultStudent(studentId) {
    selectedResultStudentId = studentId;
    renderResults();
}

function renderResultStudentDetail(examId, studentId) {
    let table = document.getElementById("resultsTable");
    let head = document.getElementById("resultsTableHead");
    let student = students.find(s => s.id === studentId);

    if (!student) {
        selectedResultStudentId = null;
        renderResults();
        return;
    }

    if (!results[examId][studentId]) {
        results[examId][studentId] = { english: 0, nepali: 0, math: 0, science: 0 };
    }

    let r = results[examId][studentId];
    let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
    let percentage = total;
    let grade = getGrade(percentage);
    let pass = Number(r.english || 0) >= 10 && Number(r.nepali || 0) >= 10 && Number(r.math || 0) >= 10 && Number(r.science || 0) >= 10;

    head.innerHTML = `<tr><th colspan="2">Student Result</th></tr>`;
    table.innerHTML = `
        <tr>
            <td colspan="2">
                <div class="result-detail-header">
                    <button class="result-back-button" onclick="closeResultStudentDetail()">← Back</button>
                    <div class="result-detail-student">
                        ${studentPhotoHTML(student)}
                        <div>
                            <h3>${escapeHTML(student.name)}</h3>
                            <p>Class ${escapeHTML(student.className)} • Roll ${escapeHTML(student.roll)} • Group ${escapeHTML(student.group)}</p>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
        <tr><td>English</td><td><input class="marks-input" type="number" min="0" max="25" value="${r.english}" onchange="updateMark(${examId}, ${studentId}, 'english', this.value, this)"> <span>/25</span></td></tr>
        <tr><td>Nepali</td><td><input class="marks-input" type="number" min="0" max="25" value="${r.nepali}" onchange="updateMark(${examId}, ${studentId}, 'nepali', this.value, this)"> <span>/25</span></td></tr>
        <tr><td>Math</td><td><input class="marks-input" type="number" min="0" max="25" value="${r.math}" onchange="updateMark(${examId}, ${studentId}, 'math', this.value, this)"> <span>/25</span></td></tr>
        <tr><td>Science</td><td><input class="marks-input" type="number" min="0" max="25" value="${r.science}" onchange="updateMark(${examId}, ${studentId}, 'science', this.value, this)"> <span>/25</span></td></tr>
        <tr><td><b>Total</b></td><td><b>${total}/100</b></td></tr>
        <tr><td>Percentage</td><td>${percentage.toFixed(1)}%</td></tr>
        <tr><td>Grade</td><td class="${grade === "F" ? "grade-fail" : "grade-good"}"><b>${grade}</b></td></tr>
        <tr><td>Result</td><td class="${pass ? "present" : "absent"}"><b>${pass ? "PASS" : "FAIL"}</b></td></tr>
    `;
}

function closeResultStudentDetail() {
    selectedResultStudentId = null;
    renderResults();
}

function refreshResultDetail(examId, studentId) {
    if (selectedResultStudentId === studentId) renderResultStudentDetail(examId, studentId);
}

async function updateMark(examId, studentId, subject, value, input) {
    let mark = Number(value);
    if (isNaN(mark)) mark = 0;
    mark = Math.max(0, Math.min(25, mark));

    if (!results[examId]) results[examId] = {};
    if (!results[examId][studentId]) {
        results[examId][studentId] = { english: 0, nepali: 0, math: 0, science: 0 };
    }

    results[examId][studentId][subject] = mark;
    let result = results[examId][studentId];
    let total = Number(result.english || 0) + Number(result.nepali || 0) + Number(result.math || 0) + Number(result.science || 0);
    result.total = total;

    const { data: existing } = await supabaseClient
        .from("results")
        .select("*")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .maybeSingle();

    let resultData = {
        english: Number(result.english || 0),
        nepali: Number(result.nepali || 0),
        maths: Number(result.math || 0),
        science: Number(result.science || 0),
        total: total
    };

    if (existing) {
        const { error } = await supabaseClient.from("results").update(resultData).eq("id", existing.id);
        if (error) return alert("Could not update result.");
    } else {
        const { error } = await supabaseClient.from("results").insert({ student_id: studentId, exam_id: examId, ...resultData });
        if (error) return alert("Could not save result.");
    }

    saveAll();

    if (selectedResultStudentId === studentId) {
        refreshResultDetail(examId, studentId);
    } else {
        updateResultRow(examId, studentId);
    }
}

function updateResultRow(examId, studentId) {
    let row = document.querySelector(`tr[data-student-id="${studentId}"]`);
    if (!row) return;

    let r = results[examId][studentId];
    let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
    let percentage = total;
    let grade = getGrade(percentage);
    let pass = Number(r.english || 0) >= 10 && Number(r.nepali || 0) >= 10 && Number(r.math || 0) >= 10 && Number(r.science || 0) >= 10;

    row.cells[5].innerHTML = `<b>${total}/100</b>`;
    row.cells[6].innerText = percentage.toFixed(1) + "%";
    row.cells[7].innerHTML = `<b>${grade}</b>`;
    row.cells[7].className = grade === "F" ? "grade-fail" : "grade-good";
    row.cells[8].innerText = pass ? "PASS" : "FAIL";
    row.cells[8].className = pass ? "present" : "absent";
}

/* =====================================================
   STUDENT HISTORY SEARCH
===================================================== */

function searchHistoryStudents() {
    let search = document.getElementById("historySearch").value.trim().toLowerCase();
    let container = document.getElementById("historySearchResults");

    if (!search) {
        container.innerHTML = `<div class="empty">Start typing to search students.</div>`;
        return;
    }

    let matches = students.filter(s =>
        String(s.name || "").toLowerCase().includes(search) ||
        String(s.roll || "").toLowerCase().includes(search) ||
        String(s.className || "").toLowerCase().includes(search) ||
        String(s.parent || "").toLowerCase().includes(search) ||
        String(s.phone || "").toLowerCase().includes(search) ||
        String(s.group || "").toLowerCase().includes(search)
    );

    if (matches.length === 0) {
        container.innerHTML = `<div class="empty">❌ No matching student found.</div>`;
        return;
    }

    container.innerHTML = "";
    matches.slice(0, 50).forEach(student => {
        let item = document.createElement("div");
        item.className = "history-student-item";
        if (selectedHistoryStudentId === student.id) item.classList.add("active");

        let photoHTML = student.photo
            ? `<img src="${student.photo}" alt="${escapeHTML(student.name)}">`
            : `<div class="history-avatar">👤</div>`;

        item.innerHTML = `
            ${photoHTML}
            <div class="history-student-info">
                <strong>${escapeHTML(student.name)}</strong>
                <span>Class ${escapeHTML(student.className)} • Roll ${escapeHTML(student.roll)} • Group ${escapeHTML(student.group)}</span>
            </div>
        `;
        item.onclick = () => selectHistoryStudent(student.id);
        container.appendChild(item);
    });
}

function selectHistoryStudent(id) {
    selectedHistoryStudentId = id;
    let student = students.find(s => s.id === id);
    if (!student) return;

    document.getElementById("historySearch").value = student.name;
    let selected = document.getElementById("historySelected");
    selected.style.display = "block";
    selected.innerHTML = "👤 Selected: <b>" + escapeHTML(student.name) + "</b> — Class " + escapeHTML(student.className) + ", Roll " + escapeHTML(student.roll) + ", Group " + escapeHTML(student.group);

    searchHistoryStudents();
    renderStudentHistory();
}

function renderStudentHistory() {
    let content = document.getElementById("studentHistoryContent");
    if (!content) return;

    if (!selectedHistoryStudentId) {
        content.innerHTML = `<div class="panel"><div class="empty">🔎 Search for a student above to view their complete history.</div></div>`;
        return;
    }

    let student = students.find(s => s.id === Number(selectedHistoryStudentId));
    if (!student) {
        content.innerHTML = "";
        return;
    }

    let present = 0, absent = 0;
    let attendanceRows = "";

    Object.keys(attendance).sort().reverse().forEach(date => {
        let status = attendance[date][student.id];
        if (!status) return;
        if (status === "present") present++;
        if (status === "absent") absent++;

        attendanceRows += `
            <tr>
                <td>${date}</td>
                <td class="${status === "present" ? "present" : "absent"}">${status === "present" ? "Present ✓" : "Absent ✗"}</td>
            </tr>
        `;
    });

    let totalAttendance = present + absent;
    let attendancePercent = totalAttendance === 0 ? 0 : (present / totalAttendance) * 100;

    let feeRows = "";
    fees.filter(f => f.studentId === student.id).slice().reverse().forEach(f => {
        feeRows += `
            <tr>
                <td>${f.month}</td>
                <td>Rs. ${f.amount}</td>
                <td class="paid">Paid</td>
                <td>${f.paidDate}</td>
            </tr>
        `;
    });

    let examRows = "";
    exams.slice().reverse().forEach(exam => {
        let r = results[exam.id] ? results[exam.id][student.id] : null;
        if (!r) return;

        let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
        let percentage = total;
        let grade = getGrade(percentage);
        let pass = Number(r.english || 0) >= 10 && Number(r.nepali || 0) >= 10 && Number(r.math || 0) >= 10 && Number(r.science || 0) >= 10;

        examRows += `
            <tr>
                <td>${escapeHTML(exam.name)}</td>
                <td>${exam.date}</td>
                <td>${total}/100</td>
                <td>${percentage.toFixed(1)}%</td>
                <td><span class="${grade === "F" ? "grade-fail" : "grade-good"}"><b>${grade}</b></span></td>
                <td class="${pass ? "present" : "absent"}">${pass ? "PASS" : "FAIL"}</td>
            </tr>
        `;
    });

    let totalFees = fees.filter(f => f.studentId === student.id).reduce((sum, f) => sum + Number(f.amount || 0), 0);
    let examsTaken = 0, percentageTotal = 0;

    exams.forEach(exam => {
        let r = results[exam.id] ? results[exam.id][student.id] : null;
        if (!r) return;
        let total = Number(r.english || 0) + Number(r.nepali || 0) + Number(r.math || 0) + Number(r.science || 0);
        examsTaken++;
        percentageTotal += total;
    });

    let averagePercentage = examsTaken === 0 ? 0 : percentageTotal / examsTaken;

    content.innerHTML = `
        <div class="panel">
            <div class="student-profile">
                ${studentPhotoHTML(student, "student-photo-large")}
                <div>
                    <h3>${escapeHTML(student.name)}</h3>
                    <p class="small">Class ${escapeHTML(student.className)} | Group ${escapeHTML(student.group)} | Roll ${escapeHTML(student.roll)}</p>
                    <p class="small">Parent: ${escapeHTML(student.parent || "Not provided")}<br>Phone: ${escapeHTML(student.phone || "Not provided")}<br>Joined: ${escapeHTML(student.joined || "Not available")}</p>
                </div>
            </div>
        </div>

        <div class="history-summary-grid">
            <div class="history-summary-card"><div class="history-summary-icon">📅</div><div><span>Attendance</span><strong>${attendancePercent.toFixed(1)}%</strong></div></div>
            <div class="history-summary-card"><div class="history-summary-icon">💰</div><div><span>Total Fees</span><strong>Rs. ${totalFees}</strong></div></div>
            <div class="history-summary-card"><div class="history-summary-icon">📝</div><div><span>Exams Taken</span><strong>${examsTaken}</strong></div></div>
            <div class="history-summary-card"><div class="history-summary-icon">📊</div><div><span>Average</span><strong>${averagePercentage.toFixed(1)}%</strong></div></div>
        </div>

        <div class="panel">
            <h3>📅 Attendance Summary</h3>
            <p>Present: <b class="present">${present}</b> | Absent: <b class="absent">${absent}</b> | Total: <b>${totalAttendance}</b> | Percentage: <b>${attendancePercent.toFixed(1)}%</b></p>
            <table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${attendanceRows || '<tr><td colspan="2" class="empty">No attendance recorded.</td></tr>'}</tbody></table>
        </div>

        <div class="panel">
            <h3>💰 Fee History</h3>
            <table><thead><tr><th>Month</th><th>Amount</th><th>Status</th><th>Paid Date</th></tr></thead><tbody>${feeRows || '<tr><td colspan="4" class="empty">No fee records.</td></tr>'}</tbody></table>
        </div>

        <div class="panel">
            <h3>📝 Exam History</h3>
            <table><thead><tr><th>Exam</th><th>Date</th><th>Total</th><th>Percentage</th><th>Grade</th><th>Result</th></tr></thead><tbody>${examRows || '<tr><td colspan="6" class="empty">No exam results.</td></tr>'}</tbody></table>
        </div>
    `;
}

/* =====================================================
   DASHBOARD MANAGEMENT
===================================================== */

function renderDashboard() {
    let totalElement = document.getElementById("totalStudents");
    if (!totalElement) return;

    totalElement.innerText = students.length;

    let groupACount = students.filter(s => s.group === "A").length;
    let groupBCount = students.filter(s => s.group === "B").length;
    let groupCCount = students.filter(s => s.group === "C").length;

    if (document.getElementById("groupA")) document.getElementById("groupA").innerText = groupACount;
    if (document.getElementById("groupB")) document.getElementById("groupB").innerText = groupBCount;
    if (document.getElementById("groupC")) document.getElementById("groupC").innerText = groupCCount;

    let todayData = attendance[today()] || {};
    let present = Object.values(todayData).filter(v => v === "present").length;
    let absent = Object.values(todayData).filter(v => v === "absent").length;

    if (document.getElementById("presentToday")) document.getElementById("presentToday").innerText = present;
    if (document.getElementById("absentToday")) document.getElementById("absentToday").innerText = absent;

    let totalFees = fees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
    if (document.getElementById("dashboardTotalFees")) document.getElementById("dashboardTotalFees").innerText = "Rs. " + totalFees;
    if (document.getElementById("dashboardTotalExams")) document.getElementById("dashboardTotalExams").innerText = exams.length;

    let overallPresent = 0, overallAbsent = 0;
    Object.values(attendance).forEach(day => {
        Object.values(day).forEach(status => {
            if (status === "present") overallPresent++;
            if (status === "absent") overallAbsent++;
        });
    });

    let totalAttendance = overallPresent + overallAbsent;
    let overallPercentage = totalAttendance === 0 ? 0 : (overallPresent / totalAttendance) * 100;

    if (document.getElementById("dashboardAttendance")) {
        document.getElementById("dashboardAttendance").innerText = overallPercentage.toFixed(1) + "%";
    }

    let studentsWithRecords = new Set();
    Object.values(attendance).forEach(day => Object.keys(day).forEach(id => studentsWithRecords.add(Number(id))));
    fees.forEach(fee => studentsWithRecords.add(Number(fee.studentId)));
    Object.values(results).forEach(res => Object.keys(res).forEach(id => studentsWithRecords.add(Number(id))));

    if (document.getElementById("dashboardStudentsWithRecords")) {
        document.getElementById("dashboardStudentsWithRecords").innerText = studentsWithRecords.size;
    }

    let table = document.getElementById("dashboardStudents");
    if (!table) return;
    table.innerHTML = "";

    students.slice(-10).reverse().forEach(s => {
        table.innerHTML += `
            <tr>
                <td>${studentPhotoHTML(s, "dashboard-photo")} <b>${escapeHTML(s.name)}</b></td>
                <td>${escapeHTML(s.className)}</td>
                <td>${escapeHTML(s.group)}</td>
                <td>${escapeHTML(s.roll)}</td>
            </tr>
        `;
    });
}

/* =====================================================
   BACKUP & RESTORE PIPELINE
===================================================== */

async function exportData() {
    try {
        const [studentsRes, attendanceRes, feesRes, examsRes, resultsRes, groupsRes] = await Promise.all([
            supabaseClient.from("students").select("*"),
            supabaseClient.from("attendance").select("*"),
            supabaseClient.from("fees").select("*"),
            supabaseClient.from("exams").select("*"),
            supabaseClient.from("results").select("*"),
            supabaseClient.from("groups").select("*").order("id", { ascending: true })
        ]);

        if (studentsRes.error) throw studentsRes.error;
        if (attendanceRes.error) throw attendanceRes.error;
        if (feesRes.error) throw feesRes.error;
        if (examsRes.error) throw examsRes.error;
        if (resultsRes.error) throw resultsRes.error;
        if (groupsRes.error) throw groupsRes.error;

        let backup = {
            students: studentsRes.data || [],
            attendance: attendanceRes.data || [],
            fees: feesRes.data || [],
            exams: examsRes.data || [],
            results: resultsRes.data || [],
            groups: groupsRes.data || [],
            backupDate: new Date().toISOString()
        };

        let blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "rampur-free-tuition-backup-" + today() + ".json";
        a.click();
        URL.revokeObjectURL(url);

        alert("Cloud backup downloaded successfully.");
    } catch (error) {
        console.error("BACKUP ERROR:", error);
        alert("Could not create backup:\n" + error.message);
    }
}

async function importData() {
    let fileInput = document.getElementById("importFile");
    let file = fileInput ? fileInput.files[0] : null;

    if (!file) return alert("Please select a backup file first.");

    let reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let data = JSON.parse(e.target.result);

            if (
                !data ||
                !Array.isArray(data.students) ||
                !Array.isArray(data.attendance) ||
                !Array.isArray(data.fees) ||
                !Array.isArray(data.exams) ||
                !Array.isArray(data.results)
            ) {
                return alert("Invalid backup file structure.");
            }

            if (!confirm("⚠️ Importing this file will overwrite existing records in Supabase. Proceed?")) {
                return;
            }

            // Clean up existing tables
            await supabaseClient.from("results").delete().neq("id", 0);
            await supabaseClient.from("attendance").delete().neq("id", 0);
            await supabaseClient.from("fees").delete().neq("id", 0);
            await supabaseClient.from("students").delete().neq("id", 0);
            await supabaseClient.from("exams").delete().neq("id", 0);
            if (data.groups) await supabaseClient.from("groups").delete().neq("id", 0);

            // Re-populate tables
            if (data.groups && data.groups.length > 0) await supabaseClient.from("groups").insert(data.groups);
            if (data.students.length > 0) await supabaseClient.from("students").insert(data.students);
            if (data.exams.length > 0) await supabaseClient.from("exams").insert(data.exams);
            if (data.attendance.length > 0) await supabaseClient.from("attendance").insert(data.attendance);
            if (data.fees.length > 0) await supabaseClient.from("fees").insert(data.fees);
            if (data.results.length > 0) await supabaseClient.from("results").insert(data.results);

            await initApp();
            alert("✅ Database restored successfully!");
        } catch (error) {
            console.error("IMPORT ERROR:", error);
            alert("Could not import data:\n" + error.message);
        }
    };
    reader.readAsText(file);
}

/* =====================================================
   APP BOOTSTRAP PIPELINE
===================================================== */

async function initApp() {
    try {
        await openOfflineDatabase();
        await loadGroupsFromSupabase();
        await loadStudentsFromSupabase();
        await loadAttendanceFromSupabase();
        await loadFeesFromSupabase();
        await loadExamsFromSupabase();
        await loadResultsFromSupabase();
    } catch (e) {
        console.error("App initialization warning:", e);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

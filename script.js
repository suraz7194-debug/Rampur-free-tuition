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
   ADMIN LOGIN
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

    const { data, error } =
        await supabaseClient.auth.signInWithPassword({
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


/* =====================================================
   CHECK ADMIN SESSION
===================================================== */

async function checkAdminSession() {

    const { data: { session } } =
        await supabaseClient.auth.getSession();

    if (session) {
        document.getElementById("loginScreen").style.display = "none";
    }
}

checkAdminSession();


/* =====================================================
   ADMIN LOGOUT
===================================================== */

async function adminLogout() {

    const { error } =
        await supabaseClient.auth.signOut();

    if (error) {
        console.error("Logout error:", error);
        return;
    }

    document.getElementById("loginMessage").innerText = "";

    document.getElementById("loginScreen").style.display = "flex";
}


/* =====================================================
   DATA
===================================================== */

let students = [];

async function loadStudentsFromSupabase() {
    const { data, error } = await supabaseClient
        .from("students")
        .select("*")
        .order("id", { ascending: true });

    if (error) {

    console.error(
        "SUPABASE LOAD ERROR:",
        error
    );

    console.log(
        "Loading students from offline database..."
    );

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
async function saveStudentsToOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "students",
                "readwrite"
            );

        const store =
            transaction.objectStore(
                "students"
            );

        students.forEach(student => {

            store.put(student);

        });

        transaction.oncomplete = function(){

            console.log(
                "Students saved to offline database."
            );

            resolve();

        };

        transaction.onerror = function(){

            console.error(
                "Could not save students offline:",
                transaction.error
            );

            reject(
                transaction.error
            );

        };

    });

}
async function loadStudentsFromOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "students",
                "readonly"
            );

        const store =
            transaction.objectStore(
                "students"
            );

        const request =
            store.getAll();

        request.onsuccess = function(){

            students =
                request.result || [];

            console.log(
                "Students loaded from offline database."
            );

            renderAll();

            resolve();

        };

        request.onerror = function(){

            console.error(
                "Could not load students offline:",
                request.error
            );

            reject(
                request.error
            );

        };

    });

}

let attendance = {};

async function loadAttendanceFromSupabase(){

    const { data, error } =
        await supabaseClient
        .from("attendance")
        .select("*")
        .order("date", { ascending: true });


    if(error){

        console.error(
            "SUPABASE ATTENDANCE LOAD ERROR:",
            error
        );

        alert(
            "Could not load attendance from Supabase."
        );

        return;

    }


    attendance = {};


    data.forEach(row => {

        if(!attendance[row.date]){

            attendance[row.date] = {};

        }


        attendance[row.date][row.student_id] =
            row.status;

    });


    renderAttendance();
renderMonthlyAttendance();
renderDashboard();

await saveAttendanceToOfflineDB();

}
async function saveAttendanceToOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "attendance",
                "readwrite"
            );

        const store =
            transaction.objectStore(
                "attendance"
            );

        Object.keys(attendance).forEach(date => {

            Object.keys(attendance[date]).forEach(studentId => {

                store.put({

                    id:
                        date + "_" + studentId,

                    date:
                        date,

                    student_id:
                        Number(studentId),

                    status:
                        attendance[date][studentId]

                });

            });

        });

        transaction.oncomplete = function(){

            console.log(
                "Attendance saved to offline database."
            );

            resolve();

        };

        transaction.onerror = function(){

            console.error(
                "Could not save attendance offline:",
                transaction.error
            );

            reject(
                transaction.error
            );

        };

    });

}

let fees = [];

async function loadFeesFromSupabase(){

    const { data, error } =
        await supabaseClient
        .from("fees")
        .select("*")
        .order("date", { ascending: true });


    if(error){

        console.error(
            "SUPABASE FEES LOAD ERROR:",
            error
        );

        alert(
            "Could not load fees from Supabase."
        );

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
async function saveFeesToOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "fees",
                "readwrite"
            );

        const store =
            transaction.objectStore(
                "fees"
            );

        fees.forEach(fee => {

            store.put({

                id:
                    fee.id,

                student_id:
                    fee.studentId,

                month:
                    fee.month,

                amount:
                    Number(fee.amount),

                date:
                    fee.paidDate

            });

        });

        transaction.oncomplete = function(){

            console.log(
                "Fees saved to offline database."
            );

            resolve();

        };

        transaction.onerror = function(){

            console.error(
                "Could not save fees offline:",
                transaction.error
            );

            reject(
                transaction.error
            );

        };

    });

}

let exams = [];

async function loadExamsFromSupabase(){

    const { data, error } =
        await supabaseClient
        .from("exams")
        .select("*")
        .order("date", { ascending: true });


    if(error){

        console.error(
            "SUPABASE EXAMS LOAD ERROR:",
            error
        );

        alert(
            "Could not load exams from Supabase."
        );

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
async function saveExamsToOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "exams",
                "readwrite"
            );

        const store =
            transaction.objectStore(
                "exams"
            );

        exams.forEach(exam => {

            store.put({

                id:
                    exam.id,

                exam_name:
                    exam.name,

                date:
                    exam.date

            });

        });

        transaction.oncomplete = function(){

            console.log(
                "Exams saved to offline database."
            );

            resolve();

        };

        transaction.onerror = function(){

            console.error(
                "Could not save exams offline:",
                transaction.error
            );

            reject(
                transaction.error
            );

        };

    });

}

let results = {};

async function loadResultsFromSupabase(){

    const { data, error } =
        await supabaseClient
        .from("results")
        .select("*");


    if(error){

        console.error(
            "SUPABASE RESULTS LOAD ERROR:",
            error
        );

        alert(
            "Could not load results from Supabase."
        );

        return;

    }


    results = {};


    data.forEach(row => {

        if(!results[row.exam_id]){

            results[row.exam_id] = {};

        }


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
async function saveResultsToOfflineDB(){

    if(!offlineDB)
        return;

    return new Promise((resolve, reject) => {

        const transaction =
            offlineDB.transaction(
                "results",
                "readwrite"
            );

        const store =
            transaction.objectStore(
                "results"
            );

        Object.keys(results).forEach(examId => {

            Object.keys(results[examId]).forEach(studentId => {

                const result =
                    results[examId][studentId];

                store.put({

                    id:
                        String(examId) +
                        "_" +
                        String(studentId),

                    exam_id:
                        Number(examId),

                    student_id:
                        Number(studentId),

                    english:
                        Number(result.english || 0),

                    nepali:
                        Number(result.nepali || 0),

                    maths:
                        Number(result.math || 0),

                    science:
                        Number(result.science || 0),

                    total:
                        Number(result.total || 0)

                });

            });

        });

        transaction.oncomplete = function(){

            console.log(
                "Results saved to offline database."
            );

            resolve();

        };

        transaction.onerror = function(){

            console.error(
                "Could not save results offline:",
                transaction.error
            );

            reject(
                transaction.error
            );

        };

    });

}


/*
   NEW GROUP SYSTEM

   If old data already exists,
   Group A, B and C are automatically created.
*/

let groups = [];
let groupIds = {};

let studentGroup = "A";

let attendanceGroup = "A";

let resultGroup = "A";

async function loadGroupsFromSupabase(){

    const { data, error } =
        await supabaseClient
        .from("groups")
        .select("*")
        .order("id", { ascending: true });


    if(error){

        console.error(
            "SUPABASE GROUPS LOAD ERROR:",
            error
        );

        alert(
            "Could not load groups from Supabase:\n" +
            error.message
        );

        return;

    }


    groupIds = {};

data.forEach(row => {

    let name =
        String(row.name).trim();

    if(name){
        groupIds[name] = row.id;
    }

});

groups =
    data
    .map(row => String(row.name).trim())
    .filter(Boolean);


    if(groups.length === 0){

        groups = ["A"];

    }


    studentGroup =
        groups.includes(studentGroup)
            ? studentGroup
            : groups[0];

    attendanceGroup =
        groups.includes(attendanceGroup)
            ? attendanceGroup
            : groups[0];

    resultGroup =
        groups.includes(resultGroup)
            ? resultGroup
            : groups[0];


    renderAll();

await saveGroupsToOfflineDB();

}
function openOfflineDatabase(){

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(
            OFFLINE_DB_NAME,
            OFFLINE_DB_VERSION
        );

        request.onupgradeneeded = function(event){

            const db = event.target.result;

            if(!db.objectStoreNames.contains("students")){
                db.createObjectStore("students", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("groups")){
                db.createObjectStore("groups", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("attendance")){
                db.createObjectStore("attendance", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("fees")){
                db.createObjectStore("fees", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("exams")){
                db.createObjectStore("exams", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("results")){
                db.createObjectStore("results", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("syncQueue")){
                db.createObjectStore("syncQueue", {
                    keyPath: "queueId",
                    autoIncrement: true
                });
            }

        };

        request.onsuccess = function(event){

            offlineDB = event.target.result;

            console.log(
                "Offline database ready."
            );

            resolve(offlineDB);

        };

        request.onerror = function(){

            console.error(
                "Offline database error:",
                request.error
            );

            reject(request.error);

        };

    });

}


let selectedStudentPhoto = "";

let selectedEditPhoto = "";

let selectedHistoryStudentId = null;


/* =====================================================
   SAVE ALL
===================================================== */

function saveAll(){

    // Supabase is now the permanent database.
    // No localStorage backup is needed here.

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

    let d = new Date();

    return d.toISOString().split("T")[0];

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
                        onclick="editGroup(${groupId})">
                        ✏️
                        <span>Edit Group</span>
                    </button>

                    <button
                        class="delete-option"
                        onclick="deleteGroup(${groupId})">
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

async function addGroup(){

    let input =
        document.getElementById(
            "newGroupName"
        );

    let name =
        input.value.trim();


    if(!name){

        alert(
            "Please enter a group name."
        );

        return;

    }


    /* Check duplicate */

    let exists =
        groups.some(
            g =>
                g.toLowerCase() ===
                name.toLowerCase()
        );


    if(exists){

        alert(
            "This group already exists."
        );

        return;

    }


    /* =========================
       SAVE GROUP TO SUPABASE
    ========================= */

    const { data, error } =
        await supabaseClient
        .from("groups")
        .insert({

            name: name

        })
        .select()
        .single();


    if(error){

        console.error(
            "SUPABASE GROUP INSERT ERROR:",
            error
        );

        alert(
            "Could not add group:\n" +
            error.message
        );

        return;

    }


    /* =========================
       UPDATE LOCAL STATE
    ========================= */

    groups.push(
        data.name
    );
groupIds[data.name] = data.id;

    studentGroup =
        data.name;

    attendanceGroup =
        data.name;

    resultGroup =
        data.name;


    input.value = "";


    renderAll();


    alert(
        "Group '" +
        data.name +
        "' added successfully."
    );

}


/* =========================
   EDIT GROUP
========================= */
async function editGroup(groupId){

    /* Find group by Supabase ID */
    let oldName =
        Object.keys(groupIds)
        .find(
            name =>
                String(groupIds[name]) ===
                String(groupId)
        );

    if(!oldName){
        alert(
            "Group not found."
        );
        return;
    }


    let newName =
        prompt(
            "Enter new name for group:",
            oldName
        );


    if(newName === null)
        return;


    newName =
        newName.trim();


    if(!newName){

        alert(
            "Group name cannot be empty."
        );

        return;

    }


    /* Check duplicate */

    let duplicate =
        groups.some(
            g =>
                g !== oldName &&
                g.toLowerCase() ===
                newName.toLowerCase()
        );


    if(duplicate){

        alert(
            "A group with this name already exists."
        );

        return;

    }


    /* =========================
       UPDATE STUDENTS
    ========================= */

    let response =
        await supabaseClient
        .from("students")
        .update({
            group: newName
        })
        .eq("group", oldName);


    if(response.error){

        console.error(
            "SUPABASE STUDENT GROUP UPDATE ERROR:",
            response.error
        );

        alert(
            "Could not update students:\n" +
            response.error.message
        );

        return;

    }


    /* =========================
       UPDATE GROUP BY ID
    ========================= */

    response =
        await supabaseClient
        .from("groups")
        .update({
            name: newName
        })
        .eq("id", groupId);


    if(response.error){

        console.error(
            "SUPABASE GROUP UPDATE ERROR:",
            response.error
        );

        /* Try to move students back */

        await supabaseClient
        .from("students")
        .update({
            group: oldName
        })
        .eq("group", newName);


        alert(
            "Could not rename group:\n" +
            response.error.message
        );

        return;

    }


    /* =========================
       UPDATE LOCAL STUDENTS
    ========================= */

    students.forEach(student => {

        if(student.group === oldName){

            student.group =
                newName;

        }

    });


    /* =========================
       UPDATE LOCAL GROUP LIST
    ========================= */

    let index =
        groups.indexOf(oldName);


    if(index !== -1){

        groups[index] =
            newName;

    }


    /* Update ID mapping */

    delete groupIds[oldName];

    groupIds[newName] =
        groupId;


    /* =========================
       UPDATE SELECTED GROUPS
    ========================= */

    if(studentGroup === oldName)
        studentGroup = newName;

    if(attendanceGroup === oldName)
        attendanceGroup = newName;

    if(resultGroup === oldName)
        resultGroup = newName;


    renderAll();


    alert(
        "✅ Group renamed successfully."
    );

}

/* =========================
   DELETE GROUP
========================= */
async function deleteGroup(groupId){

    /* Find group name from Supabase ID */

    let group =
        Object.keys(groupIds)
        .find(
            name =>
                String(groupIds[name]) ===
                String(groupId)
        );


    if(!group){

        alert(
            "Group not found."
        );

        return;

    }


    if(groups.length <= 1){

        alert(
            "You must keep at least one group."
        );

        return;

    }


    let studentCount =
        students.filter(
            s => s.group === group
        ).length;


    let message =
        "Delete group '" +
        group +
        "'?";


    if(studentCount > 0){

        message +=
            "\n\nThis group has " +
            studentCount +
            " student(s)." +
            "\nDeleting the group will move those students to another group.";

    }


    if(!confirm(message))
        return;


    /* =========================
       CHOOSE REPLACEMENT
    ========================= */

    let replacement =
        groups.find(
            g => g !== group
        );


    /* =========================
       MOVE STUDENTS
    ========================= */

    if(studentCount > 0){

        let response =
            await supabaseClient
            .from("students")
            .update({
                group: replacement
            })
            .eq("group", group);


        if(response.error){

            console.error(
                "SUPABASE STUDENT GROUP MOVE ERROR:",
                response.error
            );

            alert(
                "Could not move students:\n" +
                response.error.message
            );

            return;

        }

    }


    /* =========================
       DELETE GROUP BY ID
    ========================= */

    const { error } =
        await supabaseClient
        .from("groups")
        .delete()
        .eq("id", groupId);


    if(error){

        console.error(
            "SUPABASE GROUP DELETE ERROR:",
            error
        );


        /* Try to move students back */

        if(studentCount > 0){

            await supabaseClient
            .from("students")
            .update({
                group: group
            })
            .eq("group", replacement);

        }


        alert(
            "Could not delete group:\n" +
            error.message
        );

        return;

    }


    /* =========================
       UPDATE LOCAL STUDENTS
    ========================= */

    if(studentCount > 0){

        students.forEach(student => {

            if(student.group === group){

                student.group =
                    replacement;

            }

        });

    }


    /* =========================
       REMOVE LOCAL GROUP
    ========================= */

    groups =
        groups.filter(
            g => g !== group
        );


    /* Remove ID mapping */

    delete groupIds[group];


    /* =========================
       FIX SELECTED GROUPS
    ========================= */

    if(studentGroup === group)
        studentGroup = replacement;

    if(attendanceGroup === group)
        attendanceGroup = replacement;

    if(resultGroup === group)
        resultGroup = replacement;


    renderAll();


    alert(
        "✅ Group deleted successfully.\n" +
        "Students were moved to " +
        replacement +
        "."
    );

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

async function addStudent(){

    let name =
        document.getElementById(
            "studentName"
        ).value.trim();

    let className =
        document.getElementById(
            "studentClass"
        ).value.trim();

    let roll =
        document.getElementById(
            "studentRoll"
        ).value.trim();

    let parent =
        document.getElementById(
            "parentName"
        ).value.trim();

    let phone =
        document.getElementById(
            "parentPhone"
        ).value.trim();

    let group =
        document.getElementById(
            "studentGroup"
        ).value;


    if(!name || !className || !roll){

        alert(
            "Please enter name, class and roll."
        );

        return;

    }


    if(!group){

        alert(
            "Please select a group."
        );

        return;

    }


    const { data, error } =
        await supabaseClient
        .from("students")
        .insert({

            name: name,
            class: className,
            roll: roll,
            parent: parent,
            phone: phone,
            group: group,
            date_joined: today(),
            photo: selectedStudentPhoto || ""

        })
        .select()
        .single();


    if(error){

        console.error(
            "Error adding student:",
            error
        );

        alert(
            "Could not save student to database."
        );

        return;

    }


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


    document.getElementById(
        "studentName"
    ).value = "";

    document.getElementById(
        "studentClass"
    ).value = "";

    document.getElementById(
        "studentRoll"
    ).value = "";

    document.getElementById(
        "parentName"
    ).value = "";

    document.getElementById(
        "parentPhone"
    ).value = "";

    document.getElementById(
        "studentPhoto"
    ).value = "";


    document.getElementById(
        "photoPreview"
    ).style.display = "none";

    document.getElementById(
        "photoPreview"
    ).src = "";


    selectedStudentPhoto = "";


    renderAll();


    alert(
        "Student added."
    );
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

async function saveStudentEdit(){

    let id =
        Number(
            document.getElementById(
                "editStudentId"
            ).value
        );


    let student =
        students.find(
            s => s.id === id
        );


    if(!student){

        alert(
            "Student not found."
        );

        return;

    }


    let name =
        document.getElementById(
            "editStudentName"
        ).value.trim();


    let className =
        document.getElementById(
            "editStudentClass"
        ).value.trim();


    let roll =
        document.getElementById(
            "editStudentRoll"
        ).value.trim();


    let parent =
        document.getElementById(
            "editParentName"
        ).value.trim();


    let phone =
        document.getElementById(
            "editParentPhone"
        ).value.trim();


    let group =
        document.getElementById(
            "editStudentGroup"
        ).value;


    if(!name || !className || !roll){

        alert(
            "Name, class and roll are required."
        );

        return;

    }


    let photo =
        student.photo || "";


    if(selectedEditPhoto){

        photo =
            selectedEditPhoto;

    }


    const { data, error } =
        await supabaseClient
        .from("students")
        .update({

            name: name,
            class: className,
            roll: roll,
            parent: parent,
            phone: phone,
            group: group,
            photo: photo

        })
        .eq("id", id)
        .select()
        .single();


    if(error){

        console.error(
            "SUPABASE UPDATE ERROR:",
            error
        );

        alert(
            "Could not update student in database."
        );

        return;

    }


    student.name =
        data.name;

    student.className =
        data.class;

    student.roll =
        data.roll;

    student.parent =
        data.parent;

    student.phone =
        data.phone;

    student.group =
        data.group;

    student.photo =
        data.photo || "";


    saveAll();


    selectedEditPhoto = "";


    document.getElementById(
        "editStudentBox"
    ).style.display =
        "none";


    renderAll();


    alert(
        "Student information updated successfully."
    );

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
onclick="editStudent(${s.id})">
✏️
<span>Edit Student</span>
</button>

<button
class="delete-option"
onclick="deleteStudent(${s.id})">
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
        "This will delete the student from the cloud database along with their attendance, fees and results."
    ))
        return;


    try{

        /* =========================
           DELETE RESULTS
        ========================= */

        let response =
            await supabaseClient
            .from("results")
            .delete()
            .eq("student_id", id);

        if(response.error)
            throw response.error;


        /* =========================
           DELETE ATTENDANCE
        ========================= */

        response =
            await supabaseClient
            .from("attendance")
            .delete()
            .eq("student_id", id);

        if(response.error)
            throw response.error;


        /* =========================
           DELETE FEES
        ========================= */

        response =
            await supabaseClient
            .from("fees")
            .delete()
            .eq("student_id", id);

        if(response.error)
            throw response.error;


        /* =========================
           DELETE STUDENT
        ========================= */

        response =
            await supabaseClient
            .from("students")
            .delete()
            .eq("id", id);

        if(response.error)
            throw response.error;


        /* =========================
           UPDATE LOCAL DATA
        ========================= */

        students =
            students.filter(
                s => s.id !== id
            );


        Object.keys(attendance)
        .forEach(date => {

            if(attendance[date]){

                delete attendance[date][id];

            }

        });


        fees =
            fees.filter(
                f => f.studentId !== id
            );


        Object.keys(results)
        .forEach(examId => {

            if(results[examId]){

                delete results[examId][id];

            }

        });


        if(
            selectedHistoryStudentId === id
        ){

            selectedHistoryStudentId =
                null;

        }


        saveAll();

        renderAll();


        alert(
            "✅ Student and all records deleted successfully."
        );

    }


    catch(error){

        console.error(
            "DELETE STUDENT ERROR:",
            error
        );


        alert(
            "❌ Could not delete student from cloud.\n\n" +
            error.message
        );

    }

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


    let list =
        students.filter(
            s => s.group === attendanceGroup
        );


    if(list.length === 0){

        table.innerHTML = `

<tr>

<td colspan="4"
class="empty">

No students in this group.

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

</td>

<td>${escapeHTML(s.className)}</td>

<td>${escapeHTML(s.roll)}</td>

<td>

<button
class="btn ${cls}"
onclick="toggleAttendance(
${s.id},
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

async function toggleAttendance(
    id,
    date
){

    if(!attendance[date])
        attendance[date] = {};


    let current =
        attendance[date][id];


    let newStatus;


    if(current === "present"){

        newStatus = "absent";

    }
    else{

        newStatus = "present";

    }


    const { data: existing, error: findError } =
        await supabaseClient
        .from("attendance")
        .select("*")
        .eq("student_id", id)
        .eq("date", date)
        .maybeSingle();


    if(findError){

        console.error(
            "ATTENDANCE FIND ERROR:",
            findError
        );

        alert(
            "Could not check attendance."
        );

        return;

    }


    if(existing){

        const { error } =
            await supabaseClient
            .from("attendance")
            .update({

                status: newStatus

            })
            .eq("id", existing.id);


        if(error){

            console.error(
                "ATTENDANCE UPDATE ERROR:",
                error
            );

            alert(
                "Could not update attendance."
            );

            return;

        }

    }
    else{

        const { error } =
            await supabaseClient
            .from("attendance")
            .insert({

                student_id: id,
                date: date,
                status: newStatus

            });


        if(error){

            console.error(
                "ATTENDANCE INSERT ERROR:",
                error
            );

            alert(
                "Could not save attendance."
            );

            return;

        }

    }


    // Update local memory after Supabase succeeds

    attendance[date][id] =
        newStatus;


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

async function addFee(){

    let studentId =
        Number(
            document.getElementById(
                "feeStudent"
            ).value
        );


    let month =
        document.getElementById(
            "feeMonth"
        ).value;


    let amount =
        Number(
            document.getElementById(
                "feeAmount"
            ).value
        );


    if(!studentId){

        alert(
            "Please select a student."
        );

        return;

    }


    if(!month){

        alert(
            "Please select a month."
        );

        return;

    }


    if(!amount || amount <= 0){

        alert(
            "Please enter a valid amount."
        );

        return;

    }


    const { data, error } =
        await supabaseClient
        .from("fees")
        .insert({

            student_id: studentId,

            date: today(),

            amount: amount,

            month: month

        })
        .select()
        .single();


    if(error){

        console.error(
            "SUPABASE FEE INSERT ERROR:",
            error
        );

        alert(
            "Could not save fee."
        );

        return;

    }


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


    alert(
        "Fee recorded successfully."
    );

}
function searchFeeStudents(){

    let input =
        document.getElementById(
            "feeStudentSearch"
        );

    let container =
        document.getElementById(
            "feeStudentSearchResults"
        );

    let search =
        input.value
        .trim()
        .toLowerCase();

    if(!search){

        container.innerHTML = "";

        return;
    }


    let matches =
        students.filter(student => {

            let name =
                String(student.name || "")
                .toLowerCase();

            let roll =
                String(student.roll || "")
                .toLowerCase();

            let className =
                String(student.className || "")
                .toLowerCase();

            let group =
                String(student.group || "")
                .toLowerCase();

            return (
                name.includes(search) ||
                roll.includes(search) ||
                className.includes(search) ||
                group.includes(search)
            );

        });


    if(matches.length === 0){

        container.innerHTML = `
            <div class="fee-search-empty">
                ❌ No student found.
            </div>
        `;

        return;
    }


    let displayMatches =
        matches.slice(0, 30);

    container.innerHTML = "";


    displayMatches.forEach(student => {

        let item =
            document.createElement("div");

        item.className =
            "fee-student-result";


        let photoHTML =
            student.photo
            ? `
                <img
                src="${student.photo}"
                alt="${escapeHTML(student.name)}">
              `
            : `
                <div class="fee-student-avatar">
                    👤
                </div>
              `;


        item.innerHTML = `

            ${photoHTML}

            <div class="fee-student-info">

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

            selectFeeStudent(
                student.id
            );

        };


        container.appendChild(item);

    });


    if(matches.length > 30){

        let more =
            document.createElement("div");

        more.className =
            "fee-search-empty";

        more.innerText =
            "Showing first 30 matches. Refine your search.";

        container.appendChild(more);

    }

}
function selectFeeStudent(id){

    let student =
        students.find(
            s => s.id === id
        );

    if(!student)
        return;


    /*
       Set the original hidden select.
       Your existing addFee() can continue
       using feeStudent.value normally.
    */

    let select =
        document.getElementById(
            "feeStudent"
        );


    select.value =
        String(id);


    /*
       Show selected student
    */

    let selected =
        document.getElementById(
            "feeSelectedStudent"
        );


    selected.style.display =
        "block";


    selected.innerHTML = `

        <span>
            👤 Selected:
        </span>

        <strong>
            ${escapeHTML(student.name)}
        </strong>

        <span>
            — Class ${escapeHTML(student.className)}
            • Roll ${escapeHTML(student.roll)}
            • Group ${escapeHTML(student.group)}
        </span>

    `;


    /*
       Clear search results
    */

    document.getElementById(
        "feeStudentSearch"
    ).value = "";


    document.getElementById(
        "feeStudentSearchResults"
    ).innerHTML = "";

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
onclick="editFee(${f.id})">
✏️
<span>Edit Fee</span>
</button>

<button
class="delete-option"
onclick="deleteFee(${f.id})">
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
   DELETE FEE
===================================================== */

async function deleteFee(id){

    const { error } =
        await supabaseClient
        .from("fees")
        .delete()
        .eq("id", id);


    if(error){

        console.error(
            "SUPABASE FEE DELETE ERROR:",
            error
        );

        alert(
            "Could not delete fee."
        );

        return;

    }


    fees =
        fees.filter(
            f => f.id !== id
        );


    saveAll();


    renderFees();

    renderDashboard();


    alert(
        "Fee deleted."
    );

}


/* =====================================================
   CREATE EXAM
===================================================== */

async function createExam(){

    let name =
        document.getElementById(
            "examName"
        ).value.trim();


    let date =
        document.getElementById(
            "examDate"
        ).value;


    if(!name){

        alert(
            "Please enter exam name."
        );

        return;

    }


    if(!date){

        alert(
            "Please select exam date."
        );

        return;

    }


    const { data, error } =
        await supabaseClient
        .from("exams")
        .insert({

            exam_name: name,

            date: date

        })
        .select()
        .single();


    if(error){

        console.error(
            "SUPABASE EXAM INSERT ERROR:",
            error
        );

        alert(
            "Could not save exam."
        );

        return;

    }


    exams.push({

        id: data.id,

        name: data.exam_name,

        date: data.date

    });


    saveAll();


    document.getElementById(
        "examName"
    ).value = "";


    document.getElementById(
        "examDate"
    ).value = "";


    renderExamSelect();


    alert(
        "Exam created successfully."
    );

}


/* =====================================================
   DELETE EXAM
===================================================== */

async function deleteExam(){

    let select =
        document.getElementById(
            "examSelect"
        );


    let id =
        Number(select.value);


    if(!id){

        alert(
            "Please select an exam to delete."
        );

        return;

    }


    const { error } =
        await supabaseClient
        .from("exams")
        .delete()
        .eq("id", id);


    if(error){

        console.error(
            "SUPABASE EXAM DELETE ERROR:",
            error
        );

        alert(
            "Could not delete exam:\n" +
            error.message
        );

        return;

    }


    exams =
        exams.filter(
            exam => exam.id !== id
        );


    delete results[id];


    saveAll();


    renderExamSelect();


    alert(
        "Exam deleted successfully."
    );

}


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
        Number(select.value);

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
        onclick="openResultStudent(${s.id})">

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
${examId},
${s.id},
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
${examId},
${s.id},
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
${examId},
${s.id},
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
${examId},
${s.id},
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
${examId},
${studentId},
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
${examId},
${studentId},
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
${examId},
${studentId},
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
${examId},
${studentId},
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

    let mark =
        Number(value);


    if(isNaN(mark))
        mark = 0;


    mark =
        Math.max(
            0,
            Math.min(
                25,
                mark
            )
        );


    if(!results[examId])
        results[examId] = {};


    if(!results[examId][studentId]){

        results[examId][studentId] = {

            english: 0,
            nepali: 0,
            math: 0,
            science: 0

        };

    }


    results[examId][studentId][subject] =
        mark;


    let result =
        results[examId][studentId];


    let total =
        Number(result.english || 0) +
        Number(result.nepali || 0) +
        Number(result.math || 0) +
        Number(result.science || 0);


    result.total =
        total;


    const { data: existing, error: findError } =
        await supabaseClient
        .from("results")
        .select("*")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .maybeSingle();


    if(findError){

        console.error(
            "SUPABASE RESULT FIND ERROR:",
            findError
        );

        alert(
            "Could not check result."
        );

        return;

    }


    let resultData = {

        english:
            Number(result.english || 0),

        nepali:
            Number(result.nepali || 0),

        maths:
            Number(result.math || 0),

        science:
            Number(result.science || 0),

        total:
            total

    };


    if(existing){

        const { error } =
            await supabaseClient
            .from("results")
            .update(resultData)
            .eq("id", existing.id);


        if(error){

            console.error(
                "SUPABASE RESULT UPDATE ERROR:",
                error
            );

            alert(
                "Could not update result."
            );

            return;

        }

    }
    else{

        const { error } =
            await supabaseClient
            .from("results")
            .insert({

                student_id: studentId,

                exam_id: examId,

                ...resultData

            });


        if(error){

            console.error(
                "SUPABASE RESULT INSERT ERROR:",
                error
            );

            alert(
                "Could not save result."
            );

            return;

        }

    }


    saveAll();


    if(
    selectedResultStudentId === studentId
){
    refreshResultDetail(
        examId,
        studentId
    );
}
else{
    updateResultRow(
        examId,
        studentId
    );
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

function renderStudentHistory(){

    if(!selectedHistoryStudentId){

        document.getElementById(
            "studentHistoryContent"
        ).innerHTML = `

<div class="panel">

<div class="empty">

🔎 Search for a student above to view their complete history.

</div>

</div>

`;

        return;

    }


    let id =
        Number(
            selectedHistoryStudentId
        );


    let student =
        students.find(
            s => s.id === id
        );


    if(!student){

        document.getElementById(
            "studentHistoryContent"
        ).innerHTML = "";

        return;

    }


    let content =
        document.getElementById(
            "studentHistoryContent"
        );


    let present = 0;
    let absent = 0;


    let attendanceRows = "";


    Object.keys(attendance)
    .sort()
    .reverse()
    .forEach(date=>{

        let status =
            attendance[date][id];


        if(!status)
            return;


        if(status === "present")
            present++;


        if(status === "absent")
            absent++;


        attendanceRows += `

<tr>

<td>${date}</td>

<td class="${
    status === "present"
    ? "present"
    : "absent"
}">

${
    status === "present"
    ? "Present ✓"
    : "Absent ✗"
}

</td>

</tr>

`;

    });


    let totalAttendance =
        present + absent;


    let attendancePercent =
        totalAttendance === 0
        ? 0
        : present / totalAttendance * 100;


    /* FEE HISTORY */

    let feeRows = "";


    fees
    .filter(
        f => f.studentId === id
    )
    .slice()
    .reverse()
    .forEach(f=>{

        feeRows += `

<tr>

<td>${f.month}</td>

<td>Rs. ${f.amount}</td>

<td class="paid">
Paid
</td>

<td>${f.paidDate}</td>

</tr>

`;

    });


    /* EXAM HISTORY */

    let examRows = "";


    exams
    .slice()
    .reverse()
    .forEach(exam=>{

        let r =
            results[exam.id]
            ? results[exam.id][id]
            : null;


        if(!r)
            return;


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


        examRows += `

<tr>

<td>${escapeHTML(exam.name)}</td>

<td>${exam.date}</td>

<td>${total}/100</td>

<td>${percentage.toFixed(1)}%</td>

<td>

<span class="${
    grade === "F"
    ? "grade-fail"
    : "grade-good"
}">

<b>${grade}</b>

</span>

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


   /* SUMMARY */

let totalFees =
    fees
    .filter(
        f => f.studentId === id
    )
    .reduce(
        (sum, f) =>
            sum + Number(f.amount || 0),
        0
    );


let examsTaken = 0;
let percentageTotal = 0;


exams.forEach(exam => {

    let r =
        results[exam.id]
        ? results[exam.id][id]
        : null;

    if(!r)
        return;

    let total =

        Number(r.english || 0) +
        Number(r.nepali || 0) +
        Number(r.math || 0) +
        Number(r.science || 0);

    examsTaken++;

    percentageTotal += total;

});


let averagePercentage =
    examsTaken === 0
    ? 0
    : percentageTotal / examsTaken;


/* DISPLAY */

content.innerHTML = `

<div class="panel">

<div class="student-profile">

${studentPhotoHTML(
    student,
    "student-photo-large"
)}

<div>

<h3>${escapeHTML(student.name)}</h3>

<p class="small">

Class ${escapeHTML(student.className)}

|

Group ${escapeHTML(student.group)}

|

Roll ${escapeHTML(student.roll)}

</p>

<p class="small">

Parent:
${escapeHTML(student.parent || "Not provided")}

<br>

Phone:
${escapeHTML(student.phone || "Not provided")}

<br>

Joined:
${escapeHTML(student.joined || "Not available")}

</p>

</div>

</div>

</div>


<!-- QUICK SUMMARY -->

<div class="history-summary-grid">

<div class="history-summary-card">

<div class="history-summary-icon">
📅
</div>

<div>

<span>Attendance</span>

<strong>
${attendancePercent.toFixed(1)}%
</strong>

</div>

</div>


<div class="history-summary-card">

<div class="history-summary-icon">
💰
</div>

<div>

<span>Total Fees</span>

<strong>
Rs. ${totalFees}
</strong>

</div>

</div>


<div class="history-summary-card">

<div class="history-summary-icon">
📝
</div>

<div>

<span>Exams Taken</span>

<strong>
${examsTaken}
</strong>

</div>

</div>


<div class="history-summary-card">

<div class="history-summary-icon">
📊
</div>

<div>

<span>Average</span>

<strong>
${averagePercentage.toFixed(1)}%
</strong>

</div>

</div>

</div>


<div class="panel">

<h3>📅 Attendance Summary</h3>

<p>
Present:
<b class="present">
${present}
</b>
</p>

<p>
Absent:
<b class="absent">
${absent}
</b>
</p>

<p>
Total Recorded:
<b>
${totalAttendance}
</b>
</p>

<p>
Attendance:
<b>
${attendancePercent.toFixed(1)}%
</b>
</p>

<br>


<table>

<thead>

<tr>
<th>Date</th>
<th>Status</th>
</tr>

</thead>

<tbody>

${attendanceRows ||

`

<tr>

<td colspan="2"
class="empty">

No attendance recorded.

</td>

</tr>

`}

</tbody>

</table>

</div>


<div class="panel">

<h3>💰 Fee History</h3>

<table>

<thead>

<tr>
<th>Month</th>
<th>Amount</th>
<th>Status</th>
<th>Paid Date</th>
</tr>

</thead>

<tbody>

${feeRows ||

`

<tr>

<td colspan="4"
class="empty">

No fee records.

</td>

</tr>

`}

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

${examRows ||

`

<tr>

<td colspan="6"
class="empty">

No exam results.

</td>

</tr>

`}

</tbody>

</table>

</div>

`;

}


/* =====================================================
   DASHBOARD
===================================================== */
function renderDashboard(){

    document.getElementById(
        "totalStudents"
    ).innerText =
        students.length;


    /*
       Dynamic group cards
    */

    let groupACount =
        students.filter(
            s => s.group === "A"
        ).length;

    let groupBCount =
        students.filter(
            s => s.group === "B"
        ).length;

    let groupCCount =
        students.filter(
            s => s.group === "C"
        ).length;


    /*
       Keep original A/B/C
    */

    document.getElementById(
        "groupA"
    ).innerText =
        groupACount;

    document.getElementById(
        "groupB"
    ).innerText =
        groupBCount;

    document.getElementById(
        "groupC"
    ).innerText =
        groupCCount;


    /*
       Today's attendance
    */

    let date = today();

    let todayData =
        attendance[date] || {};


    let present =
        Object.values(todayData)
        .filter(
            v => v === "present"
        )
        .length;


    let absent =
        Object.values(todayData)
        .filter(
            v => v === "absent"
        )
        .length;


    document.getElementById(
        "presentToday"
    ).innerText =
        present;


    document.getElementById(
        "absentToday"
    ).innerText =
        absent;


    /*
       Total fees
    */

    let totalFees =
        fees.reduce(
            (sum, fee) =>
                sum + Number(fee.amount || 0),
            0
        );


    document.getElementById(
        "dashboardTotalFees"
    ).innerText =
        "Rs. " + totalFees;


    /*
       Total exams
    */

    document.getElementById(
        "dashboardTotalExams"
    ).innerText =
        exams.length;


    /*
       Overall attendance
    */

    let overallPresent = 0;
    let overallAbsent = 0;


    Object.values(attendance)
    .forEach(day => {

        Object.values(day)
        .forEach(status => {

            if(status === "present")
                overallPresent++;

            if(status === "absent")
                overallAbsent++;

        });

    });


    let totalAttendance =
        overallPresent +
        overallAbsent;


    let overallPercentage =
        totalAttendance === 0
        ? 0
        : (
            overallPresent /
            totalAttendance
        ) * 100;


    document.getElementById(
        "dashboardAttendance"
    ).innerText =
        overallPercentage.toFixed(1) + "%";


    /*
       Students with records
    */

    let studentsWithRecords =
        new Set();


    Object.values(attendance)
    .forEach(day => {

        Object.keys(day)
        .forEach(studentId => {

            studentsWithRecords.add(
                Number(studentId)
            );

        });

    });


    fees.forEach(fee => {

        studentsWithRecords.add(
            Number(fee.studentId)
        );

    });


    Object.values(results)
    .forEach(examResults => {

        Object.keys(examResults)
        .forEach(studentId => {

            studentsWithRecords.add(
                Number(studentId)
            );

        });

    });


    document.getElementById(
        "dashboardStudentsWithRecords"
    ).innerText =
        studentsWithRecords.size;


    /*
       Recent students
    */

    let table =
        document.getElementById(
            "dashboardStudents"
        );


    table.innerHTML = "";


    students
    .slice(-10)
    .reverse()
    .forEach(s=>{

        table.innerHTML += `

<tr>

<td>

${studentPhotoHTML(
    s,
    "dashboard-photo"
)}

<b>${escapeHTML(s.name)}</b>

</td>

<td>${escapeHTML(s.className)}</td>

<td>${escapeHTML(s.group)}</td>

<td>${escapeHTML(s.roll)}</td>

</tr>

`;

    });

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

saveAll();
renderAll();
async function startApp(){
  console.log("START APP: beginning");

    try{

        await openOfflineDatabase();
      console.log("START APP: offline database finished");

    }
    catch(error){

        console.error(
            "Could not initialize offline database:",
            error
        );

    }

    await loadGroupsFromSupabase();
    await loadStudentsFromSupabase();
    await loadAttendanceFromSupabase();
    await loadFeesFromSupabase();
    await loadExamsFromSupabase();
    await loadResultsFromSupabase();

}
startApp();

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

    let select =
        document.getElementById(
            "examSelect"
        );

    let examId =
        Number(select.value);

    if(!examId){
        alert(
            "Please select an exam first."
        );
        return;
    }

    let exam =
        exams.find(
            e => Number(e.id) === examId
        );

    if(!exam){
        alert(
            "Exam not found."
        );
        return;
    }

    let newName =
        prompt(
            "Enter new exam name:",
            exam.name
        );

    if(newName === null)
        return;

    newName =
        newName.trim();

    if(!newName){
        alert(
            "Exam name cannot be empty."
        );
        return;
    }

    let newDate =
        prompt(
            "Enter exam date (YYYY-MM-DD):",
            exam.date || ""
        );

    if(newDate === null)
        return;

    newDate =
        newDate.trim();

    if(!newDate){
        alert(
            "Exam date cannot be empty."
        );
        return;
    }

    editExamInSupabase(
        examId,
        newName,
        newDate
    );

}
async function editExamInSupabase(
    examId,
    newName,
    newDate
){

    const { error } =
        await supabaseClient
        .from("exams")
        .update({
            exam_name: newName,
            date: newDate
        })
        .eq("id", examId);

    if(error){

        console.error(
            "SUPABASE EXAM UPDATE ERROR:",
            error
        );

        alert(
            "Could not update exam:\n" +
            error.message
        );

        return;
    }

    let exam =
        exams.find(
            e => Number(e.id) === examId
        );

    if(exam){

        exam.name =
            newName;

        exam.date =
            newDate;

    }

    renderExamSelect();

    renderResults();

    alert(
        "✅ Exam updated successfully."
    );

}
function deleteSelectedExam(){

    let select =
        document.getElementById(
            "examSelect"
        );

    let examId =
        Number(select.value);

    if(!examId){
        alert(
            "Please select an exam first."
        );
        return;
    }

    deleteExamById(examId);

}
async function deleteExamById(id){

    let exam =
        exams.find(
            e => Number(e.id) === Number(id)
        );

    if(!exam){
        alert(
            "Exam not found."
        );
        return;
    }

    let confirmed =
        confirm(
            "⚠️ Delete this exam?\n\n" +
            "Exam: " + exam.name + "\n\n" +
            "All student marks/results for this exam will also be permanently deleted.\n\n" +
            "This action cannot be undone.\n\n" +
            "Are you sure?"
        );

    if(!confirmed)
        return;


    // First delete all results belonging to this exam
    let response =
        await supabaseClient
        .from("results")
        .delete()
        .eq("exam_id", id);


    if(response.error){

        console.error(
            "SUPABASE RESULT DELETE ERROR:",
            response.error
        );

        alert(
            "Could not delete exam results:\n" +
            response.error.message
        );

        return;
    }


    // Now delete the exam itself
    response =
        await supabaseClient
        .from("exams")
        .delete()
        .eq("id", id);


    if(response.error){

        console.error(
            "SUPABASE EXAM DELETE ERROR:",
            response.error
        );

        alert(
            "Could not delete exam:\n" +
            response.error.message
        );

        return;
    }


    // Update local data
    exams =
        exams.filter(
            exam =>
                Number(exam.id) !== Number(id)
        );


    delete results[id];


    saveAll();

    renderExamSelect();

    renderResults();


    alert(
        "✅ Exam and all its results were deleted successfully."
    );

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

    let fee =
        fees.find(
            f => Number(f.id) === Number(id)
        );

    if(!fee){
        alert("Fee record not found.");
        return;
    }

    let newMonth =
        prompt(
            "Enter fee month (YYYY-MM):",
            fee.month
        );

    if(newMonth === null)
        return;

    newMonth =
        newMonth.trim();

    if(!newMonth){
        alert("Month cannot be empty.");
        return;
    }

    let newAmount =
        prompt(
            "Enter fee amount:",
            fee.amount
        );

    if(newAmount === null)
        return;

    newAmount =
        newAmount.trim();

    if(!newAmount){
        alert("Amount cannot be empty.");
        return;
    }

    let amount =
        Number(newAmount);

    if(
        !Number.isFinite(amount) ||
        amount < 0
    ){
        alert("Please enter a valid amount.");
        return;
    }

    const { error } =
        await supabaseClient
        .from("fees")
        .update({
            month: newMonth,
            amount: amount
        })
        .eq("id", id);

    if(error){

        console.error(
            "SUPABASE FEE UPDATE ERROR:",
            error
        );

        alert(
            "Could not update fee:\n" +
            error.message
        );

        return;
    }

    fee.month =
        newMonth;

    fee.amount =
        amount;

    renderFees();

    alert(
        "✅ Fee updated successfully."
    );

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
/* =====================================================
   OFFLINE DATABASE — INDEXEDDB
===================================================== */

const OFFLINE_DB_NAME = "RampurFreeTuitionOfflinev2";
const OFFLINE_DB_VERSION = 2;

let offlineDB = null;

function openOfflineDatabase(){

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(
            OFFLINE_DB_NAME,
            OFFLINE_DB_VERSION
        );

        request.onupgradeneeded = function(event){

            const db = event.target.result;

            if(!db.objectStoreNames.contains("students")){
                db.createObjectStore("students", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("groups")){
                db.createObjectStore("groups", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("attendance")){
                db.createObjectStore("attendance", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("fees")){
                db.createObjectStore("fees", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("exams")){
                db.createObjectStore("exams", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("results")){
                db.createObjectStore("results", {
                    keyPath: "id"
                });
            }

            if(!db.objectStoreNames.contains("syncQueue")){
                db.createObjectStore("syncQueue", {
                    keyPath: "queueId",
                    autoIncrement: true
                });
            }

        };

        request.onsuccess = function(event){

            offlineDB = event.target.result;

            console.log(
                "Offline database ready."
            );

            resolve(offlineDB);

        };

        request.onerror = function(){

            console.error(
                "Offline database error:",
                request.error
            );

            reject(request.error);

        };

    });

           }

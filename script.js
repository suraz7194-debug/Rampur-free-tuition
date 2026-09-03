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

let students =
JSON.parse(localStorage.getItem("students")) || [];

let attendance =
JSON.parse(localStorage.getItem("attendance")) || {};

let fees =
JSON.parse(localStorage.getItem("fees")) || [];

let exams =
JSON.parse(localStorage.getItem("exams")) || {};

let results =
JSON.parse(localStorage.getItem("results")) || {};


/*
   NEW GROUP SYSTEM

   If old data already exists,
   Group A, B and C are automatically created.
*/

let groups =
JSON.parse(localStorage.getItem("groups")) ||
["A","B","C"];


/* Remove duplicate groups */

groups = [
    ...new Set(
        groups.map(g => String(g).trim())
    )
].filter(Boolean);


/*
   Make sure old students' groups
   still exist.
*/

students.forEach(s => {

    if (!groups.includes(s.group)) {
        groups.push(s.group);
    }

});


let studentGroup =
groups[0] || "A";

let attendanceGroup =
groups[0] || "A";

let resultGroup =
groups[0] || "A";


let selectedStudentPhoto = "";

let selectedEditPhoto = "";

let selectedHistoryStudentId = null;


/* =====================================================
   SAVE ALL
===================================================== */

function saveAll(){

    localStorage.setItem(
        "students",
        JSON.stringify(students)
    );

    localStorage.setItem(
        "attendance",
        JSON.stringify(attendance)
    );

    localStorage.setItem(
        "fees",
        JSON.stringify(fees)
    );

    localStorage.setItem(
        "exams",
        JSON.stringify(exams)
    );

    localStorage.setItem(
        "results",
        JSON.stringify(results)
    );

    localStorage.setItem(
        "groups",
        JSON.stringify(groups)
    );

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


    groups.forEach(group=>{

        let box =
            document.createElement("div");

        box.style.display = "flex";
        box.style.alignItems = "center";
        box.style.gap = "8px";
        box.style.flexWrap = "wrap";
        box.style.padding = "10px";
        box.style.marginBottom = "7px";
        box.style.background = "#f8fafc";
        box.style.borderRadius = "8px";


        let count =
            students.filter(
                s => s.group === group
            ).length;


        box.innerHTML = `

<strong style="min-width:100px;">
👥 ${escapeHTML(group)}
</strong>

<span class="small" style="margin:0;">
${count} student${count===1?"":"s"}
</span>

<button
class="btn"
onclick="editGroup('${encodeURIComponent(group)}')">
✏️ Edit
</button>

<button
class="btn red"
onclick="deleteGroup('${encodeURIComponent(group)}')">
🗑 Delete
</button>

`;

        container.appendChild(box);

    });

}


/* =========================
   ADD GROUP
========================= */

function addGroup(){

    let input =
        document.getElementById(
            "newGroupName"
        );

    let name =
        input.value.trim();


    if(!name){

        alert("Please enter a group name.");

        return;

    }


    /* Check duplicate */

    let exists =
        groups.some(
            g => g.toLowerCase() === name.toLowerCase()
        );

    if(exists){

        alert("This group already exists.");

        return;

    }


    groups.push(name);


    /*
       Select newly created group
    */

    studentGroup = name;
    attendanceGroup = name;
    resultGroup = name;


    saveAll();


    input.value = "";


    renderAll();


    alert(
        "Group '" + name + "' added successfully."
    );

}


/* =========================
   EDIT GROUP
========================= */

function editGroup(encodedGroup){

    let oldName =
        decodeURIComponent(encodedGroup);


    let newName =
        prompt(
            "Enter new name for group:",
            oldName
        );


    if(newName === null)
        return;


    newName = newName.trim();


    if(!newName){

        alert("Group name cannot be empty.");

        return;

    }


    let duplicate =
        groups.some(
            g =>
                g !== oldName &&
                g.toLowerCase() === newName.toLowerCase()
        );


    if(duplicate){

        alert("A group with this name already exists.");

        return;

    }


    /*
       Rename group in students
    */

    students.forEach(student=>{

        if(student.group === oldName){

            student.group = newName;

        }

    });


    /*
       Rename group selections
    */

    if(studentGroup === oldName)
        studentGroup = newName;

    if(attendanceGroup === oldName)
        attendanceGroup = newName;

    if(resultGroup === oldName)
        resultGroup = newName;


    /*
       Replace group name
    */

    let index =
        groups.indexOf(oldName);

    if(index !== -1){

        groups[index] = newName;

    }


    saveAll();

    renderAll();


    alert(
        "Group renamed successfully."
    );

}


/* =========================
   DELETE GROUP
========================= */

function deleteGroup(encodedGroup){

    let group =
        decodeURIComponent(encodedGroup);


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


    /*
       Choose another group
    */

    let replacement =
        groups.find(
            g => g !== group
        );


    if(studentCount > 0){

        students.forEach(student=>{

            if(student.group === group){

                student.group = replacement;

            }

        });

    }


    /*
       Remove group
    */

    groups =
        groups.filter(
            g => g !== group
        );


    /*
       Fix selected groups
    */

    if(studentGroup === group)
        studentGroup = replacement;

    if(attendanceGroup === group)
        attendanceGroup = replacement;

    if(resultGroup === group)
        resultGroup = replacement;


    saveAll();

    renderAll();


    alert(
        "Group deleted. Students were moved to " +
        replacement + "."
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

function addStudent(){

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

        alert("Please select a group.");

        return;

    }


    students.push({

        id: Date.now(),

        name: name,

        className: className,

        roll: roll,

        parent: parent,

        phone: phone,

        group: group,

        joined: today(),

        photo: selectedStudentPhoto || ""

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


    alert("Student added.");

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

function saveStudentEdit(){

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

        alert("Student not found.");

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


    student.name = name;

    student.className = className;

    student.roll = roll;

    student.parent = parent;

    student.phone = phone;

    student.group = group;


    /*
       Only replace photo if
       a new photo was selected.
    */

    if(selectedEditPhoto){

        student.photo =
            selectedEditPhoto;

    }


    saveAll();


    selectedEditPhoto = "";


    document.getElementById(
        "editStudentBox"
    ).style.display = "none";


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

<button
class="btn"
onclick="editStudent(${s.id})">

✏️ Edit

</button>

<button
class="btn red"
onclick="deleteStudent(${s.id})">

Delete

</button>

</td>

</tr>

`;

    });

}


/* =====================================================
   DELETE STUDENT
===================================================== */

function deleteStudent(id){

    if(!confirm(
        "Delete this student and their records?"
    ))
        return;


    students =
        students.filter(
            s => s.id !== id
        );


    Object.keys(attendance)
    .forEach(date=>{

        if(attendance[date]){
            delete attendance[date][id];
        }

    });


    fees =
        fees.filter(
            f => f.studentId !== id
        );


    Object.keys(results)
    .forEach(examId=>{

        if(results[examId]){
            delete results[examId][id];
        }

    });


    if(selectedHistoryStudentId === id){

        selectedHistoryStudentId = null;

    }


    saveAll();

    renderAll();

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

function toggleAttendance(
    id,
    date
){

    if(!attendance[date])
        attendance[date] = {};


    let current =
        attendance[date][id];


    if(current === "present"){

        attendance[date][id] = "absent";

    }
    else{

        attendance[date][id] = "present";

    }


    saveAll();

    renderAttendance();

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

function addFee(){

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


    if(!studentId ||
       !month ||
       !amount){

        alert(
            "Select student, month and amount."
        );

        return;

    }


    fees.push({

        id: Date.now(),

        studentId: studentId,

        month: month,

        amount: amount,

        paidDate: today()

    });


    saveAll();


    document.getElementById(
        "feeAmount"
    ).value = "";


    renderAll();


    alert(
        "Fee record saved."
    );

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

<button
class="btn red"
onclick="deleteFee(${f.id})">

Delete

</button>

</td>

</tr>

`;

    });

}


/* =====================================================
   DELETE FEE
===================================================== */

function deleteFee(id){

    if(!confirm(
        "Delete this fee record?"
    ))
        return;


    fees =
        fees.filter(
            f => f.id !== id
        );


    saveAll();

    renderAll();

}


/* =====================================================
   CREATE EXAM
===================================================== */

function createExam(){

    let name =
        document.getElementById(
            "examName"
        ).value.trim();


    let date =
        document.getElementById(
            "examDate"
        ).value;


    if(!name || !date){

        alert(
            "Enter exam name and date."
        );

        return;

    }


    let exam = {

        id: Date.now(),

        name: name,

        date: date

    };


    exams.push(exam);

    results[exam.id] = {};


    saveAll();


    document.getElementById(
        "examName"
    ).value = "";


    renderAll();


    alert(
        "Exam created."
    );

}


/* =====================================================
   DELETE EXAM
===================================================== */

function deleteExam(){

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
            e => e.id === examId
        );


    if(!exam){

        alert(
            "Exam not found."
        );

        return;

    }


    let confirmed =
        confirm(
            "Delete exam '" +
            exam.name +
            "' and ALL marks belonging to this exam?"
        );


    if(!confirmed)
        return;


    exams =
        exams.filter(
            e => e.id !== examId
        );


    delete results[examId];


    saveAll();

    renderAll();


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


    exams.forEach(exam=>{

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

function renderResults(){

    let table =
        document.getElementById(
            "resultsTable"
        );


    table.innerHTML = "";


    let select =
        document.getElementById(
            "examSelect"
        );


    let examId =
        Number(select.value);


    if(!examId){

        table.innerHTML = `

<tr>

<td colspan="9"
class="empty">

Create an exam first.

</td>

</tr>

`;

        return;

    }


    if(!results[examId])
        results[examId] = {};


    let list =
        students.filter(
            s => s.group === resultGroup
        );


    if(list.length === 0){

        table.innerHTML = `

<tr>

<td colspan="9"
class="empty">

No students in this group.

</td>

</tr>

`;

        return;

    }


    list.forEach(s=>{

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


        let percentage = total;


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


/* =====================================================
   UPDATE MARK
===================================================== */

function updateMark(
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


    saveAll();


    updateResultRow(
        examId,
        studentId
    );

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

function exportData(){

    let backup = {

        students: students,

        attendance: attendance,

        fees: fees,

        exams: exams,

        results: results,

        groups: groups,

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
                type:"application/json"
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

}


/* =====================================================
   IMPORT BACKUP
===================================================== */

function importData(){

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


    reader.onload = function(e){

        try{

            let data =
                JSON.parse(
                    e.target.result
                );


            if(!data.students){

                alert(
                    "Invalid backup file."
                );

                return;

            }


            if(!confirm(
                "This will replace your current data. Continue?"
            ))
                return;


            students =
                data.students || [];


            attendance =
                data.attendance || {};


            fees =
                data.fees || [];


            exams =
                data.exams || [];


            results =
                data.results || {};


            /*
               Older backups may not contain groups.
            */

            groups =
                data.groups ||
                ["A","B","C"];


            /*
               Add any student group
               that isn't already present.
            */

            students.forEach(s=>{

                if(
                    s.group &&
                    !groups.includes(s.group)
                ){

                    groups.push(s.group);

                }

            });


            selectedHistoryStudentId = null;


            studentGroup =
                groups[0] || "A";

            attendanceGroup =
                groups[0] || "A";

            resultGroup =
                groups[0] || "A";


            saveAll();


            renderAll();


            alert(
                "Backup restored successfully."
            );

        }

        catch(error){

            alert(
                "Could not read the backup file."
            );

        }

    };


    reader.readAsText(file);

}


/* =====================================================
   BACKUP SUMMARY
===================================================== */

function renderBackup(){

    document.getElementById(
        "backupStudents"
    ).innerText =
        students.length;


    let attendanceCount = 0;


    Object.values(attendance)
    .forEach(day=>{

        attendanceCount +=
            Object.keys(day).length;

    });


    document.getElementById(
        "backupAttendance"
    ).innerText =
        attendanceCount;


    document.getElementById(
        "backupFees"
    ).innerText =
        fees.length;


    document.getElementById(
        "backupExams"
    ).innerText =
        exams.length;


    document.getElementById(
        "backupGroups"
    ).innerText =
        groups.length;

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

    renderBackup();

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
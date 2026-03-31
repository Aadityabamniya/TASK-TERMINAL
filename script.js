/* FILENAME: script.js */

// --- 1. FIREBASE CLOUD CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBUW2AMdHObQW31ZsLtdRWSU6L8AwxxSW4",
    authDomain: "task-terminal-9e678.firebaseapp.com",
    projectId: "task-terminal-9e678",
    storageBucket: "task-terminal-9e678.firebasestorage.app",
    messagingSenderId: "418579327777",
    appId: "1:418579327777:web:80f9cbfb7a3b77107aec60",
    measurementId: "G-KYR3C6TPBH",
    
    // ASIA URL:
    databaseURL: "https://task-terminal-9e678-default-rtdb.asia-southeast1.firebasedatabase.app"
};
// Initialize Firebase App & Database Reference
firebase.initializeApp(firebaseConfig);
const cloudDB = firebase.database().ref('TASK_TERMINAL_LIVE_DB');

const core = {
    // 1. Initialize Database with Group Structure
    db: { groups: {} },
    currentGroupCode: null,
    currentUser: null,
    
    // Feature Variables
    activeSector: null,
    activeAssignee: null,
    activeTaskId: null,
    currentTab: 'all',
    lastNotifTime: null, // UPGRADE: Tracks the exact time of the last notification to prevent spam

    save() {
        cloudDB.set(this.db)
            .then(() => { console.log("Cloud Write Successful!"); })
            .catch((error) => {
                console.error("Cloud Write Failed:", error);
                alert("CRITICAL ERROR: Laptop failed to write to cloud.\nReason: " + error.message);
            });
    },

    saveSession() {
        localStorage.setItem('TASK_SESSION', JSON.stringify({
            user: this.currentUser,
            groupCode: this.currentGroupCode
        }));
    },

    init() {
        const session = JSON.parse(localStorage.getItem('TASK_SESSION'));
        
        if (session && session.user && session.groupCode) {
            this.currentGroupCode = session.groupCode;
            this.currentUser = session.user;
        }

        // --- REAL-TIME CLOUD LISTENER ---
        cloudDB.on('value', (snapshot) => {
            const data = snapshot.val();
            this.db = data || { groups: {} };
            
            if (this.currentUser && this.currentGroupCode) {
                const group = this.db.groups[this.currentGroupCode];
                
                if (group && group.users && group.users[this.currentUser.name]) {
                    this.currentUser = { name: this.currentUser.name, ...group.users[this.currentUser.name] };
                    
                    this.updateNotificationUI();
                    if (document.getElementById('view-dash').style.display === 'block') {
                        this.renderDashboard();
                    }
                    if (document.getElementById('view-tracking').style.display === 'block') {
                        this.renderTaskList();
                    }
                    if (document.getElementById('view-task-details').style.display === 'block') {
                        this.viewTaskDetails(this.activeTaskId); 
                    }
                } else {
                    this.logout(); 
                }
            }
        });

        if (session && session.user && session.groupCode) {
            ui.show('view-dash');
        } else {
            ui.show('view-initial');
        }
    },

    // 2. Gateway Logic (Create & Join)
    createGroup() {
        const nameInput = document.getElementById('new-group-name');
        const name = nameInput.value.trim();
        
        if (!name) return alert("Please enter a Group Name first.");
        
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        this.db.groups[code] = { 
            name: name, 
            sectors: [], 
            users: {} 
        };
        this.save();
        this.currentGroupCode = code;
        
        document.getElementById('display-group-code').innerText = code;
        document.getElementById('generated-code-box').style.display = 'block';
        nameInput.disabled = true; 
        document.getElementById('btn-create-group').style.display = 'none';
        document.getElementById('btn-proceed-login').style.display = 'block';
    },

    joinGroup() {
        const code = document.getElementById('join-group-code').value.trim().toUpperCase();
        if (!code) return alert("Please enter a Group Code.");
        
        if (!this.db.groups || !this.db.groups[code]) {
            cloudDB.child('groups').child(code).once('value').then((snapshot) => {
                if (snapshot.exists()) {
                    if (!this.db.groups) this.db.groups = {};
                    this.db.groups[code] = snapshot.val();
                    this.currentGroupCode = code;
                    this.prepLoginScreen();
                } else {
                    alert("Invalid Group Code. Please check and try again.");
                }
            }).catch(() => {
                alert("Cloud connection error. Please check your internet.");
            });
            return; 
        }

        this.currentGroupCode = code;
        this.prepLoginScreen();
    },

    prepLoginScreen() {
        const group = this.db.groups[this.currentGroupCode];
        document.getElementById('login-group-title').innerText = `LOGIN: ${group.name.toUpperCase()}`;
        
        const sectorList = document.getElementById('login-sector-list');
        sectorList.innerHTML = "";

        if (!group.sectors || group.sectors.length === 0) {
            sectorList.innerHTML = `<p class="hint">No sectors created in this group yet.</p>`;
        } else {
            group.sectors.forEach(sector => {
                sectorList.innerHTML += `
                    <label class="sector-checkbox-label">
                        <input type="checkbox" class="sector-check" value="${sector}"> 
                        ${sector}
                    </label>
                `;
            });
        }

        document.getElementById('login-user').value = '';
        document.getElementById('login-pass').value = '';

        ui.show('view-login');
    },

    login(role) {
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();

        if (!user || !pass) return alert("Please enter both Username and Password.");

        const group = this.db.groups[this.currentGroupCode];
        if (!group.users) group.users = {}; 

        const checks = document.querySelectorAll('.sector-check:checked');
        const selectedSectors = Array.from(checks).map(c => c.value);

        if (!group.users[user]) {
            group.users[user] = { 
                password: pass, 
                role: role, 
                enrolled: role === 'assignee' ? selectedSectors : [] 
            };
            alert(`New account recognized in group "${group.name}". Password set!`);
        } else {
            if (group.users[user].password !== pass) {
                return alert("Incorrect password for this user.");
            }
            if (role === 'assignee') {
                group.users[user].enrolled = selectedSectors;
            }
        }

        this.currentUser = { name: user, ...group.users[user] };
        this.save();
        this.saveSession(); 
        
        this.renderDashboard();
        ui.show('view-dash');
    },

    renderDashboard() {
        const display = document.getElementById('sector-display');
        const authTools = document.getElementById('auth-tools');
        const welcome = document.getElementById('welcome-msg');
        const groupDisplay = document.getElementById('group-name-display');
        
        const group = this.db.groups[this.currentGroupCode];

        display.innerHTML = "";
        welcome.innerText = `OFFICIAL PORTAL: ${this.currentUser.name.toUpperCase()}`;
        groupDisplay.innerText = `GROUP: ${group.name} (Code: ${this.currentGroupCode})`;

        this.checkOverdueTasks();
        this.runSystemMaintenance(); 
        this.updateNotificationUI();

        if (this.currentUser.role === 'authority') {
            authTools.style.display = 'flex'; 
            if (!group.sectors || group.sectors.length === 0) {
                display.innerHTML = `<p class="hint">No sectors exist yet. Click '+ CREATE NEW SECTOR' to start.</p>`;
            } else {
                group.sectors.forEach(s => {
                    display.innerHTML += `
                        <div class="sector-card" style="cursor:pointer;" onclick="core.openSector('${s}')">
                            <h3 class="sector-title">${s}</h3>
                            <p class="sector-status">SECTOR ACTIVE</p>
                        </div>`;
                });
            }
        } else {
            authTools.style.display = 'none';
            if (!this.currentUser.enrolled || this.currentUser.enrolled.length === 0) {
                display.innerHTML = `<p class="hint">You are not enrolled in any sectors.</p>`;
            } else {
                this.currentUser.enrolled.forEach(s => {
                    display.innerHTML += `
                        <div class="sector-card" style="cursor:pointer;" onclick="core.openSector('${s}')">
                            <h3 class="sector-title">${s}</h3>
                            <p class="unit-status" style="color:#28a745; font-weight:bold; font-size:12px; margin-top:10px;">UNIT ENROLLED</p>
                        </div>`;
                });
            }
        }
    },

    createNewSector() {
        const sName = prompt("Enter New Sector Name:");
        if (sName) {
            const group = this.db.groups[this.currentGroupCode];
            if (!group.sectors) group.sectors = []; 
            
            if (!group.sectors.includes(sName)) {
                group.sectors.push(sName);
                this.save();
                this.renderDashboard();
            } else {
                alert("Sector already exists in this group!");
            }
        }
    },

    openSector(sectorName) {
        this.activeSector = sectorName;
        if (this.currentUser.role === 'authority') {
            document.getElementById('action-sector-title').innerText = sectorName.toUpperCase();
            ui.show('view-auth-action');
        } else {
            document.getElementById('track-sector-title').innerText = sectorName.toUpperCase();
            this.openTracking();
        }
    },

    renderAssignList() {
        const group = this.db.groups[this.currentGroupCode];
        const container = document.getElementById('employee-list-container');
        container.innerHTML = "";
        
        if (!group.users) group.users = {};

        const enrolledEmployees = Object.keys(group.users).filter(username => {
            const u = group.users[username];
            return u.role === 'assignee' && u.enrolled && u.enrolled.includes(this.activeSector);
        });

        if (enrolledEmployees.length === 0) {
            container.innerHTML = "<p class='hint'>No assignees enrolled in this sector yet.</p>";
        } else {
            enrolledEmployees.forEach(emp => {
                container.innerHTML += `
                    <div class="employee-row">
                        <span class="emp-name">${emp}</span>
                        <button class="btn-main assign-btn-small" onclick="core.openDeployForm('${emp}')">ASSIGN</button>
                    </div>`;
            });
        }
        ui.show('view-assign-list');
    },

    filterEmployees() {
        const query = document.getElementById('emp-search').value.toLowerCase();
        document.querySelectorAll('.employee-row').forEach(row => {
            const name = row.querySelector('.emp-name').innerText.toLowerCase();
            row.style.display = name.includes(query) ? "flex" : "none";
        });
    },

    openDeployForm(empName) {
        this.activeAssignee = empName;
        document.getElementById('deploy-emp-name').innerText = empName.toUpperCase();
        document.getElementById('new-task-title').value = "";
        document.getElementById('new-task-date').value = "";
        ui.show('view-deploy-task');
    },

    deployTask() {
        const title = document.getElementById('new-task-title').value.trim();
        const dateLimit = document.getElementById('new-task-date').value;

        if (!title || !dateLimit) return alert("Task Name and Date Limit are required.");

        const group = this.db.groups[this.currentGroupCode];
        if (!group.tasks) group.tasks = []; 

        const newTask = {
            id: Date.now(),
            sector: this.activeSector,
            title: title,
            dueDate: dateLimit,
            assignedTo: this.activeAssignee,
            assignedBy: this.currentUser.name,
            status: 'pending', 
            overdueNotified: false
        };

        group.tasks.push(newTask);
        
        this.addNotification(
            this.activeAssignee, 
            `📝 <strong>${title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">New task in ${this.activeSector} by ${this.currentUser.name}</span>`,
            newTask.id
        );
        
        this.save();
        
        alert("Task Deployed Successfully!");
        ui.show('view-auth-action');
    },

    openTracking() {
        this.switchTab('all');
        ui.show('view-tracking');
    },

    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        
        const autoClearDiv = document.getElementById('auto-delete-container');
        if (autoClearDiv) {
            if (tab === 'completed' && this.currentUser.role === 'authority') {
                autoClearDiv.style.display = 'flex';
                const group = this.db.groups[this.currentGroupCode];
                document.getElementById('auto-clear-select').value = group.autoClearPref || 'never';
            } else {
                autoClearDiv.style.display = 'none';
            }
        }

        this.renderTaskList();
    },

    renderTaskList() {
        this.checkOverdueTasks(); 
        
        const group = this.db.groups[this.currentGroupCode];
        const container = document.getElementById('task-list-container');
        container.innerHTML = "";

        if (!group.tasks) group.tasks = [];

        let tasks = group.tasks.filter(t => t.sector === this.activeSector);
        if (this.currentUser.role === 'assignee') {
            tasks = tasks.filter(t => t.assignedTo === this.currentUser.name);
        }

        if (this.currentTab === 'pending') {
            tasks = tasks.filter(t => t.status === 'pending' || t.status === 'overdue');
        } else if (this.currentTab === 'completed') {
            tasks = tasks.filter(t => t.status === 'completed');
        }

        if (tasks.length === 0) {
            container.innerHTML = `<p class="hint">No tasks found in this category.</p>`;
            return;
        }

        tasks.forEach(t => {
            let colorClass = "status-yellow";
            if (t.status === 'completed') colorClass = "status-green";
            if (t.status === 'overdue') colorClass = "status-red";

            let extraBtn = "";
            if (this.currentUser.role === 'authority' && t.status !== 'completed') {
                extraBtn = `<button class="btn-main assign-btn-small" onclick="event.stopPropagation(); core.sendReminder(${t.id})">REMINDER</button>`;
            }

            container.innerHTML += `
                <div class="task-card ${colorClass}" onclick="core.viewTaskDetails(${t.id})">
                    <div class="task-info">
                        <h4>${t.title}</h4>
                        <p class="task-meta">Due: ${new Date(t.dueDate).toLocaleString()} | To: ${t.assignedTo}</p>
                    </div>
                    ${extraBtn}
                </div>`;
        });
    },

    viewTaskDetails(taskId) {
        const group = this.db.groups[this.currentGroupCode];
        if(!group.tasks) return;

        const task = group.tasks.find(t => t.id === taskId);
        if(!task) return; 

        this.activeTaskId = taskId;

        const content = document.getElementById('task-detail-content');
        content.innerHTML = `
            <p><strong>Title:</strong> ${task.title}</p>
            <p><strong>Sector:</strong> ${task.sector}</p>
            <p><strong>Assigned To:</strong> ${task.assignedTo}</p>
            <p><strong>Assigned By:</strong> ${task.assignedBy}</p>
            <p><strong>Date Limit:</strong> <span class="${task.status === 'overdue' ? 'accent-red' : ''}">${new Date(task.dueDate).toLocaleString()}</span></p>
            <p><strong>Status:</strong> ${task.status.toUpperCase()}</p>
        `;

        const completeBtn = document.getElementById('btn-complete-task');
        if (this.currentUser.role === 'assignee' && task.status !== 'completed') {
            completeBtn.style.display = 'block';
        } else {
            completeBtn.style.display = 'none';
        }

        ui.show('view-task-details');
    },

    completeTask() {
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === this.activeTaskId);
        
        task.status = 'completed';
        task.completedAt = Date.now(); 
        
        this.addNotification(
            task.assignedBy, 
            `✅ <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">Completed by ${this.currentUser.name}</span>`, 
            task.id
        );
        this.save();
        
        alert("Task marked as completed!");
        this.openTracking();
    },

    sendReminder(taskId) {
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === taskId);
        
        this.addNotification(
            task.assignedTo, 
            `🔔 <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">Reminder: Due by ${new Date(task.dueDate).toLocaleDateString()}</span>`, 
            task.id
        );
        this.save();
        alert("Reminder sent to " + task.assignedTo);
    },

    addNotification(username, msg, taskId = null) {
        const group = this.db.groups[this.currentGroupCode];
        if (!group.users[username].notifications) group.users[username].notifications = [];
        group.users[username].notifications.unshift({ msg: msg, read: false, time: Date.now(), taskId: taskId });
        this.save();
        if (this.currentUser && this.currentUser.name === username) this.updateNotificationUI();
    },

    // --- UPGRADE: THE TOAST ENGINE ---
    showToast(htmlMsg, taskId) {
        // 1. Create the container if it doesn't exist
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        // 2. Create the Pop-up card
        const toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.innerHTML = htmlMsg;

        // 3. Make it clickable to jump straight to the task
        if (taskId) {
            toast.onclick = () => {
                this.handleNotifClick(taskId, { stopPropagation: () => {} });
                // Dismiss toast instantly when clicked
                toast.style.animation = 'fadeOutRight 0.3s forwards';
                setTimeout(() => toast.remove(), 300);
            };
        }

        container.appendChild(toast);

        // 4. Automatically disappear after 4 seconds
        setTimeout(() => {
            if (document.body.contains(toast)) {
                toast.style.animation = 'fadeOutRight 0.3s forwards';
                setTimeout(() => toast.remove(), 300);
            }
        }, 4000);
    },

    updateNotificationUI() {
        if (!this.currentUser || !this.currentGroupCode) return;
        const group = this.db.groups[this.currentGroupCode];
        const userNode = group.users[this.currentUser.name];
        if (!userNode.notifications) userNode.notifications = [];

        // --- UPGRADE: TRIGGER TOAST ONLY FOR NEW CLOUD EVENTS ---
        if (userNode.notifications.length > 0) {
            const latestNotif = userNode.notifications[0];
            
            if (this.lastNotifTime === null) {
                // First time loading the app, don't show popups for old stuff
                this.lastNotifTime = latestNotif.time;
            } else if (latestNotif.time > this.lastNotifTime) {
                // A BRAND NEW notification arrived! Show the WhatsApp-style popup!
                this.showToast(latestNotif.msg, latestNotif.taskId);
                this.lastNotifTime = latestNotif.time;
            }
        }
        // -------------------------------------------------------

        const unread = userNode.notifications.filter(n => !n.read).length;
        document.getElementById('notif-count').innerText = unread;
        document.getElementById('notif-count').style.display = unread > 0 ? 'inline-block' : 'none';

        const list = document.getElementById('notif-list');
        list.innerHTML = "";
        if (userNode.notifications.length === 0) {
            list.innerHTML = "<p style='padding:15px; text-align:center; color:#888;'>No notifications</p>";
        } else {
            userNode.notifications.forEach(n => {
                const clickAttr = n.taskId ? `onclick="core.handleNotifClick(${n.taskId}, event)" style="cursor:pointer;" title="Click to view task"` : '';
                list.innerHTML += `<div class="notif-item ${n.read ? '' : 'unread'}" ${clickAttr}>${n.msg}</div>`;
            });
        }
    },

    toggleNotifications() {
        const drop = document.getElementById('notif-dropdown');
        drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
        
        if (drop.style.display === 'block') {
            const group = this.db.groups[this.currentGroupCode];
            group.users[this.currentUser.name].notifications.forEach(n => n.read = true);
            this.save();
            this.updateNotificationUI();
        }
    },

    handleNotifClick(taskId, event) {
        if(event && event.stopPropagation) event.stopPropagation(); 
        
        const dropdown = document.getElementById('notif-dropdown');
        if (dropdown) dropdown.style.display = 'none'; 
        
        const group = this.db.groups[this.currentGroupCode];
        if (group && group.tasks) {
            const task = group.tasks.find(t => t.id === taskId);
            if (task) {
                this.activeSector = task.sector;
                this.viewTaskDetails(taskId);
            } else {
                alert("This task is no longer available (it may have been auto-cleared).");
            }
        }
    },

    checkOverdueTasks() {
        if (!this.currentGroupCode) return;
        const group = this.db.groups[this.currentGroupCode];
        if (!group.tasks) return;

        const now = new Date().getTime();
        let changed = false;

        group.tasks.forEach(task => {
            if (task.status !== 'completed' && new Date(task.dueDate).getTime() < now) {
                if (!task.overdueNotified) {
                    task.status = 'overdue';
                    task.overdueNotified = true;
                    
                    this.addNotification(
                        task.assignedTo, 
                        `⚠️ <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#ff4444;">Date limit crossed!</span>`, 
                        task.id
                    );
                    this.addNotification(
                        task.assignedBy, 
                        `⚠️ <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#ff4444;">${task.assignedTo} missed the limit!</span>`, 
                        task.id
                    );
                    changed = true;
                }
            }
        });
        if (changed) this.save();
    },

    updateAutoClear() {
        const val = document.getElementById('auto-clear-select').value;
        const group = this.db.groups[this.currentGroupCode];
        group.autoClearPref = val;
        this.save();
        this.runSystemMaintenance(); 
        this.renderTaskList();
    },

    runSystemMaintenance() {
        if (!this.currentGroupCode || !this.currentUser) return;
        const group = this.db.groups[this.currentGroupCode];
        let changed = false;
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        const userNode = group.users[this.currentUser.name];
        if (userNode && userNode.notifications) {
            const initLen = userNode.notifications.length;
            userNode.notifications = userNode.notifications.filter(n => (now - n.time) < oneDayMs);
            if (userNode.notifications.length !== initLen) changed = true;
        }

        const pref = group.autoClearPref || 'never';
        if (pref !== 'never' && group.tasks) {
            let limitMs = 0;
            if (pref === '24h') limitMs = oneDayMs;
            else if (pref === '1w') limitMs = 7 * oneDayMs;

            const initTaskLen = group.tasks.length;
            group.tasks = group.tasks.filter(t => {
                if (t.status === 'completed' && t.completedAt) {
                    return (now - t.completedAt) < limitMs; 
                }
                return true; 
            });
            if (group.tasks.length !== initTaskLen) changed = true;
        }

        if (changed) this.save();
    },

    logout() {
        this.currentUser = null;
        this.currentGroupCode = null;
        this.lastNotifTime = null; // UPGRADE: Reset notification tracker on logout
        localStorage.removeItem('TASK_SESSION'); 
        ui.show('view-initial');
    }
};

const ui = {
    show(id) {
        document.querySelectorAll('.view-container, .dashboard-view').forEach(v => v.style.display = 'none');
        document.getElementById(id).style.display = 'flex';
        
        if(id === 'view-dash' || id === 'view-tracking') {
            document.getElementById(id).style.display = 'block';
        }

        if(id === 'view-create') {
            document.getElementById('new-group-name').value = '';
            document.getElementById('new-group-name').disabled = false;
            document.getElementById('generated-code-box').style.display = 'none';
            document.getElementById('btn-create-group').style.display = 'block';
            document.getElementById('btn-proceed-login').style.display = 'none';
        }
    }
};

/* --- RUN ON PAGE LOAD --- */
window.onload = () => {
    core.init();
};

/* --- CLICK OUTSIDE TO CLOSE NOTIFICATION --- */
document.addEventListener('click', (event) => {
    const wrapper = document.querySelector('.notif-wrapper');
    const dropdown = document.getElementById('notif-dropdown');
    
    if (wrapper && dropdown && dropdown.style.display === 'block') {
        if (!wrapper.contains(event.target)) {
            dropdown.style.display = 'none'; 
        }
    }
});
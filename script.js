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
    databaseURL: "https://task-terminal-9e678-default-rtdb.asia-southeast1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);
const cloudDB = firebase.database().ref('TASK_TERMINAL_LIVE_DB');
const messaging = firebase.messaging();

const core = {
    db: { groups: {} },
    currentGroupCode: null,
    currentUser: null,
    
    activeSector: null,
    activeAssignee: null,
    activeTaskId: null,
    currentTab: 'all',
    lastNotifTime: null, 
    isMasterView: false, 
    pushSetupDone: false, // Prevents asking for permissions in an endless loop

    save() {
        cloudDB.set(this.db).catch((error) => {
            console.error("Cloud Write Failed:", error);
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

        cloudDB.on('value', (snapshot) => {
            const data = snapshot.val();
            this.db = data || { groups: {} };
            
            if (this.currentUser && this.currentGroupCode) {
                const group = this.db.groups[this.currentGroupCode];
                if (group && group.users && group.users[this.currentUser.name]) {
                    this.currentUser = { name: this.currentUser.name, ...group.users[this.currentUser.name] };
                    this.updateNotificationUI();
                    
                    // NEW: Smart 1-Hour Reminders
                    this.checkTaskDeadlines(); 
                    
                    if (document.getElementById('view-dash').style.display === 'block') this.renderDashboard();
                    if (document.getElementById('view-tracking').style.display === 'block') this.renderTaskList();
                    if (document.getElementById('view-task-details').style.display === 'block') this.viewTaskDetails(this.activeTaskId); 
                } else this.logout(); 
            }
        });

        if (session && session.user && session.groupCode) {
            this.setupPushNotifications(); 
            ui.show('view-dash');
        } else {
            ui.show('view-initial');
        }

        window.onpopstate = (event) => {
            if (event.state && event.state.viewId) {
                ui.show(event.state.viewId, false);
            }
        };
    },

    createGroup() {
        const nameInput = document.getElementById('new-group-name');
        const name = nameInput.value.trim();
        if (!name) return alert("Please enter a Group Name first.");
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.db.groups[code] = { name: name, sectors: [], users: {} };
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
                } else alert("Invalid Group Code. Please check and try again.");
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
                sectorList.innerHTML += `<label class="sector-checkbox-label"><input type="checkbox" class="sector-check" value="${sector}"> ${sector}</label>`;
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
            group.users[user] = { password: pass, role: role, enrolled: role === 'assignee' ? selectedSectors : [], pushToken: "" };
            alert(`New account recognized in group "${group.name}". Password set!`);
        } else {
            if (group.users[user].password !== pass) return alert("Incorrect password for this user.");
            if (role === 'assignee') group.users[user].enrolled = selectedSectors;
        }

        this.currentUser = { name: user, ...group.users[user] };
        this.save();
        this.saveSession(); 
        this.setupPushNotifications(); 
        this.renderDashboard();
        ui.show('view-dash');
    },

   // FIX: Stops the endless notification prompts
    // BULLETPROOF FIX: Stops the endless notification prompts using LocalStorage
    setupPushNotifications() {
        // 1. Check if the browser even supports notifications
        if (!('Notification' in window)) return;
        
        // 2. If already granted, just grab the token silently and start listening!
        if (Notification.permission === 'granted') {
            this.getFCMToken();
            return;
        }

        // 3. If they explicitly clicked "Block", leave them alone.
        if (Notification.permission === 'denied') return;

        // 4. THE MAGIC LOCK: Check if we have EVER asked them before on this device
        const hasAskedBefore = localStorage.getItem('TASK_PUSH_ASKED');
        if (hasAskedBefore) return; // We asked before, do not ask again!

        // 5. If we made it here, it's their very first time. 
        // Lock the door behind us so we never ask again, then show the prompt.
        localStorage.setItem('TASK_PUSH_ASKED', 'true');
        
        Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
                this.getFCMToken();
            }
        });
    },

    // Helper function (keep this exactly as it is from the last update)
    getFCMToken() {
        this.pushSetupDone = true;
        
        messaging.getToken({ vapidKey: 'BMk147uaBXMM2SqmwZm5A_9zkzwc-nwZXyOq9ftxClZ8nm1NPOZuObwb7QY1WxTzJkfXpU7B8QQyM3WWCNSK51I' })
        .then((currentToken) => {
            if (currentToken) {
                const group = this.db.groups[this.currentGroupCode];
                group.users[this.currentUser.name].pushToken = currentToken;
                this.save();
            }
        }).catch((err) => console.log('Token error: ', err));

        messaging.onMessage((payload) => { 
            this.showToast(payload.notification.body, null); 
        });
    },

    // Helper function to keep the code clean
    getFCMToken() {
        this.pushSetupDone = true;
        
        messaging.getToken({ vapidKey: 'BMk147uaBXMM2SqmwZm5A_9zkzwc-nwZXyOq9ftxClZ8nm1NPOZuObwb7QY1WxTzJkfXpU7B8QQyM3WWCNSK51I' })
        .then((currentToken) => {
            if (currentToken) {
                const group = this.db.groups[this.currentGroupCode];
                group.users[this.currentUser.name].pushToken = currentToken;
                this.save();
            }
        }).catch((err) => console.log('Token error: ', err));

        // Listen for foreground messages
        messaging.onMessage((payload) => { 
            this.showToast(payload.notification.body, null); 
        });
    },
    getFCMToken() {
        this.pushSetupDone = true;
        messaging.getToken({ vapidKey: 'BMk147uaBXMM2SqmwZm5A_9zkzwc-nwZXyOq9ftxClZ8nm1NPOZuObwb7QY1WxTzJkfXpU7B8QQyM3WWCNSK51I' })
        .then((currentToken) => {
            if (currentToken) {
                const group = this.db.groups[this.currentGroupCode];
                group.users[this.currentUser.name].pushToken = currentToken;
                this.save();
            }
        }).catch((err) => console.log('Token error: ', err));

        messaging.onMessage((payload) => { this.showToast(payload.notification.body, null); });
    },

    renderDashboard() {
        const display = document.getElementById('sector-display');
        const masterDisplay = document.getElementById('master-task-display');
        const authTools = document.getElementById('auth-tools');
        const globalControls = document.getElementById('global-controls');
        const statsBtn = document.getElementById('btn-stats');
        
        const group = this.db.groups[this.currentGroupCode];

        display.innerHTML = "";
        masterDisplay.innerHTML = "";
        document.getElementById('welcome-msg').innerText = `OFFICIAL PORTAL: ${this.currentUser.name.toUpperCase()}`;
        document.getElementById('group-name-display').innerText = `GROUP: ${group.name} (Code: ${this.currentGroupCode})`;

        this.checkTaskDeadlines();
        this.runSystemMaintenance(); 
        this.updateNotificationUI();

        if (this.currentUser.role === 'authority') {
            authTools.style.display = 'flex'; 
            globalControls.style.display = 'block';
            statsBtn.style.display = 'inline-block';
            
            if (this.isMasterView) {
                display.style.display = 'none';
                masterDisplay.style.display = 'flex';
                document.getElementById('welcome-msg').innerText = "ALL PENDING TASKS";
                
                const tasks = (group.tasks || []).filter(t => t.status !== 'completed').sort((a,b) => new Date(a.dueDate) - new Date(b.dueDate));
                if (tasks.length === 0) masterDisplay.innerHTML = `<p class="hint">No pending tasks across any sector.</p>`;
                tasks.forEach(t => this.renderGlobalTaskCard(t, masterDisplay));
            } else {
                display.style.display = 'grid';
                masterDisplay.style.display = 'none';
                document.getElementById('welcome-msg').innerText = `SECTOR OVERVIEW`;
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
            }
        } else {
            authTools.style.display = 'none';
            globalControls.style.display = 'none';
            statsBtn.style.display = 'none';
            display.style.display = 'grid';
            masterDisplay.style.display = 'none';
            
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

    toggleMasterView() {
        this.isMasterView = !this.isMasterView;
        document.getElementById('btn-master-toggle').innerText = this.isMasterView ? "VIEW SECTORS" : "VIEW ALL PENDING TASKS";
        document.getElementById('global-search').value = ''; 
        this.renderDashboard();
    },

    performGlobalSearch() {
        const query = document.getElementById('global-search').value.toLowerCase();
        const group = this.db.groups[this.currentGroupCode];
        const display = document.getElementById('sector-display');
        const masterDisplay = document.getElementById('master-task-display');

        if (!query) { this.renderDashboard(); return; }

        display.style.display = 'none';
        masterDisplay.style.display = 'flex';
        masterDisplay.innerHTML = `<h3 style="width:100%; font-size:14px; color:var(--corp-blue); margin-top:0;">SEARCH RESULTS</h3>`;
        
        let found = false;
        (group.tasks || []).forEach(t => {
            if (t.title.toLowerCase().includes(query) || t.sector.toLowerCase().includes(query) || t.assignedTo.toLowerCase().includes(query)) {
                this.renderGlobalTaskCard(t, masterDisplay);
                found = true;
            }
        });
        
        if (!found) masterDisplay.innerHTML += `<p class="hint">No tasks match your search.</p>`;
    },

    renderGlobalTaskCard(t, container) {
        let colorClass = t.status === 'completed' ? "status-green" : (t.status === 'overdue' ? "status-red" : (t.status === 'request' ? "status-purple" : "status-yellow"));
        let extraBtn = (this.currentUser.role === 'authority' && (t.status === 'pending' || t.status === 'overdue')) ? `<button class="btn-main assign-btn-small" onclick="event.stopPropagation(); core.sendReminder(${t.id})">REMINDER</button>` : "";
        container.innerHTML += `
            <div class="task-card ${colorClass}" onclick="core.handleGlobalTaskClick(${t.id}, '${t.sector}')">
                <div class="task-info">
                    <h4>${t.title}</h4>
                    <p class="task-meta"><strong>Sector:</strong> ${t.sector} | <strong>Due:</strong> ${new Date(t.dueDate).toLocaleString()} | <strong>To:</strong> ${t.assignedTo}</p>
                </div>
                ${extraBtn}
            </div>`;
    },

    handleGlobalTaskClick(taskId, sector) {
        this.activeSector = sector;
        this.viewTaskDetails(taskId);
    },

    renderAnalytics() {
        const group = this.db.groups[this.currentGroupCode];
        const tasks = group.tasks || [];
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

        const weeklyDone = tasks.filter(t => t.status === 'completed' && (now - t.completedAt) < oneWeekMs);
        
        let totalTimeMs = 0;
        const completionCounts = {};
        weeklyDone.forEach(t => {
            totalTimeMs += (t.completedAt - t.id); 
            completionCounts[t.assignedTo] = (completionCounts[t.assignedTo] || 0) + 1;
        });

        let avgHours = weeklyDone.length > 0 ? (totalTimeMs / weeklyDone.length / (1000 * 60 * 60)).toFixed(1) : 0;
        let topPerformer = "N/A";
        let maxDone = 0;
        for (let user in completionCounts) {
            if (completionCounts[user] > maxDone) { 
                maxDone = completionCounts[user]; 
                topPerformer = user; 
            }
        }

        document.getElementById('stats-content').innerHTML = `
            <div style="background:#f8fbff; padding:20px; border-radius:10px; border:1px solid #d0e3ff;">
                <h3 style="margin-top:0; color:var(--corp-blue);">7-Day Snapshot</h3>
                <p style="margin: 10px 0; font-size: 15px;"><strong>Tasks Completed:</strong> ${weeklyDone.length}</p>
                <p style="margin: 10px 0; font-size: 15px;"><strong>Average Turnaround:</strong> ${avgHours} Hours</p>
                <p style="margin: 10px 0; font-size: 15px;"><strong>Top Performer:</strong> ${topPerformer} (${maxDone} completed)</p>
            </div>
        `;
        ui.show('view-stats');
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
            } else alert("Sector already exists in this group!");
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
        document.getElementById('new-task-subtasks').value = ""; 
        ui.show('view-deploy-task');
    },

    deployTask() {
        const title = document.getElementById('new-task-title').value.trim();
        const dateLimit = document.getElementById('new-task-date').value;
        const subtasksText = document.getElementById('new-task-subtasks').value.trim();

        if (!title || !dateLimit) return alert("Task Name and Date Limit are required.");

        let subtasksArray = [];
        if (subtasksText) {
            subtasksArray = subtasksText.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => ({ title: line.trim(), done: false }));
        }

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
            overdueNotified: false,
            oneHourNotified: false, 
            subtasks: subtasksArray, 
            feedbackMsg: ""          
        };

        group.tasks.push(newTask);
        this.addNotification(this.activeAssignee, `📝 <strong>${title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">New task in ${this.activeSector} by ${this.currentUser.name}</span>`, newTask.id);
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
        this.checkTaskDeadlines(); 
        const group = this.db.groups[this.currentGroupCode];
        const container = document.getElementById('task-list-container');
        container.innerHTML = "";

        if (!group.tasks) group.tasks = [];
        let tasks = group.tasks.filter(t => t.sector === this.activeSector);
        if (this.currentUser.role === 'assignee') tasks = tasks.filter(t => t.assignedTo === this.currentUser.name);

        if (this.currentTab === 'pending') tasks = tasks.filter(t => t.status === 'pending' || t.status === 'overdue');
        else if (this.currentTab === 'requests') tasks = tasks.filter(t => t.status === 'request');
        else if (this.currentTab === 'completed') tasks = tasks.filter(t => t.status === 'completed');

        if (tasks.length === 0) {
            container.innerHTML = `<p class="hint">No tasks found in this category.</p>`;
            return;
        }

        tasks.forEach(t => {
            let colorClass = "status-yellow";
            if (t.status === 'completed') colorClass = "status-green";
            if (t.status === 'overdue') colorClass = "status-red";
            if (t.status === 'request') colorClass = "status-purple"; 

            let extraBtn = (this.currentUser.role === 'authority' && (t.status === 'pending' || t.status === 'overdue')) ? `<button class="btn-main assign-btn-small" onclick="event.stopPropagation(); core.sendReminder(${t.id})">REMINDER</button>` : "";
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

    toggleSubtask(taskId, subtaskIndex) {
        if (this.currentUser.role !== 'assignee') return; 
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === taskId);
        task.subtasks[subtaskIndex].done = !task.subtasks[subtaskIndex].done;
        this.save();
        this.viewTaskDetails(taskId);
    },

    viewTaskDetails(taskId) {
        const group = this.db.groups[this.currentGroupCode];
        if(!group.tasks) return;
        const task = group.tasks.find(t => t.id === taskId);
        if(!task) return; 

        this.activeTaskId = taskId;
        const content = document.getElementById('task-detail-content');
        
        let statusDisplay = task.status.toUpperCase();
        if (task.status === 'request') statusDisplay = 'PENDING APPROVAL ⏳';

        let feedbackHtml = '';
        if (task.feedbackMsg && (task.status === 'pending' || task.status === 'overdue')) {
            feedbackHtml = `
                <div style="background:#fff3cd; color:#856404; padding:12px; border-left:4px solid #ffeeba; margin-bottom:15px; border-radius:4px; font-size:14px; line-height:1.4;">
                    <strong>⚠️ AUTHORITY FEEDBACK:</strong><br>${task.feedbackMsg}
                </div>`;
        }

        let subtasksHtml = '';
        let allChecked = true; 
        if (task.subtasks && task.subtasks.length > 0) {
            subtasksHtml = `<div style="margin-top:15px; padding-top:15px; border-top:1px solid #eee;"><strong>Required Checklist:</strong><br>`;
            task.subtasks.forEach((st, index) => {
                if (!st.done) allChecked = false; 
                const isLocked = (this.currentUser.role !== 'assignee' || task.status === 'completed' || task.status === 'request') ? 'disabled' : '';
                const textStyle = st.done ? 'text-decoration:line-through; color:#aaa;' : 'color:#333;';
                
                subtasksHtml += `
                    <label style="display:flex; align-items:flex-start; gap:10px; margin-top:10px; font-size:14px; cursor:${isLocked ? 'default' : 'pointer'};">
                        <input type="checkbox" style="width:20px; height:20px; margin:0; flex-shrink:0;" 
                            ${st.done ? 'checked' : ''} ${isLocked} 
                            onchange="core.toggleSubtask(${task.id}, ${index})">
                        <span style="${textStyle} padding-top:2px;">${st.title}</span>
                    </label>
                `;
            });
            subtasksHtml += `</div>`;
        }

        content.innerHTML = `
            ${feedbackHtml}
            <p><strong>Title:</strong> ${task.title}</p>
            <p><strong>Sector:</strong> ${task.sector}</p>
            <p><strong>Assigned To:</strong> ${task.assignedTo}</p>
            <p><strong>Assigned By:</strong> ${task.assignedBy}</p>
            <p><strong>Date Limit:</strong> <span class="${task.status === 'overdue' ? 'accent-red' : ''}">${new Date(task.dueDate).toLocaleString()}</span></p>
            <p><strong>Status:</strong> <span style="font-weight:bold;">${statusDisplay}</span></p>
            ${subtasksHtml}
        `;

        const uploadZone = document.getElementById('assignee-upload-zone');
        const decisionZone = document.getElementById('authority-decision-zone');
        uploadZone.style.display = 'none';
        decisionZone.style.display = 'none';

        if (this.currentUser.role === 'assignee' && (task.status === 'pending' || task.status === 'overdue') && allChecked) {
            uploadZone.style.display = 'block';
        }
        if (this.currentUser.role === 'authority' && task.status === 'request') {
            decisionZone.style.display = 'flex';
        }
        ui.show('view-task-details');
    },

    submitRequest() {
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === this.activeTaskId);

        task.status = 'request';
        task.feedbackMsg = ""; 
        this.addNotification(task.assignedBy, `🙋 <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">${this.currentUser.name} submitted for review!</span>`, task.id);
        this.save();
        alert("Task submitted for approval!");
        this.openTracking();
    },

    processRequest(decision) {
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === this.activeTaskId);

        if (decision === 'agree') {
            task.status = 'completed';
            task.completedAt = Date.now(); 
            this.addNotification(task.assignedTo, `✅ <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">Approved by ${this.currentUser.name}</span>`, task.id);
            alert("Task Approved and Completed!");
        } else {
            const feedback = prompt("Why is this being returned? Enter feedback for the assignee:");
            if (!feedback) return alert("Feedback is required to return a task for review.");
            const newTime = prompt("Review Required. Enter new Date Limit (YYYY-MM-DD HH:MM):", task.dueDate);
            if (!newTime) return; 
            
            task.status = 'pending';
            task.dueDate = newTime;
            task.overdueNotified = false;
            task.oneHourNotified = false; 
            task.feedbackMsg = feedback; 
            
            this.addNotification(task.assignedTo, `🔄 <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">Sent back for review. Read the feedback!</span>`, task.id);
            alert("Task sent back to Assignee with your feedback.");
        }
        this.save();
        this.openTracking();
    },

    sendReminder(taskId) {
        const group = this.db.groups[this.currentGroupCode];
        const task = group.tasks.find(t => t.id === taskId);
        this.addNotification(task.assignedTo, `🔔 <strong>${task.title.toUpperCase()}</strong><br><span style="font-size:12px; color:#aaa;">Reminder: Due by ${new Date(task.dueDate).toLocaleDateString()}</span>`, task.id);
        this.save();
        alert("Reminder sent to " + task.assignedTo);
    },

    addNotification(username, msg, taskId = null) {
        const group = this.db.groups[this.currentGroupCode];
        if (!group.users[username].notifications) group.users[username].notifications = [];
        group.users[username].notifications.unshift({ msg: msg, read: false, time: Date.now(), taskId: taskId });
        this.save();
        this.sendPushToUser(username, "Task Terminal", msg.replace(/<[^>]*>?/gm, ''));
        if (this.currentUser && this.currentUser.name === username) this.updateNotificationUI();
    },

    showToast(htmlMsg, taskId) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.innerHTML = htmlMsg;
        if (taskId) {
            toast.onclick = () => {
                this.handleNotifClick(taskId, { stopPropagation: () => {} });
                toast.style.animation = 'fadeOutRight 0.3s forwards';
                setTimeout(() => toast.remove(), 300);
            };
        }
        container.appendChild(toast);
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

        if (userNode.notifications.length > 0) {
            const latestNotif = userNode.notifications[0];
            if (this.lastNotifTime === null) this.lastNotifTime = latestNotif.time;
            else if (latestNotif.time > this.lastNotifTime) {
                this.showToast(latestNotif.msg, latestNotif.taskId);
                this.lastNotifTime = latestNotif.time;
            }
        }
        const unread = userNode.notifications.filter(n => !n.read).length;
        document.getElementById('notif-count').innerText = unread;
        document.getElementById('notif-count').style.display = unread > 0 ? 'inline-block' : 'none';

        const list = document.getElementById('notif-list');
        list.innerHTML = "";
        if (userNode.notifications.length === 0) list.innerHTML = "<p style='padding:15px; text-align:center; color:#888;'>No notifications</p>";
        else {
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
            } else alert("This task is no longer available.");
        }
    },

    // OVERDUE AND 1-HOUR REMINDERS LOGIC
    checkTaskDeadlines() {
        if (!this.currentGroupCode) return;
        const group = this.db.groups[this.currentGroupCode];
        if (!group.tasks) return;

        const now = Date.now();
        let changed = false;

        group.tasks.forEach(task => {
            if (task.status !== 'completed' && task.status !== 'request') {
                const timeDiff = new Date(task.dueDate).getTime() - now;

                // Overdue
                if (timeDiff <= 0 && !task.overdueNotified) {
                    task.status = 'overdue';
                    task.overdueNotified = true;
                    this.addNotification(task.assignedTo, `⚠️ <strong>OVERDUE:</strong> ${task.title.toUpperCase()}`, task.id);
                    this.addNotification(task.assignedBy, `⚠️ <strong>OVERDUE:</strong> ${task.assignedTo} missed the limit on ${task.title.toUpperCase()}!`, task.id);
                    changed = true;
                }
                // 1-Hour Warning (Between 0ms and 3600000ms)
                else if (timeDiff > 0 && timeDiff <= 3600000 && !task.oneHourNotified) {
                    task.oneHourNotified = true;
                    this.addNotification(task.assignedTo, `🔥 <strong>1 HOUR REMAINING:</strong> ${task.title.toUpperCase()}`, task.id);
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
                if (t.status === 'completed' && t.completedAt) return (now - t.completedAt) < limitMs; 
                return true; 
            });
            if (group.tasks.length !== initTaskLen) changed = true;
        }
        if (changed) this.save();
    },

    logout() {
        this.currentUser = null;
        this.currentGroupCode = null;
        this.lastNotifTime = null; 
        localStorage.removeItem('TASK_SESSION'); 
        ui.show('view-initial');
    },

    async sendPushToUser(targetUsername, title, body) {
        const group = this.db.groups[this.currentGroupCode];
        const targetUser = group.users[targetUsername];
        if (!targetUser || !targetUser.pushToken) return;

        // REPLACE THIS WITH YOUR REAL FCM SERVER KEY
        const fcmServerKey = "BMk147uaBXMM2SqmwZm5A_9zkzwc-nwZXyOq9ftxClZ8nm1NPOZuObwb7QY1WxTzJkfXpU7B8QQyM3WWCNSK51I"; 

        const message = { notification: { title: title, body: body }, to: targetUser.pushToken };
        fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: { 'Authorization': 'key=' + fcmServerKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        }).catch(err => console.error("Push failed:", err));
    }
};

const ui = {
    show(id, pushToHistory = true) {
        document.querySelectorAll('.view-container, .dashboard-view').forEach(v => v.style.display = 'none');
        document.getElementById(id).style.display = 'flex';
        
        if(id === 'view-dash' || id === 'view-tracking') {
            document.getElementById(id).style.display = 'block';
        }

        if (pushToHistory) {
            history.pushState({ viewId: id }, "", ""); 
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

window.onload = () => { core.init(); };

document.addEventListener('click', (event) => {
    const wrapper = document.querySelector('.notif-wrapper');
    const dropdown = document.getElementById('notif-dropdown');
    if (wrapper && dropdown && dropdown.style.display === 'block') {
        if (!wrapper.contains(event.target)) dropdown.style.display = 'none'; 
    }
});

/* --- PWA INSTALLATION LOGIC --- */
let deferredPrompt;
const installBtn = document.getElementById('btn-install-pwa');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'block';
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            installBtn.style.display = 'none';
        }
    });
}

window.addEventListener('appinstalled', () => { 
    if (installBtn) installBtn.style.display = 'none'; 
});
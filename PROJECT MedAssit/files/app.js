// =============================================
// MEDASSIST — app.js
// Firebase + Full App Logic
// =============================================

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcqBnNcZ29W1OF0uEQABzibEZYeq3Sc5M",
  authDomain: "medassist-fd155.firebaseapp.com",
  projectId: "medassist-fd155",
  storageBucket: "medassist-fd155.firebasestorage.app",
  messagingSenderId: "385109263502",
  appId: "1:385109263502:web:e2e8209b21973b62c375df",
  measurementId: "G-LT1G4PRE0D"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// =============================================
// STATE
// =============================================
let currentUser = null;
let currentRole = null;
let medicines = [];
let todayDoses = [];
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let selectedColor = '#4F8EF7';
let editingMedId = null;
let currentDoseContext = null;
let currentRestockMedId = null;
let notifications = [];
let reminderIntervals = [];

// =============================================
// INIT
// =============================================
window.addEventListener('DOMContentLoaded', () => {
  // Set today's date as default for start date
  document.getElementById('med-start-date').value = new Date().toISOString().split('T')[0];

  // Check for family role on register page
  document.getElementById('reg-role').addEventListener('change', function() {
    const group = document.getElementById('patient-code-group');
    group.classList.toggle('hidden', this.value !== 'family');
  });

  // Splash then auth
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.display = 'none';
      auth.onAuthStateChanged(handleAuthState);
    }, 500);
  }, 2000);

  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

function handleAuthState(user) {
  if (user) {
    currentUser = user;
    db.collection('users').doc(user.uid).get().then(doc => {
      if (doc.exists) {
        const data = doc.data();
        currentRole = data.role;
        if (currentRole === 'family') {
          showScreen('family-dashboard');
          initFamilyDashboard(data);
        } else {
          showScreen('patient-dashboard');
          initPatientDashboard(data);
        }
      } else {
        showScreen('auth-screen');
        showAuthTypeSelect();
      }
    });
  } else {
    showScreen('auth-screen');
    showAuthTypeSelect();
  }
}

// =============================================
// AUTH FUNCTIONS
// =============================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showAuthTypeSelect() {
  hideAllAuthForms();
  document.getElementById('auth-type-select').classList.remove('hidden');
}

function showLoginForm(type) {
  hideAllAuthForms();
  document.getElementById(`${type}-login`).classList.remove('hidden');
}

function showRegister(type) {
  hideAllAuthForms();
  document.getElementById('register-form').classList.remove('hidden');
  if (type) document.getElementById('reg-role').value = type;
  document.getElementById('patient-code-group').classList.toggle('hidden', type !== 'family');
}

function hideAllAuthForms() {
  ['auth-type-select','patient-login','family-login','register-form'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

async function loginPatient() {
  const email = document.getElementById('patient-email').value.trim();
  const password = document.getElementById('patient-password').value;
  if (!email || !password) { showToast('Please fill in all fields', 'error'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showToast(friendlyError(e.code), 'error');
  }
}

async function loginFamily() {
  const email = document.getElementById('family-email').value.trim();
  const password = document.getElementById('family-password').value;
  if (!email || !password) { showToast('Please fill in all fields', 'error'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showToast(friendlyError(e.code), 'error');
  }
}

async function registerUser() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  const patientCode = document.getElementById('reg-patient-code').value.trim();

  if (!name || !email || !password) { showToast('Please fill in all fields', 'error'); return; }
  if (role === 'family' && !patientCode) { showToast('Please enter the patient code', 'error'); return; }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    const userDoc = { name, email, role, createdAt: new Date().toISOString() };

    if (role === 'patient') {
      const code = 'MED-' + uid.substring(0, 6).toUpperCase();
      userDoc.familyCode = code;
      userDoc.familyMembers = [];
    } else {
      userDoc.linkedPatientCode = patientCode;
    }

    await db.collection('users').doc(uid).set(userDoc);
    showToast('Account created! Welcome 🎉', 'success');
  } catch (e) {
    showToast(friendlyError(e.code), 'error');
  }
}

function logout() {
  clearReminders();
  auth.signOut();
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found': 'No account with that email',
    'auth/wrong-password': 'Incorrect password',
    'auth/email-already-in-use': 'Email already registered',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/invalid-email': 'Invalid email address',
    'auth/too-many-requests': 'Too many attempts. Try again later',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// =============================================
// PATIENT DASHBOARD
// =============================================
function initPatientDashboard(userData) {
  document.getElementById('greeting-text').textContent = getGreeting() + ', ' + (userData.name || 'there') + '!';
  document.getElementById('profile-name').textContent = userData.name || 'Patient';
  document.getElementById('profile-email').textContent = userData.email || '';
  document.getElementById('patient-code-display').textContent = userData.familyCode || '—';

  updateTimePickers(); // init default time pickers
  selectFirstColor();
  loadMedicines();
  setupNotificationScheduler();
  renderCalendar();
}

async function loadMedicines() {
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection('medicines').get();
    medicines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMedicines();
    renderTodayDoses();
    checkStockAlerts();
  } catch (e) {
    console.error(e);
  }
}

// =============================================
// MEDICINES CRUD
// =============================================
function openAddMedicine() {
  editingMedId = null;
  document.getElementById('modal-med-title').textContent = 'Add Medicine';
  document.getElementById('med-name').value = '';
  document.getElementById('med-purpose').value = '';
  document.getElementById('med-times').value = '1';
  document.getElementById('med-stock').value = '';
  document.getElementById('med-duration').value = '';
  document.getElementById('med-start-date').value = new Date().toISOString().split('T')[0];
  selectedColor = '#4F8EF7';
  selectFirstColor();
  updateTimePickers();
  document.getElementById('modal-medicine').classList.remove('hidden');
}

function openEditMedicine(med) {
  editingMedId = med.id;
  document.getElementById('modal-med-title').textContent = 'Edit Medicine';
  document.getElementById('med-name').value = med.name;
  document.getElementById('med-purpose').value = med.purpose || '';
  document.getElementById('med-times').value = med.timesPerDay;
  document.getElementById('med-stock').value = med.currentStock;
  document.getElementById('med-duration').value = med.duration;
  document.getElementById('med-start-date').value = med.startDate || new Date().toISOString().split('T')[0];
  selectedColor = med.color || '#4F8EF7';
  updateTimePickers(med.times);
  // Set color dots
  document.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('selected', d.dataset.color === selectedColor);
  });
  document.getElementById('modal-medicine').classList.remove('hidden');
}

function closeMedicineModal() {
  document.getElementById('modal-medicine').classList.add('hidden');
}

function updateTimePickers(existingTimes) {
  const count = parseInt(document.getElementById('med-times').value) || 1;
  const container = document.getElementById('time-pickers');
  const labels = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const defaults = ['08:00', '13:00', '18:00', '22:00'];
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:11px;color:var(--text-muted);';
    lbl.textContent = labels[i] || `Dose ${i+1}`;
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'time-input';
    input.value = (existingTimes && existingTimes[i]) ? existingTimes[i] : defaults[i];
    wrap.append(lbl, input);
    container.appendChild(wrap);
  }
}

function selectColor(btn) {
  selectedColor = btn.dataset.color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  btn.classList.add('selected');
}

function selectFirstColor() {
  const first = document.querySelector('.color-dot');
  if (first) { selectedColor = first.dataset.color; first.classList.add('selected'); }
}

async function saveMedicine() {
  const name = document.getElementById('med-name').value.trim();
  const purpose = document.getElementById('med-purpose').value.trim();
  const timesPerDay = parseInt(document.getElementById('med-times').value);
  const stock = parseInt(document.getElementById('med-stock').value);
  const duration = parseInt(document.getElementById('med-duration').value);
  const startDate = document.getElementById('med-start-date').value;
  const timeInputs = document.querySelectorAll('.time-input');
  const times = Array.from(timeInputs).map(i => i.value);

  if (!name || !stock || !duration) {
    showToast('Please fill in required fields', 'error'); return;
  }

  const data = {
    name, purpose, timesPerDay, totalStock: stock,
    currentStock: editingMedId
      ? (medicines.find(m => m.id === editingMedId)?.currentStock ?? stock)
      : stock,
    duration, startDate, times, color: selectedColor,
    updatedAt: new Date().toISOString(),
  };

  try {
    const ref = db.collection('users').doc(currentUser.uid).collection('medicines');
    if (editingMedId) {
      await ref.doc(editingMedId).update(data);
      showToast('Medicine updated!', 'success');
    } else {
      data.createdAt = new Date().toISOString();
      await ref.add(data);
      showToast('Medicine added!', 'success');
    }
    closeMedicineModal();
    loadMedicines();
  } catch (e) {
    showToast('Error saving medicine', 'error');
    console.error(e);
  }
}

async function deleteMedicine(id) {
  if (!confirm('Remove this medicine?')) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('medicines').doc(id).delete();
    showToast('Medicine removed', 'success');
    loadMedicines();
  } catch (e) {
    showToast('Error removing medicine', 'error');
  }
}

// =============================================
// RESTOCK
// =============================================
function openRestockModal(medId) {
  const med = medicines.find(m => m.id === medId);
  if (!med) return;
  currentRestockMedId = medId;
  document.getElementById('restock-med-name').textContent = med.name;
  document.getElementById('restock-current-stock').textContent = med.currentStock + ' tablets remaining';
  document.getElementById('restock-amount').value = '';
  document.getElementById('modal-restock').classList.remove('hidden');
}

function closeRestockModal() {
  document.getElementById('modal-restock').classList.add('hidden');
  currentRestockMedId = null;
}

async function confirmRestock() {
  const amount = parseInt(document.getElementById('restock-amount').value);
  if (!amount || amount < 1) { showToast('Enter a valid amount', 'error'); return; }
  const med = medicines.find(m => m.id === currentRestockMedId);
  if (!med) return;
  const newStock = med.currentStock + amount;
  try {
    await db.collection('users').doc(currentUser.uid).collection('medicines')
      .doc(currentRestockMedId).update({ currentStock: newStock });
    showToast(`Stock updated to ${newStock} tablets`, 'success');
    closeRestockModal();
    loadMedicines();
  } catch (e) {
    showToast('Error updating stock', 'error');
  }
}

// =============================================
// DOSE LOGGING
// =============================================
function openDoseModal(dose) {
  currentDoseContext = dose;
  document.getElementById('dose-modal-med-name').textContent = dose.medName;
  document.getElementById('dose-modal-time').textContent = `Scheduled: ${formatTime(dose.time)} · ${todayStr()}`;
  document.getElementById('modal-dose').classList.remove('hidden');
}

function closeDoseModal() {
  document.getElementById('modal-dose').classList.add('hidden');
  currentDoseContext = null;
}

async function logDose(status) {
  if (!currentDoseContext) return;
  const d = currentDoseContext;
  const dateStr = todayStr();
  const logId = `${d.medId}_${d.time}_${dateStr}`;

  try {
    await db.collection('users').doc(currentUser.uid).collection('doseLogs').doc(logId).set({
      medId: d.medId, medName: d.medName,
      time: d.time, date: dateStr,
      status, loggedAt: new Date().toISOString()
    });

    // Decrement stock if taken
    if (status === 'taken') {
      const med = medicines.find(m => m.id === d.medId);
      if (med && med.currentStock > 0) {
        await db.collection('users').doc(currentUser.uid).collection('medicines')
          .doc(d.medId).update({ currentStock: med.currentStock - 1 });
      }
    }

    showToast(status === 'taken' ? '✓ Dose marked as taken' : '✗ Dose marked as missed',
      status === 'taken' ? 'success' : 'error');
    closeDoseModal();
    loadMedicines();
  } catch (e) {
    showToast('Error logging dose', 'error');
    console.error(e);
  }
}

// =============================================
// RENDER FUNCTIONS
// =============================================
function renderMedicines() {
  const container = document.getElementById('medicines-list');
  if (!medicines.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">💊</div>
      <p>No medicines added yet</p>
      <button class="btn-primary" onclick="openAddMedicine()">Add Your First Medicine</button>
    </div>`;
    return;
  }

  container.innerHTML = medicines.map(med => {
    const stockPct = Math.round((med.currentStock / med.totalStock) * 100);
    const daysLeft = Math.floor(med.currentStock / med.timesPerDay);
    const isLow = daysLeft <= 3;
    const barColor = isLow ? 'var(--red)' : stockPct > 50 ? 'var(--green)' : 'var(--orange)';

    return `
    <div class="medicine-card">
      <div class="med-card-top">
        <div class="med-color-bar" style="background:${med.color || '#4F8EF7'}"></div>
        <div class="med-info">
          <div class="med-name">${med.name}</div>
          ${med.purpose ? `<div class="med-purpose">${med.purpose}</div>` : ''}
          <div class="med-stats">
            <div class="med-stat"><span class="stat-num">${med.timesPerDay}x</span>/day</div>
            <div class="med-stat">🗓 <span class="stat-num">${med.duration}</span> days</div>
            <div class="med-stat">⏰ ${med.times ? med.times.join(', ') : '—'}</div>
          </div>
          <div class="med-stock-bar">
            <div class="med-stock-label">
              <span>Stock: ${med.currentStock}/${med.totalStock} tablets</span>
              <span style="color:${isLow ? 'var(--red)' : 'var(--text-muted)'}">
                ${isLow ? '⚠️ ' : ''}${daysLeft} day${daysLeft !== 1 ? 's' : ''} left
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${stockPct}%;background:${barColor}"></div>
            </div>
          </div>
        </div>
        <div class="med-actions">
          <button class="med-restock-btn" onclick="openRestockModal('${med.id}')" title="Restock">➕</button>
          <button class="med-edit-btn" onclick="openEditMedicine(medicines.find(m=>m.id==='${med.id}'))" title="Edit">✏️</button>
          <button class="med-delete-btn" onclick="deleteMedicine('${med.id}')" title="Delete">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function renderTodayDoses() {
  const container = document.getElementById('upcoming-doses-list');
  const today = todayStr();
  todayDoses = [];

  // Build all doses for today
  for (const med of medicines) {
    if (!med.times) continue;
    const endDate = addDays(med.startDate || today, med.duration);
    if (today > endDate) continue;

    for (const time of med.times) {
      todayDoses.push({
        medId: med.id, medName: med.name, time,
        color: med.color || '#4F8EF7', purpose: med.purpose
      });
    }
  }
  todayDoses.sort((a, b) => a.time.localeCompare(b.time));

  // Load today's logs
  const logsSnap = await db.collection('users').doc(currentUser.uid)
    .collection('doseLogs').where('date', '==', today).get();
  const logs = {};
  logsSnap.docs.forEach(d => {
    const data = d.data();
    logs[`${data.medId}_${data.time}`] = data.status;
  });

  // Update overview counts
  let taken = 0, missed = 0, upcoming = 0;
  const now = new Date();
  const nowStr = now.toTimeString().substring(0, 5);

  todayDoses.forEach(d => {
    const key = `${d.medId}_${d.time}`;
    d.status = logs[key] || (d.time < nowStr ? 'pending' : 'upcoming');
    if (d.status === 'taken') taken++;
    else if (d.status === 'missed') missed++;
    else if (d.status === 'pending') missed++;
    else upcoming++;
  });

  document.getElementById('ov-total').textContent = todayDoses.length;
  document.getElementById('ov-taken').textContent = taken;
  document.getElementById('ov-missed').textContent = missed;
  document.getElementById('ov-upcoming').textContent = upcoming;

  // Adherence
  const total = taken + missed;
  const pct = total > 0 ? Math.round((taken / total) * 100) : 100;
  updateAdherenceRing(pct);

  if (!todayDoses.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🌿</div>
      <p>No doses scheduled today</p>
      <button class="btn-secondary" onclick="switchTab('medicines')">Add Medicine</button>
    </div>`;
    return;
  }

  const upcomingDoses = todayDoses.filter(d => d.status === 'upcoming' || d.status === 'pending');
  if (!upcomingDoses.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <p>All doses handled for today!</p>
    </div>`;
    return;
  }

  container.innerHTML = upcomingDoses.slice(0, 5).map(d => {
    const statusMap = { upcoming: 'upcoming', pending: 'pending', taken: 'taken', missed: 'missed' };
    const statusLabel = { upcoming: 'Upcoming', pending: 'Due Now', taken: 'Taken', missed: 'Missed' };
    return `<div class="dose-item" onclick="openDoseModal(${JSON.stringify(d).replace(/"/g, '&quot;')})">
      <div class="dose-color-dot" style="background:${d.color}"></div>
      <div class="dose-info">
        <div class="dose-name">${d.medName}</div>
        <div class="dose-meta">${d.purpose || 'Medication'}</div>
      </div>
      <div class="dose-time">${formatTime(d.time)}</div>
      <div class="dose-status status-${statusMap[d.status]}">${statusLabel[d.status]}</div>
    </div>`;
  }).join('');
}

function updateAdherenceRing(pct) {
  const circle = document.getElementById('adherence-circle');
  const circumference = 314;
  const offset = circumference - (pct / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
  circle.style.stroke = color;
  document.getElementById('adherence-pct').textContent = pct + '%';

  const msgs = [
    [90, "Excellent adherence! Keep it up! 🌟"],
    [70, "Good job! Almost perfect adherence."],
    [50, "You can do better. Stay consistent!"],
    [0, "Low adherence today. Take your medicines!"]
  ];
  const msg = msgs.find(([min]) => pct >= min)?.[1] || msgs[3][1];
  document.getElementById('adherence-msg').textContent = msg;
}

function checkStockAlerts() {
  const alerts = [];
  medicines.forEach(med => {
    const daysLeft = Math.floor(med.currentStock / med.timesPerDay);
    if (daysLeft <= 3) {
      alerts.push({ med, daysLeft, critical: daysLeft === 0 });
    }
  });

  const section = document.getElementById('stock-alert-section');
  const list = document.getElementById('stock-alert-list');

  if (!alerts.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.critical ? 'critical' : ''}">
      <div class="alert-info">
        <div class="alert-name">${a.med.name}</div>
        <div class="alert-msg">
          ${a.critical ? '⛔ Out of stock!' : `⚠️ Only ${a.daysLeft} day${a.daysLeft !== 1 ? 's' : ''} of stock left`}
        </div>
      </div>
      <button class="btn-restock" onclick="openRestockModal('${a.med.id}')">Restock</button>
    </div>`).join('');

  // Add to notifications
  alerts.forEach(a => {
    addNotification(
      a.critical ? '⛔ Out of Stock!' : '⚠️ Low Stock Alert',
      `${a.med.name}: ${a.critical ? 'No tablets remaining' : `${a.daysLeft} day(s) left`}. Please restock.`
    );
  });
}

// =============================================
// NOTIFICATION SYSTEM
// =============================================
function setupNotificationScheduler() {
  clearReminders();
  if (!medicines.length) return;

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  medicines.forEach(med => {
    if (!med.times) return;
    med.times.forEach(time => {
      const [h, m] = time.split(':').map(Number);
      scheduleReminder(med, h, m);
    });
  });
}

function scheduleReminder(med, hour, minute) {
  const check = () => {
    const now = new Date();
    if (now.getHours() === hour && now.getMinutes() === minute) {
      const msg = `Time to take ${med.name}`;
      addNotification('💊 Medication Reminder', msg);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('MedAssist — Time for your medicine', {
          body: msg, icon: '💊', badge: '💊'
        });
      }
    }
  };
  const interval = setInterval(check, 60000);
  reminderIntervals.push(interval);
  check(); // check immediately
}

function clearReminders() {
  reminderIntervals.forEach(clearInterval);
  reminderIntervals = [];
}

function addNotification(title, body) {
  notifications.unshift({ title, body, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  const badge = document.getElementById('notif-badge');
  badge.textContent = notifications.length > 9 ? '9+' : notifications.length;
  badge.classList.remove('hidden');
  renderNotificationList();
}

function renderNotificationList() {
  const list = document.getElementById('notif-list');
  if (!notifications.length) {
    list.innerHTML = '<p class="empty-notif">No notifications</p>';
    return;
  }
  list.innerHTML = notifications.map(n => `
    <div class="notif-item">
      <div class="notif-item-title">${n.title}</div>
      <div class="notif-item-body">${n.body}</div>
      <div class="notif-item-time">${n.time}</div>
    </div>`).join('');
}

function showNotifications() {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('hidden');
  // Clear badge
  document.getElementById('notif-badge').classList.add('hidden');
  document.getElementById('notif-badge').textContent = '0';
}

function closeNotifications() {
  document.getElementById('notif-panel').classList.add('hidden');
}

// =============================================
// CALENDAR
// =============================================
function renderCalendar() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent = `${monthNames[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const today = new Date();

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  // Load logs for this month async
  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  db.collection('users').doc(currentUser.uid).collection('doseLogs')
    .where('date', '>=', monthStr + '-01')
    .where('date', '<=', monthStr + '-31')
    .get().then(snap => {
      const logMap = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!logMap[data.date]) logMap[data.date] = { taken: 0, total: 0 };
        logMap[data.date].total++;
        if (data.status === 'taken') logMap[data.date].taken++;
      });
      renderCalendarDays(firstDay, daysInMonth, daysInPrev, today, monthStr, logMap);
    }).catch(() => {
      renderCalendarDays(firstDay, daysInMonth, daysInPrev, today, monthStr, {});
    });
}

function renderCalendarDays(firstDay, daysInMonth, daysInPrev, today, monthStr, logMap) {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    let dateStr;

    if (i < firstDay) {
      const d = daysInPrev - firstDay + i + 1;
      cell.textContent = d;
      cell.classList.add('other-month');
    } else if (i >= firstDay + daysInMonth) {
      cell.textContent = i - firstDay - daysInMonth + 1;
      cell.classList.add('other-month');
    } else {
      const d = i - firstDay + 1;
      dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      cell.textContent = d;

      if (d === today.getDate() && parseInt(monthStr.split('-')[1]) === today.getMonth() + 1
          && parseInt(monthStr.split('-')[0]) === today.getFullYear()) {
        cell.classList.add('today');
      }

      if (logMap[dateStr]) {
        const log = logMap[dateStr];
        cell.classList.add('has-doses');
        if (log.total > 0) {
          if (log.taken === log.total) cell.classList.add('all-taken');
          else if (log.taken === 0) cell.classList.add('all-missed');
          else cell.classList.add('partial');
        }
        cell.addEventListener('click', () => showDayDetail(dateStr, log));
      }
    }
    grid.appendChild(cell);
  }
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
  document.getElementById('cal-day-detail').classList.add('hidden');
}

async function showDayDetail(dateStr, log) {
  const detail = document.getElementById('cal-day-detail');
  const dateLabel = document.getElementById('cal-detail-date');
  const list = document.getElementById('cal-detail-list');
  detail.classList.remove('hidden');

  const d = new Date(dateStr + 'T00:00:00');
  dateLabel.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const snap = await db.collection('users').doc(currentUser.uid)
    .collection('doseLogs').where('date', '==', dateStr).get();

  if (snap.empty) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No logs for this day.</p>';
    return;
  }

  list.innerHTML = snap.docs.map(d => {
    const data = d.data();
    return `<div class="dose-item" style="cursor:default">
      <div class="dose-info">
        <div class="dose-name">${data.medName}</div>
        <div class="dose-meta">${formatTime(data.time)}</div>
      </div>
      <div class="dose-status status-${data.status}">${data.status === 'taken' ? '✓ Taken' : '✗ Missed'}</div>
    </div>`;
  }).join('');
}

// =============================================
// FAMILY DASHBOARD
// =============================================
function initFamilyDashboard(userData) {
  if (userData.linkedPatientCode) {
    document.getElementById('family-code-input').value = userData.linkedPatientCode;
    loadPatientData();
  }
}

async function loadPatientData() {
  const code = document.getElementById('family-code-input').value.trim().toUpperCase();
  if (!code) { showToast('Please enter a patient code', 'error'); return; }

  try {
    const snap = await db.collection('users').where('familyCode', '==', code).limit(1).get();
    if (snap.empty) { showToast('Patient code not found', 'error'); return; }

    const patientDoc = snap.docs[0];
    const patientId = patientDoc.id;
    const patientData = patientDoc.data();

    document.getElementById('family-patient-info').classList.add('hidden');
    document.getElementById('family-patient-data').classList.remove('hidden');
    document.getElementById('fam-patient-name').textContent = patientData.name || 'Patient';

    // Load medicines
    const medSnap = await db.collection('users').doc(patientId).collection('medicines').get();
    const meds = medSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Today's logs
    const today = todayStr();
    const logsSnap = await db.collection('users').doc(patientId)
      .collection('doseLogs').where('date', '==', today).get();
    const logs = {};
    logsSnap.docs.forEach(d => {
      const data = d.data();
      logs[`${data.medId}_${data.time}`] = data.status;
    });

    // Build doses
    let allDoses = [];
    meds.forEach(med => {
      if (med.times) {
        med.times.forEach(time => {
          const key = `${med.id}_${time}`;
          allDoses.push({
            medName: med.name, time,
            color: med.color || '#4F8EF7',
            status: logs[key] || 'pending'
          });
        });
      }
    });
    allDoses.sort((a, b) => a.time.localeCompare(b.time));

    const taken = allDoses.filter(d => d.status === 'taken').length;
    const pct = allDoses.length > 0 ? Math.round((taken / allDoses.length) * 100) : 100;
    document.getElementById('fam-adherence').textContent = `${pct}% Today`;

    // Render doses
    const doseList = document.getElementById('fam-doses-list');
    doseList.innerHTML = allDoses.map(d => `
      <div class="dose-item" style="cursor:default">
        <div class="dose-color-dot" style="background:${d.color}"></div>
        <div class="dose-info">
          <div class="dose-name">${d.medName}</div>
          <div class="dose-meta">${formatTime(d.time)}</div>
        </div>
        <div class="dose-status status-${d.status}">${
          d.status === 'taken' ? '✓ Taken' :
          d.status === 'missed' ? '✗ Missed' : '⏳ Pending'
        }</div>
      </div>`).join('') || '<p style="color:var(--text-muted);text-align:center;padding:16px">No doses today</p>';

    // Render medicines
    const medList = document.getElementById('fam-medicines-list');
    medList.innerHTML = meds.map(m => {
      const daysLeft = Math.floor(m.currentStock / m.timesPerDay);
      return `<div class="medicine-card">
        <div class="med-card-top">
          <div class="med-color-bar" style="background:${m.color || '#4F8EF7'}"></div>
          <div class="med-info">
            <div class="med-name">${m.name}</div>
            ${m.purpose ? `<div class="med-purpose">${m.purpose}</div>` : ''}
            <div class="med-stats">
              <div class="med-stat"><span class="stat-num">${m.timesPerDay}x</span>/day</div>
              <div class="med-stat">Stock: <span class="stat-num">${m.currentStock}</span></div>
              <div class="med-stat">⏳ <span class="stat-num">${daysLeft}</span> days left</div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') || '<p style="color:var(--text-muted);text-align:center;padding:16px">No medicines</p>';

    // Stock alerts
    const stockAlerts = meds.filter(m => Math.floor(m.currentStock / m.timesPerDay) <= 3);
    const stockList = document.getElementById('fam-stock-alerts');
    stockList.innerHTML = stockAlerts.map(m => {
      const d = Math.floor(m.currentStock / m.timesPerDay);
      return `<div class="alert-item ${d === 0 ? 'critical' : ''}">
        <div class="alert-info">
          <div class="alert-name">${m.name}</div>
          <div class="alert-msg">${d === 0 ? '⛔ Out of stock!' : `⚠️ ${d} day(s) left`}</div>
        </div>
      </div>`;
    }).join('') || '<p style="color:var(--text-muted);text-align:center;padding:16px">No stock alerts 🎉</p>';

    showToast('Patient data loaded!', 'success');
  } catch (e) {
    showToast('Error loading patient data', 'error');
    console.error(e);
  }
}

// =============================================
// PROFILE
// =============================================
function showProfile() { switchTab('profile'); }

function copyPatientCode() {
  const code = document.getElementById('patient-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!', 'success'));
}

function showShareCode() {
  const code = document.getElementById('patient-code-display').textContent;
  showToast(`Your code: ${code}`, 'success');
}

function toggleNotifications() {
  const on = document.getElementById('notif-toggle').checked;
  showToast(on ? 'Notifications enabled' : 'Notifications disabled');
}

function toggleDarkMode() {
  const on = document.getElementById('dark-toggle').checked;
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
}

// =============================================
// TABS
// =============================================
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.add('hidden');
    t.classList.remove('active');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tabEl = document.getElementById(`tab-${tab}`);
  if (tabEl) { tabEl.classList.remove('hidden'); tabEl.classList.add('active'); }

  const navEl = document.getElementById(`nav-${tab}`);
  if (navEl) navEl.classList.add('active');

  if (tab === 'calendar') renderCalendar();
  if (tab === 'medicines') renderMedicines();
  if (tab === 'home') renderTodayDoses();

  closeNotifications();
}

// =============================================
// HELPERS
// =============================================
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._to);
  toast._to = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Close notification panel on outside click
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell');
  if (!panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

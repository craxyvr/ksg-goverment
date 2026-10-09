/* =========================================================
   KSG GOVERMENT - CLIENT APPLICATION SCRIPT
   ========================================================= */

(function () {
  'use strict';

  // State
  let currentUser = null;
  let token = localStorage.getItem('ksg_token') || null;
  let ws = null;
  let activeTab = 'announcements';
  let currentCaseInView = null;
  let onlineUserIds = new Set();
  let userFilter = 'all';

  // DOM Elements
  const headerLogo = document.getElementById('headerLogo');
  const wsStatusPill = document.getElementById('wsStatusPill');
  const unauthedBox = document.getElementById('unauthedBox');
  const authedBox = document.getElementById('authedBox');
  const userNameLabel = document.getElementById('userNameLabel');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const userTagLabel = document.getElementById('userTagLabel');
  const btnLogout = document.getElementById('btnLogout');
  const btnOpenLoginModal = document.getElementById('btnOpenLoginModal');
  const btnOpenRegisterModal = document.getElementById('btnOpenRegisterModal');
  const navTabs = document.getElementById('navTabs');
  const userWarningBanner = document.getElementById('userWarningBanner');
  const bannerWarningTitle = document.getElementById('bannerWarningTitle');
  const bannerWarningText = document.getElementById('bannerWarningText');
  const btnDismissWarning = document.getElementById('btnDismissWarning');

  // Modals
  const loginModal = document.getElementById('loginModal');
  const registerModal = document.getElementById('registerModal');
  const announcementModal = document.getElementById('announcementModal');
  const newCaseModal = document.getElementById('newCaseModal');
  const caseCreatedSuccessModal = document.getElementById('caseCreatedSuccessModal');
  const warnUserModal = document.getElementById('warnUserModal');
  const banUserModal = document.getElementById('banUserModal');
  const editOfficerModal = document.getElementById('editOfficerModal');
  const nominateOfficerModal = document.getElementById('nominateOfficerModal');
  const rogerApprovalCodeModal = document.getElementById('rogerApprovalCodeModal');
  const liveWarningModal = document.getElementById('liveWarningModal');
  const bannedSplashModal = document.getElementById('bannedSplashModal');
  const toastContainer = document.getElementById('toastContainer');

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function init() {
    setupEventListeners();
    setupNavigation();
    setupWizard();

    if (token) {
      await fetchCurrentUser();
    } else {
      updateAuthUI();
    }

    initWebSocket();
    loadAnnouncements();
    loadOfficers();
  }

  /* =========================================================
     WEBSOCKET REAL-TIME SYNC
     ========================================================= */

  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsStatusPill.innerHTML = `<span class="status-dot green"></span><span class="live-text">SÜSTEEM ONLINE</span>`;
        if (currentUser) {
          sendWsAuth();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWsMessage(data);
        } catch (e) {
          console.error('WS Parse Error', e);
        }
      };

      ws.onclose = () => {
        wsStatusPill.innerHTML = `<span class="status-dot" style="background:#f59e0b;box-shadow:none;"></span><span class="live-text" style="color:#f59e0b;">ÜHENDUN...</span>`;
        setTimeout(initWebSocket, 3000);
      };

      ws.onerror = (err) => {
        console.warn('WS Error', err);
      };
    } catch (err) {
      console.error('WS Init failed', err);
    }
  }

  function sendWsAuth() {
    if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
      ws.send(JSON.stringify({
        type: 'auth',
        userId: currentUser.id,
        userName: currentUser.name,
        role: currentUser.role,
        isOfficer: currentUser.isOfficer
      }));
    }
  }

  function handleWsMessage(msg) {
    if (msg.type === 'presence') {
      onlineUserIds = new Set(msg.onlineUserIds || []);
      if (activeTab === 'users-management') loadUsersManagement();
      if (activeTab === 'officers-list') loadOfficers();
      if (activeTab === 'roger-headquarters') loadRogerHeadquarters();
    } else if (msg.type === 'user_warned') {
      showLiveWarning(msg.warning, msg.totalWarnings);
      playAlertTone();
      fetchCurrentUser();
    } else if (msg.type === 'user_banned') {
      showBannedScreen(msg.reason, msg.banUntil);
      playAlertTone();
    } else if (msg.type === 'user_deleted') {
      showToast('Teie konto on süsteemist eemaldatud.', 'error');
      logout();
    } else if (msg.type === 'announcement_new') {
      showToast(`Uus teadaanne: ${msg.announcement.title}`, 'info');
      loadAnnouncements();
    } else if (msg.type === 'announcement_deleted') {
      loadAnnouncements();
    } else if (msg.type === 'application_submitted') {
      if (currentUser && currentUser.isOfficer) {
        showToast(`Uus kandideerimisavaldus esitatud: ${msg.application.applicantName}`, 'info');
        loadOfficerApplications();
      }
    } else if (msg.type === 'application_comment_added') {
      if (activeTab === 'signup-officer') loadMyApplication();
      if (activeTab === 'applications-review') loadOfficerApplications();
    } else if (msg.type === 'application_updated') {
      if (activeTab === 'signup-officer') loadMyApplication();
      if (activeTab === 'applications-review') loadOfficerApplications();
    } else if (msg.type === 'case_created' || msg.type === 'case_updated') {
      if (activeTab === 'cases' && currentUser && currentUser.isOfficer) loadOfficerCases();
    } else if (msg.type === 'officer_updated' || msg.type === 'officer_added' || msg.type === 'officer_deleted') {
      loadOfficers();
      if (currentUser && currentUser.role === 'roger') loadRogerHeadquarters();
    }
  }

  function playAlertTone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
      // Audio might be blocked without user interaction
    }
  }

  /* =========================================================
     AUTH / CURRENT USER
     ========================================================= */

  async function fetchCurrentUser() {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.banned) {
          showBannedScreen(data.banReason, data.banUntil);
          return;
        }
        logout();
        return;
      }
      const data = await res.json();
      currentUser = data.user;
      updateAuthUI();
      sendWsAuth();

      // Check warnings
      checkUserWarnings();
    } catch (err) {
      console.error('Fetch me failed', err);
    }
  }

  function updateAuthUI() {
    if (currentUser) {
      unauthedBox.classList.add('hidden');
      authedBox.classList.remove('hidden');

      userNameLabel.textContent = currentUser.name;
      userTagLabel.textContent = currentUser.tag || 'Kodanik';

      // Badge role
      if (currentUser.role === 'roger') {
        userRoleBadge.textContent = 'PEA FBI';
        userRoleBadge.className = 'role-badge roger';
      } else if (currentUser.isOfficer) {
        userRoleBadge.textContent = 'OHVITSER';
        userRoleBadge.className = 'role-badge officer';
      } else {
        userRoleBadge.textContent = 'KODANIK';
        userRoleBadge.className = 'role-badge';
      }

      // Officer elements visibility
      document.querySelectorAll('.officer-only').forEach(el => {
        if (currentUser.isOfficer) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      });

      // Roger exclusive tab
      document.querySelectorAll('.roger-only').forEach(el => {
        if (currentUser.role === 'roger') {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      });

      // Load specific view data
      if (activeTab === 'signup-officer') {
        loadMyApplication();
      }
    } else {
      unauthedBox.classList.remove('hidden');
      authedBox.classList.add('hidden');

      document.querySelectorAll('.officer-only').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.roger-only').forEach(el => el.classList.add('hidden'));
      userWarningBanner.classList.add('hidden');
    }
  }

  function checkUserWarnings() {
    if (!currentUser || !currentUser.warnings || currentUser.warnings.length === 0) {
      userWarningBanner.classList.add('hidden');
      return;
    }

    const unack = currentUser.warnings.filter(w => !w.acknowledged);
    if (unack.length > 0) {
      const latest = unack[unack.length - 1];
      bannerWarningTitle.textContent = `Aktiivne Hoiatus (${currentUser.warnings.length}/5): ${latest.officer || 'Ohvitser'}`;
      bannerWarningText.textContent = latest.text;
      userWarningBanner.classList.remove('hidden');

      btnDismissWarning.onclick = async () => {
        try {
          await fetch('/api/auth/acknowledge-warning', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ warningId: latest.id })
          });
          userWarningBanner.classList.add('hidden');
        } catch (e) {
          userWarningBanner.classList.add('hidden');
        }
      };
    } else {
      userWarningBanner.classList.add('hidden');
    }
  }

  function logout() {
    currentUser = null;
    token = null;
    localStorage.removeItem('ksg_token');
    updateAuthUI();
    switchTab('announcements');
    showToast('Olete edukalt välja loginud.', 'info');
  }

  /* =========================================================
     NAVIGATION & TABS
     ========================================================= */

  function setupNavigation() {
    navTabs.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.nav-tab');
      if (!tabBtn) return;
      const tabName = tabBtn.dataset.tab;
      switchTab(tabName);
    });
  }

  function switchTab(tabName) {
    activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      if (panel.id === `tab-${tabName}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Load data for active tab
    if (tabName === 'announcements') {
      loadAnnouncements();
    } else if (tabName === 'cases') {
      if (currentUser && currentUser.isOfficer) {
        loadOfficerCases();
      }
    } else if (tabName === 'signup-officer') {
      if (currentUser) {
        loadMyApplication();
      } else {
        // Show wizard for unauthed / new
        document.getElementById('myApplicationCard').classList.add('hidden');
        document.getElementById('officerWizard').classList.remove('hidden');
      }
    } else if (tabName === 'applications-review') {
      if (currentUser && currentUser.isOfficer) {
        loadOfficerApplications();
      }
    } else if (tabName === 'users-management') {
      if (currentUser && currentUser.isOfficer) {
        loadUsersManagement();
      }
    } else if (tabName === 'officers-list') {
      loadOfficers();
    } else if (tabName === 'roger-headquarters') {
      if (currentUser && currentUser.role === 'roger') {
        loadRogerHeadquarters();
      }
    }
  }

  /* =========================================================
     TAB 1: ANNOUNCEMENTS
     ========================================================= */

  async function loadAnnouncements() {
    const listEl = document.getElementById('announcementsList');
    try {
      const res = await fetch('/api/announcements');
      const data = await res.json();
      const items = data.announcements || [];

      if (items.length === 0) {
        listEl.innerHTML = `<div class="loading-spinner">Teated puuduvad hetkel.</div>`;
        return;
      }

      listEl.innerHTML = items.map(ann => {
        const canDelete = currentUser && currentUser.isOfficer;
        const formattedDate = new Date(ann.createdAt).toLocaleDateString('et-EE', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        return `
          <div class="announcement-card" data-id="${ann.id}">
            <div class="announcement-top">
              <span class="ann-tag">${escapeHtml(ann.tag || 'TEADE')}</span>
              <span class="ann-date">${formattedDate}</span>
            </div>
            <h3 class="ann-title">${escapeHtml(ann.title)}</h3>
            <div class="ann-content">${escapeHtml(ann.content)}</div>
            <div class="ann-footer">
              <span class="ann-author">✍️ ${escapeHtml(ann.author)}</span>
              ${canDelete ? `<button class="btn btn-danger-outline btn-xs btn-delete-ann" data-id="${ann.id}">Kustuta</button>` : ''}
            </div>
          </div>
        `;
      }).join('');

      // Delete announcement listeners
      listEl.querySelectorAll('.btn-delete-ann').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const annId = e.currentTarget.dataset.id;
          if (!confirm('Kas soovite selle teadaande kustutada?')) return;
          try {
            await fetch(`/api/announcements/${annId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` }
            });
            showToast('Teadaanne kustutatud!', 'success');
            loadAnnouncements();
          } catch (err) {
            showToast('Kustutamine ebaõnnestus', 'error');
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="loading-spinner">Viga teadete laadimisel</div>`;
    }
  }

  /* =========================================================
     TAB 2: CASES (JUHTUMID & TOIMIKUD)
     ========================================================= */

  // Case 5-digit code lookup
  const caseLookupForm = document.getElementById('caseLookupForm');
  const caseCodeInput = document.getElementById('caseCodeInput');
  const caseLookupError = document.getElementById('caseLookupError');
  const unlockedCaseCard = document.getElementById('unlockedCaseCard');
  const btnCloseDossier = document.getElementById('btnCloseDossier');

  caseLookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = caseCodeInput.value.trim();
    if (code.length !== 5) {
      caseLookupError.textContent = 'Kood peab olema täpselt 5-kohaline number!';
      caseLookupError.classList.remove('hidden');
      return;
    }

    caseLookupError.classList.add('hidden');
    try {
      const res = await fetch('/api/cases/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) {
        caseLookupError.textContent = data.error || 'Toimikut ei leitud';
        caseLookupError.classList.remove('hidden');
        return;
      }

      displayCaseDossier(data.case);
      showToast('Toimik edukalt avatud!', 'success');
    } catch (err) {
      caseLookupError.textContent = 'Ühenduse viga toimiku otsimisel';
      caseLookupError.classList.remove('hidden');
    }
  });

  btnCloseDossier.addEventListener('click', () => {
    unlockedCaseCard.classList.add('hidden');
    currentCaseInView = null;
  });

  function displayCaseDossier(c) {
    currentCaseInView = c;
    unlockedCaseCard.classList.remove('hidden');

    document.getElementById('dossierCodeBadge').textContent = `KOOD: ${c.code}`;
    document.getElementById('dossierStatusBadge').textContent = c.status || 'Aktiivne';
    document.getElementById('dossierCategoryBadge').textContent = c.category || 'Muu';
    document.getElementById('dossierTitle').textContent = c.title;
    document.getElementById('dossierSuspect').textContent = c.suspectName;
    document.getElementById('dossierAuthor').textContent = c.createdBy;
    document.getElementById('dossierDate').textContent = new Date(c.createdAt).toLocaleDateString('et-EE');
    document.getElementById('dossierDescription').textContent = c.description;

    renderCaseNotes(c.notes || []);

    // Officers can add notes
    const addNoteBox = document.getElementById('addNoteBox');
    if (currentUser && currentUser.isOfficer) {
      addNoteBox.classList.remove('hidden');
    } else {
      addNoteBox.classList.add('hidden');
    }

    // Smooth scroll into dossier
    unlockedCaseCard.scrollIntoView({ behavior: 'smooth' });
  }

  function renderCaseNotes(notes) {
    const listEl = document.getElementById('dossierNotesList');
    if (!notes || notes.length === 0) {
      listEl.innerHTML = `<div style="font-size:0.85rem;color:var(--text-dim);font-style:italic;">Täiendavaid uurimismärkmeid ei ole lisatud.</div>`;
      return;
    }

    listEl.innerHTML = notes.map(n => {
      const d = new Date(n.date).toLocaleDateString('et-EE', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="dossier-note-item">
          <div class="note-meta">
            <span class="note-author">${escapeHtml(n.author)}</span>
            <span>${d}</span>
          </div>
          <div class="note-text">${escapeHtml(n.text)}</div>
        </div>
      `;
    }).join('');
  }

  // Add Case Note
  document.getElementById('btnAddCaseNote').addEventListener('click', async () => {
    if (!currentCaseInView) return;
    const input = document.getElementById('newCaseNoteText');
    const text = input.value.trim();
    if (!text) return;

    try {
      const res = await fetch(`/api/cases/${currentCaseInView.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ newNote: text })
      });
      const data = await res.json();
      if (res.ok) {
        input.value = '';
        currentCaseInView = data.case;
        renderCaseNotes(currentCaseInView.notes || []);
        showToast('Märge salvestatud!', 'success');
      }
    } catch (err) {
      showToast('Märkme lisamine ebaõnnestus', 'error');
    }
  });

  // Officer All Cases Table
  async function loadOfficerCases() {
    const tbody = document.getElementById('officerCasesTableBody');
    try {
      const res = await fetch('/api/cases', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const cases = data.cases || [];

      if (cases.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-dim);">Toimikuid ei ole loodud</td></tr>`;
        return;
      }

      tbody.innerHTML = cases.map(c => `
        <tr>
          <td><strong class="secret-code-box" style="font-size:0.95rem;">${escapeHtml(c.code)}</strong></td>
          <td><strong>${escapeHtml(c.title)}</strong></td>
          <td>${escapeHtml(c.suspectName)}</td>
          <td>${escapeHtml(c.category)}</td>
          <td><span class="badge-status">${escapeHtml(c.status)}</span></td>
          <td>${escapeHtml(c.createdBy)}</td>
          <td>
            <button class="btn btn-secondary btn-xs btn-open-case" data-id="${c.id}">Ava</button>
            <button class="btn btn-danger-outline btn-xs btn-delete-case" data-id="${c.id}">Kustuta</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.btn-open-case').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const found = cases.find(item => item.id === id);
          if (found) displayCaseDossier(found);
        });
      });

      tbody.querySelectorAll('.btn-delete-case').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Kas soovite selle toimiku kustutada?')) return;
          try {
            await fetch(`/api/cases/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` }
            });
            showToast('Toimik kustutatud', 'success');
            loadOfficerCases();
            if (currentCaseInView && currentCaseInView.id === id) {
              unlockedCaseCard.classList.add('hidden');
              currentCaseInView = null;
            }
          } catch (err) {
            showToast('Kustutamine ebaõnnestus', 'error');
          }
        });
      });

    } catch (e) {
      console.error(e);
    }
  }

  /* =========================================================
     TAB 3: OFFICER SIGN UP WIZARD (5 STEPS)
     ========================================================= */

  let currentWizardStep = 1;

  function setupWizard() {
    const wizard = document.getElementById('officerWizard');
    const bullets = wizard.querySelectorAll('.wizard-step-bullet');
    const barFill = document.getElementById('wizardBarFill');

    function goToStep(step) {
      currentWizardStep = step;
      
      // Update bullets & progress
      bullets.forEach(b => {
        const s = parseInt(b.dataset.step, 10);
        b.classList.remove('active', 'completed');
        if (s === step) b.classList.add('active');
        if (s < step) b.classList.add('completed');
      });

      const percent = (step / 5) * 100;
      barFill.style.width = `${percent}%`;

      // Update visible step panel
      wizard.querySelectorAll('.wizard-step').forEach(stepEl => {
        stepEl.classList.remove('active');
      });
      const targetStepEl = document.getElementById(`wizardStep${step}`);
      if (targetStepEl) targetStepEl.classList.add('active');
    }

    // Next / Prev button triggers
    wizard.querySelectorAll('.btn-next').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = parseInt(btn.dataset.next, 10);
        goToStep(next);
      });
    });

    wizard.querySelectorAll('.btn-prev').forEach(btn => {
      btn.addEventListener('click', () => {
        const prev = parseInt(btn.dataset.prev, 10);
        goToStep(prev);
      });
    });

    // Step 5: Submit Officer Application
    const btnSubmit = document.getElementById('btnSubmitOfficerApp');
    btnSubmit.addEventListener('click', async () => {
      if (!currentUser) {
        showToast('Palun logige sisse või looge konto enne avalduse esitamist!', 'error');
        openModal(loginModal);
        return;
      }

      const answers = document.getElementById('wizardAgreementText').value.trim();
      if (!answers) {
        showToast('Palun kirjutage oma kinnitus / allkiri tekstikasti!', 'error');
        return;
      }

      try {
        const res = await fetch('/api/applications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ answers })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Esitamine ebaõnnestus', 'error');
          return;
        }

        showToast('Avaldus edukalt esitatud!', 'success');
        loadMyApplication();
      } catch (err) {
        showToast('Ühenduse viga esitamisel', 'error');
      }
    });

    // Reapply button
    document.getElementById('btnReapply').addEventListener('click', () => {
      document.getElementById('myApplicationCard').classList.add('hidden');
      document.getElementById('officerWizard').classList.remove('hidden');
      goToStep(1);
    });

    // Comment on my application
    document.getElementById('myAppCommentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('myAppCommentInput');
      const text = input.value.trim();
      if (!text) return;

      const appCard = document.getElementById('myApplicationCard');
      const appId = appCard.dataset.appId;
      if (!appId) return;

      try {
        const res = await fetch(`/api/applications/${appId}/comments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ text })
        });
        if (res.ok) {
          input.value = '';
          loadMyApplication();
        }
      } catch (err) {
        showToast('Kommenteerimine ebaõnnestus', 'error');
      }
    });
  }

  async function loadMyApplication() {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/applications/my', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const app = data.application;

      const card = document.getElementById('myApplicationCard');
      const wizard = document.getElementById('officerWizard');
      const reapplyContainer = document.getElementById('reapplyContainer');

      if (!app) {
        card.classList.add('hidden');
        wizard.classList.remove('hidden');
        return;
      }

      // Show Application Card
      wizard.classList.add('hidden');
      card.classList.remove('hidden');
      card.dataset.appId = app.id;

      const pill = document.getElementById('myAppStatusPill');
      pill.textContent = app.status === 'accepted' ? 'Vastu võetud' : (app.status === 'denied' ? 'Tagasi lükatud' : 'Ootel');
      pill.className = `status-pill ${app.status}`;

      const responseBox = document.getElementById('myAppResponseBox');
      if (app.status === 'pending') {
        responseBox.innerHTML = `
          <div class="notice-box blue">
            <span class="notice-icon">⏳</span>
            <p><strong>Saadetud!</strong> teie vastus vaatatakse üle ja vaatatakse kas saate sisse või ei see võib võtta kuni 1 päev.</p>
          </div>
        `;
        reapplyContainer.classList.add('hidden');
      } else if (app.status === 'accepted') {
        responseBox.innerHTML = `
          <div class="notice-box" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);">
            <span class="notice-icon">🎉</span>
            <p><strong style="color:var(--accent-green);">Palju õnne!</strong> Teie avaldus on heaks kiidetud ja olete suunatud Rogerile lõplikuks 5-kohalise koodi määramiseks!</p>
          </div>
        `;
        reapplyContainer.classList.remove('hidden');
      } else if (app.status === 'denied') {
        responseBox.innerHTML = `
          <div class="notice-box" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);">
            <span class="notice-icon">❌</span>
            <p><strong style="color:var(--accent-red);">Teade:</strong> Teie avaldus lükati seekord tagasi. Soovi korral saate allpool kandideerida uuesti.</p>
          </div>
        `;
        reapplyContainer.classList.remove('hidden');
      }

      document.getElementById('myAppSubmittedText').textContent = app.answers;

      // Render Comments
      renderCommentsList(app.comments || [], document.getElementById('myAppCommentsList'));

    } catch (err) {
      console.error(err);
    }
  }

  function renderCommentsList(comments, container) {
    if (!comments || comments.length === 0) {
      container.innerHTML = `<div style="font-size:0.85rem;color:var(--text-dim);font-style:italic;">Kommentaare ei ole veel lisatud.</div>`;
      return;
    }

    container.innerHTML = comments.map(c => {
      const d = new Date(c.date).toLocaleDateString('et-EE', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="comment-bubble ${c.isOfficer ? 'is-officer' : ''}">
          <div class="comment-meta">
            <span class="comment-author ${c.isOfficer ? 'officer-name' : ''}">${escapeHtml(c.authorName)}</span>
            <span>${d}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
      `;
    }).join('');
  }

  /* =========================================================
     TAB 4: APPLICATIONS REVIEW (OFFICERS ONLY)
     ========================================================= */

  async function loadOfficerApplications() {
    const container = document.getElementById('officerAppsList');
    try {
      const res = await fetch('/api/applications', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const apps = data.applications || [];

      const pendingCount = apps.filter(a => a.status === 'pending').length;
      const countBadge = document.getElementById('pendingAppsCount');
      if (pendingCount > 0) {
        countBadge.textContent = pendingCount;
        countBadge.classList.remove('hidden');
      } else {
        countBadge.classList.add('hidden');
      }

      if (apps.length === 0) {
        container.innerHTML = `<div class="loading-spinner">Ühtegi avaldust ei ole esitatud.</div>`;
        return;
      }

      container.innerHTML = apps.map(a => {
        const d = new Date(a.createdAt).toLocaleDateString('et-EE', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const statusClass = a.status;
        const statusLabel = a.status === 'accepted' ? 'Vastu võetud' : (a.status === 'denied' ? 'Tagasi lükatud' : 'Ootel');

        return `
          <div class="applicant-card" data-id="${a.id}">
            <div class="applicant-card-header">
              <div class="applicant-info">
                <h3>${escapeHtml(a.applicantName)} <span class="status-pill ${statusClass}">${statusLabel}</span></h3>
                <span>📧 ${escapeHtml(a.applicantEmail)} &bull; Esitatud: ${d}</span>
              </div>
              <div class="applicant-decision-btns">
                <button class="btn btn-success btn-sm btn-accept-app" data-id="${a.id}">Võta vastu (Accept)</button>
                <button class="btn btn-danger-outline btn-sm btn-deny-app" data-id="${a.id}">Lükka tagasi (Deny)</button>
              </div>
            </div>

            <div class="applicant-answers-box">
              <span class="label">Kandidaadi nõusolek & allkiri:</span>
              <p>${escapeHtml(a.answers)}</p>
            </div>

            <div class="app-comments-section">
              <h4>Vestlus kandidaadiga (${(a.comments || []).length}):</h4>
              <div class="comments-list" id="officerAppComments_${a.id}">
                ${(a.comments || []).map(c => `
                  <div class="comment-bubble ${c.isOfficer ? 'is-officer' : ''}">
                    <div class="comment-meta">
                      <span class="comment-author ${c.isOfficer ? 'officer-name' : ''}">${escapeHtml(c.authorName)}</span>
                      <span>${new Date(c.date).toLocaleDateString('et-EE', { hour:'2-digit', minute:'2-digit' })}</span>
                    </div>
                    <div class="comment-text">${escapeHtml(c.text)}</div>
                  </div>
                `).join('')}
              </div>

              <div class="add-comment-form">
                <input type="text" class="form-input officer-comment-input" placeholder="Kirjuta kommentaar või küsimus kandidaadile..." data-id="${a.id}">
                <button class="btn btn-secondary btn-sm btn-post-officer-comment" data-id="${a.id}">Saada</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Accept / Deny handlers
      container.querySelectorAll('.btn-accept-app').forEach(btn => {
        btn.addEventListener('click', () => handleAppDecision(btn.dataset.id, 'accepted'));
      });
      container.querySelectorAll('.btn-deny-app').forEach(btn => {
        btn.addEventListener('click', () => handleAppDecision(btn.dataset.id, 'denied'));
      });

      // Post comment handler
      container.querySelectorAll('.btn-post-officer-comment').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const input = container.querySelector(`.officer-comment-input[data-id="${id}"]`);
          if (input) postOfficerComment(id, input.value.trim(), input);
        });
      });

    } catch (e) {
      console.error(e);
    }
  }

  async function handleAppDecision(appId, decision) {
    try {
      const res = await fetch(`/api/applications/${appId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ decision })
      });
      if (res.ok) {
        showToast(`Avaldus ${decision === 'accepted' ? 'heaks kiidetud' : 'tagasi lükatud'}!`, 'success');
        loadOfficerApplications();
      }
    } catch (err) {
      showToast('Otsuse salvestamine ebaõnnestus', 'error');
    }
  }

  async function postOfficerComment(appId, text, inputEl) {
    if (!text) return;
    try {
      const res = await fetch(`/api/applications/${appId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        if (inputEl) inputEl.value = '';
        loadOfficerApplications();
      }
    } catch (err) {
      showToast('Kommentaari saatmine ebaõnnestus', 'error');
    }
  }

  /* =========================================================
     TAB 5: USERS MANAGEMENT & MONITOR
     ========================================================= */

  async function loadUsersManagement() {
    const tbody = document.getElementById('usersTableBody');
    try {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      let users = data.users || [];

      // Filter
      if (userFilter === 'online') users = users.filter(u => u.isOnline);
      if (userFilter === 'offline') users = users.filter(u => !u.isOnline);
      if (userFilter === 'banned') users = users.filter(u => u.isBanned);

      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-dim);">Kasutajaid ei leitud</td></tr>`;
        return;
      }

      tbody.innerHTML = users.map(u => {
        const warningsCount = (u.warnings || []).length;
        const onlineBadge = u.isOnline
          ? `<span class="status-indicator online"><span class="status-dot green"></span> ONLINE</span>`
          : `<span class="status-indicator offline"><span class="status-dot" style="background:#64748b;box-shadow:none;"></span> OFFLINE</span>`;

        let banBadge = `<span style="color:var(--accent-green);font-size:0.82rem;">Aktiivne</span>`;
        if (u.isBanned) {
          const timeText = u.banUntil === 'permanent' ? 'Igavene' : new Date(u.banUntil).toLocaleTimeString('et-EE');
          banBadge = `<span style="color:var(--accent-red);font-weight:700;font-size:0.82rem;">🚫 BÄNNITUD (${timeText})</span>`;
        }

        return `
          <tr data-id="${u.id}">
            <td>${onlineBadge}</td>
            <td><strong>${escapeHtml(u.name)}</strong></td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="role-badge">${escapeHtml(u.tag || 'Kodanik')}</span></td>
            <td>
              <span style="font-weight:700;color:${warningsCount >= 3 ? 'var(--accent-red)' : 'var(--accent-gold)'}">
                ${warningsCount} / 5
              </span>
            </td>
            <td>${banBadge}</td>
            <td>
              <div class="table-actions">
                <button class="btn btn-warning btn-xs btn-warn-user" data-id="${u.id}" data-name="${escapeHtml(u.name)}">⚠️ Hoiata</button>
                ${u.isBanned ? `
                  <button class="btn btn-secondary btn-xs btn-unban-user" data-id="${u.id}">🔓 Eemalda bänn</button>
                ` : `
                  <button class="btn btn-danger btn-xs btn-ban-user" data-id="${u.id}" data-name="${escapeHtml(u.name)}">🚫 Bänni</button>
                `}
                <button class="btn btn-danger-outline btn-xs btn-delete-user" data-id="${u.id}">🗑️ Kustuta</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Wire action buttons
      tbody.querySelectorAll('.btn-warn-user').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('warnTargetUserId').value = btn.dataset.id;
          document.getElementById('warnTargetUserName').textContent = `Kasutaja: ${btn.dataset.name}`;
          document.getElementById('warnCustomText').value = '';
          openModal(warnUserModal);
        });
      });

      tbody.querySelectorAll('.btn-ban-user').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('banTargetUserId').value = btn.dataset.id;
          document.getElementById('banTargetUserName').textContent = `Kasutaja: ${btn.dataset.name}`;
          document.getElementById('banReasonText').value = '';
          openModal(banUserModal);
        });
      });

      tbody.querySelectorAll('.btn-unban-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          try {
            await fetch(`/api/users/${id}/unban`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` }
            });
            showToast('Kasutaja bänn eemaldatud!', 'success');
            loadUsersManagement();
          } catch (e) {
            showToast('Eemaldamine ebaõnnestus', 'error');
          }
        });
      });

      tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Kas olete kindel, et soovite selle kasutajakonto jäädavalt kustutada?')) return;
          try {
            await fetch(`/api/users/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` }
            });
            showToast('Kasutaja kustutatud', 'success');
            loadUsersManagement();
          } catch (e) {
            showToast('Kustutamine ebaõnnestus', 'error');
          }
        });
      });

    } catch (e) {
      console.error(e);
    }
  }

  // Filter click handlers
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      userFilter = btn.dataset.filter;
      loadUsersManagement();
    });
  });

  /* =========================================================
     TAB 6: OFFICERS LIST & COLLABORATION
     ========================================================= */

  async function loadOfficers() {
    const grid = document.getElementById('officersCardsGrid');
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/officers', { headers });
      const data = await res.json();
      const officers = data.officers || [];

      grid.innerHTML = officers.map(o => {
        const isMe = currentUser && currentUser.id === o.id;
        const isOfficer = currentUser && currentUser.isOfficer;
        const isRoger = o.role === 'roger';
        const isOnline = onlineUserIds.has(o.id) || o.isOnline;
        const strikes = (o.warnings || []).length;

        return `
          <div class="officer-profile-card ${isRoger ? 'roger-card-badge' : ''}" data-id="${o.id}">
            <div class="officer-card-top">
              <div class="officer-avatar-shield ${isRoger ? 'gold' : ''}">
                ${isRoger ? '⭐' : '🛡️'}
              </div>
              <div class="officer-identity">
                <h3>${escapeHtml(o.name)}</h3>
                <span class="officer-tag-badge ${isRoger ? 'gold' : ''}">${escapeHtml(o.tag || 'Ohvitser')}</span>
              </div>
            </div>

            <div class="officer-meta-stats">
              <span>Staatus: <strong>${isOnline ? '🟢 Online' : '⚫ Offline'}</strong></span>
              <span>Hoiatused: <strong style="color:${strikes > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">${strikes} / 5</strong></span>
            </div>

            ${isOfficer ? `
              <div class="officer-card-actions">
                <button class="btn btn-secondary btn-xs btn-edit-officer" data-id="${o.id}" data-name="${escapeHtml(o.name)}" data-tag="${escapeHtml(o.tag)}">
                  ✏️ Muuda nime/tagi
                </button>
                ${!isRoger ? `
                  <button class="btn btn-warning btn-xs btn-warn-officer" data-id="${o.id}" data-name="${escapeHtml(o.name)}">
                    ⚠️ Hoiata
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      // Edit officer handler
      grid.querySelectorAll('.btn-edit-officer').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('editOfficerId').value = btn.dataset.id;
          document.getElementById('editOfficerName').value = btn.dataset.name;
          document.getElementById('editOfficerTag').value = btn.dataset.tag;
          openModal(editOfficerModal);
        });
      });

      // Warn officer handler
      grid.querySelectorAll('.btn-warn-officer').forEach(btn => {
        btn.addEventListener('click', () => {
          const reason = prompt(`Sisesta hoiatus ohvitserile ${btn.dataset.name}:`);
          if (reason && reason.trim()) {
            warnOfficerDirectly(btn.dataset.id, reason.trim());
          }
        });
      });

    } catch (e) {
      console.error(e);
    }
  }

  async function warnOfficerDirectly(officerId, warningText) {
    try {
      const res = await fetch(`/api/officers/${officerId}/warn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ warningText })
      });
      if (res.ok) {
        showToast('Hoiatus edastatud teisele ohvitserile!', 'success');
        loadOfficers();
      }
    } catch (err) {
      showToast('Hoiatuse saatmine ebaõnnestus', 'error');
    }
  }

  /* =========================================================
     TAB 7: ROGER HEADQUARTERS & CODES (EXCLUSIVE TO ROGER)
     ========================================================= */

  async function loadRogerHeadquarters() {
    if (!currentUser || currentUser.role !== 'roger') return;

    try {
      const res = await fetch('/api/roger/overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const officers = data.officers || [];
      const nominations = data.pendingOfficers || [];

      // 1. Roger Officer Codes Table
      const codesTbody = document.getElementById('rogerOfficerCodesTableBody');
      codesTbody.innerHTML = officers.map(o => `
        <tr>
          <td><strong>${escapeHtml(o.name)}</strong></td>
          <td><span class="role-badge ${o.role === 'roger' ? 'roger' : 'officer'}">${escapeHtml(o.tag)}</span></td>
          <td>
            <span class="secret-code-box">${escapeHtml(o.code || 'PUUDUB')}</span>
          </td>
          <td>
            <button class="btn btn-secondary btn-xs btn-copy-code" data-code="${o.code}">Kopeeri kood</button>
          </td>
        </tr>
      `).join('');

      codesTbody.querySelectorAll('.btn-copy-code').forEach(btn => {
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(btn.dataset.code);
          showToast(`Kood ${btn.dataset.code} kopeeritud lõikelauale!`, 'success');
        });
      });

      // 2. Pending Nominations
      const nomList = document.getElementById('rogerNominationsList');
      const nomCountBadge = document.getElementById('nominationsBoxCount');
      nomCountBadge.textContent = `${nominations.length} ootel`;

      const headerNomCount = document.getElementById('pendingNominationsCount');
      if (nominations.length > 0) {
        headerNomCount.textContent = nominations.length;
        headerNomCount.classList.remove('hidden');
      } else {
        headerNomCount.classList.add('hidden');
      }

      if (nominations.length === 0) {
        nomList.innerHTML = `<div style="color:var(--text-dim);font-style:italic;">Kinnitamist ootavaid ohvitserikandidaate ei ole.</div>`;
      } else {
        nomList.innerHTML = nominations.map(nom => `
          <div class="nomination-item" data-id="${nom.id}">
            <div class="nomination-info">
              <h4>${escapeHtml(nom.name)} &bull; Kavandatav Tag: <span style="color:var(--accent-gold);">${escapeHtml(nom.proposedTag)}</span></h4>
              <p>Esitaja: ${escapeHtml(nom.nominatedBy)} | Põhjus: ${escapeHtml(nom.reason)}</p>
            </div>
            <div class="nomination-actions">
              <button class="btn btn-success btn-sm btn-roger-accept-nom" data-id="${nom.id}" data-name="${escapeHtml(nom.name)}">
                ✅ Kinnita ja genereeri kood
              </button>
              <button class="btn btn-danger-outline btn-sm btn-roger-deny-nom" data-id="${nom.id}">
                ❌ Lükka tagasi
              </button>
            </div>
          </div>
        `).join('');

        nomList.querySelectorAll('.btn-roger-accept-nom').forEach(btn => {
          btn.addEventListener('click', () => rogerDecideNomination(btn.dataset.id, 'accept', btn.dataset.name));
        });

        nomList.querySelectorAll('.btn-roger-deny-nom').forEach(btn => {
          btn.addEventListener('click', () => rogerDecideNomination(btn.dataset.id, 'deny'));
        });
      }

      // 3. Officer Discipline
      const discList = document.getElementById('rogerDisciplineList');
      const otherOfficers = officers.filter(o => o.role !== 'roger');

      if (otherOfficers.length === 0) {
        discList.innerHTML = `<div style="color:var(--text-dim);font-style:italic;">Teisi ohvitsere pole.</div>`;
      } else {
        discList.innerHTML = otherOfficers.map(o => `
          <div class="discipline-item">
            <div>
              <strong>${escapeHtml(o.name)}</strong> (${escapeHtml(o.tag)})
              <div style="font-size:0.8rem;color:var(--text-muted);">
                Bänn: ${o.isBanned ? `<span style="color:var(--accent-red);">JAH (${o.banReason || 'Bännitud'})</span>` : 'EI'} | 
                Hoiatused: ${o.warnings.length}
              </div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-warning btn-xs btn-roger-warn-officer" data-id="${o.id}" data-name="${escapeHtml(o.name)}">⚠️ Hoiata</button>
              ${o.isBanned ? `
                <button class="btn btn-secondary btn-xs btn-roger-unban-officer" data-id="${o.id}">🔓 Eemalda bänn</button>
              ` : `
                <button class="btn btn-danger btn-xs btn-roger-ban-officer" data-id="${o.id}" data-name="${escapeHtml(o.name)}">🚫 Bänni</button>
              `}
              <button class="btn btn-danger-outline btn-xs btn-roger-delete-officer" data-id="${o.id}" data-name="${escapeHtml(o.name)}">🗑️ Eemalda ohvitser</button>
            </div>
          </div>
        `).join('');

        discList.querySelectorAll('.btn-roger-warn-officer').forEach(btn => {
          btn.addEventListener('click', async () => {
            const reason = prompt(`Määra Rogerina hoiatus ohvitserile ${btn.dataset.name}:`);
            if (!reason) return;
            await rogerDisciplineAction(btn.dataset.id, { action: 'warn', text: reason });
          });
        });

        discList.querySelectorAll('.btn-roger-ban-officer').forEach(btn => {
          btn.addEventListener('click', async () => {
            const reason = prompt(`Sisesta bänni põhjus ohvitserile ${btn.dataset.name}:`, 'Juhtkonna otsus');
            if (!reason) return;
            await rogerDisciplineAction(btn.dataset.id, { action: 'ban', durationMinutes: 'permanent', reason });
          });
        });

        discList.querySelectorAll('.btn-roger-unban-officer').forEach(btn => {
          btn.addEventListener('click', async () => {
            await rogerDisciplineAction(btn.dataset.id, { action: 'unban' });
          });
        });

        discList.querySelectorAll('.btn-roger-delete-officer').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm(`Kas oled kindel, et soovid eemaldada ohvitseri ${btn.dataset.name} politseist ja juhtkonnast?`)) return;
            await rogerDisciplineAction(btn.dataset.id, { action: 'delete' });
          });
        });
      }

    } catch (e) {
      console.error(e);
    }
  }

  async function rogerDecideNomination(nomId, decision, candidateName) {
    try {
      const res = await fetch(`/api/roger/nominations/${nomId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ decision })
      });
      const data = await res.json();
      if (res.ok) {
        if (decision === 'accept' && data.code) {
          // Display the special modal with the generated 5-digit code!
          document.getElementById('rogerApprovedOfficerName').textContent = `Ohvitser ${candidateName} on ametlikult kinnitatud!`;
          document.getElementById('rogerApprovedOfficerCode').textContent = data.code;
          
          document.getElementById('btnCopyRogerOfficerCode').onclick = () => {
            navigator.clipboard.writeText(data.code);
            showToast(`Kood ${data.code} kopeeritud! Saada see uuele ohvitserile.`, 'success');
          };

          openModal(rogerApprovalCodeModal);
        } else {
          showToast('Ettepanek lükatud tagasi', 'info');
        }
        loadRogerHeadquarters();
      }
    } catch (err) {
      showToast('Tegevus ebaõnnestus', 'error');
    }
  }

  async function rogerDisciplineAction(officerId, payload) {
    try {
      const res = await fetch(`/api/roger/officers/${officerId}/discipline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Õnnestus', 'success');
        loadRogerHeadquarters();
      } else {
        showToast(data.error || 'Viga', 'error');
      }
    } catch (e) {
      showToast('Distsiplinaarne tegevus ebaõnnestus', 'error');
    }
  }

  /* =========================================================
     MODAL CONTROLS & FORM SUBMISSIONS
     ========================================================= */

  function setupEventListeners() {
    // Open Login Modal
    btnOpenLoginModal.addEventListener('click', () => openModal(loginModal));
    btnOpenRegisterModal.addEventListener('click', () => openModal(registerModal));
    btnLogout.addEventListener('click', logout);

    // Close modals on [data-close] or backdrop
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.dataset.close;
        const targetModal = document.getElementById(targetId);
        if (targetModal) closeModal(targetModal);
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && overlay.id !== 'bannedSplashModal') {
          closeModal(overlay);
        }
      });
    });

    // Login Modal Tabs (Officer vs Citizen)
    const tabLoginOfficer = document.getElementById('tabLoginOfficer');
    const tabLoginCitizen = document.getElementById('tabLoginCitizen');
    const formOfficerLogin = document.getElementById('formOfficerLogin');
    const formCitizenLogin = document.getElementById('formCitizenLogin');

    tabLoginOfficer.addEventListener('click', () => {
      tabLoginOfficer.classList.add('active');
      tabLoginCitizen.classList.remove('active');
      formOfficerLogin.classList.remove('hidden');
      formCitizenLogin.classList.add('hidden');
    });

    tabLoginCitizen.addEventListener('click', () => {
      tabLoginCitizen.classList.add('active');
      tabLoginOfficer.classList.remove('active');
      formCitizenLogin.classList.remove('hidden');
      formOfficerLogin.classList.add('hidden');
    });

    document.getElementById('linkSwitchToRegister').addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(loginModal);
      openModal(registerModal);
    });

    document.getElementById('linkSwitchToLogin').addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(registerModal);
      openModal(loginModal);
    });

    // Officer Login Form Submission
    formOfficerLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('officerLoginCode').value.trim();
      const email = document.getElementById('officerLoginEmail').value.trim();
      const password = document.getElementById('officerLoginPass').value.trim();
      const errEl = document.getElementById('officerLoginError');

      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officerCode: code, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.banned) {
            closeModal(loginModal);
            showBannedScreen(data.banReason, data.banUntil);
            return;
          }
          errEl.textContent = data.error || 'Sisselogimine ebaõnnestus';
          errEl.classList.remove('hidden');
          return;
        }

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('ksg_token', token);
        closeModal(loginModal);
        updateAuthUI();
        sendWsAuth();
        showToast(`Tere tulemast tagasi, ohvitser ${currentUser.name}!`, 'success');
      } catch (err) {
        errEl.textContent = 'Ühenduse viga serveriga';
        errEl.classList.remove('hidden');
      }
    });

    // Citizen Login Form Submission
    formCitizenLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('citizenLoginEmail').value.trim();
      const password = document.getElementById('citizenLoginPass').value.trim();
      const errEl = document.getElementById('citizenLoginError');

      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.banned) {
            closeModal(loginModal);
            showBannedScreen(data.banReason, data.banUntil);
            return;
          }
          errEl.textContent = data.error || 'Vale e-post või parool';
          errEl.classList.remove('hidden');
          return;
        }

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('ksg_token', token);
        closeModal(loginModal);
        updateAuthUI();
        sendWsAuth();
        showToast(`Tere tulemast, ${currentUser.name}!`, 'success');
      } catch (err) {
        errEl.textContent = 'Ühenduse viga serveriga';
        errEl.classList.remove('hidden');
      }
    });

    // Register Form Submission
    const formRegister = document.getElementById('formRegister');
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value.trim();
      const errEl = document.getElementById('registerError');

      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || 'Registreerimine ebaõnnestus';
          errEl.classList.remove('hidden');
          return;
        }

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('ksg_token', token);
        closeModal(registerModal);
        updateAuthUI();
        sendWsAuth();
        showToast('Konto edukalt loodud!', 'success');
      } catch (err) {
        errEl.textContent = 'Ühenduse viga serveriga';
        errEl.classList.remove('hidden');
      }
    });

    // Create Announcement Modal
    document.getElementById('btnOpenNewAnnouncement').addEventListener('click', () => {
      openModal(announcementModal);
    });

    document.getElementById('formNewAnnouncement').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('annTitle').value.trim();
      const tag = document.getElementById('annTag').value;
      const content = document.getElementById('annContent').value.trim();

      try {
        const res = await fetch('/api/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ title, tag, content })
        });
        if (res.ok) {
          closeModal(announcementModal);
          document.getElementById('formNewAnnouncement').reset();
          showToast('Teadaanne avaldatud!', 'success');
          loadAnnouncements();
        }
      } catch (err) {
        showToast('Avaldamine ebaõnnestus', 'error');
      }
    });

    // Create Case Modal
    document.getElementById('btnOpenNewCaseModal').addEventListener('click', () => {
      openModal(newCaseModal);
    });

    document.getElementById('formNewCase').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('caseTitle').value.trim();
      const suspectName = document.getElementById('caseSuspect').value.trim();
      const category = document.getElementById('caseCategory').value;
      const description = document.getElementById('caseDescription').value.trim();

      try {
        const res = await fetch('/api/cases', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ title, suspectName, category, description })
        });
        const data = await res.json();
        if (res.ok) {
          closeModal(newCaseModal);
          document.getElementById('formNewCase').reset();

          // Show generated 5-digit code!
          document.getElementById('generatedCaseCode').textContent = data.case.code;
          document.getElementById('btnCopyCaseCode').onclick = () => {
            navigator.clipboard.writeText(data.case.code);
            showToast(`Toimiku kood ${data.case.code} kopeeritud!`, 'success');
          };
          openModal(caseCreatedSuccessModal);

          loadOfficerCases();
        }
      } catch (err) {
        showToast('Toimiku loomine ebaõnnestus', 'error');
      }
    });

    // Warn User Form
    document.getElementById('formWarnUser').addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserId = document.getElementById('warnTargetUserId').value;
      const warningText = document.getElementById('warnCustomText').value.trim();

      try {
        const res = await fetch(`/api/users/${targetUserId}/warn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ warningText })
        });
        if (res.ok) {
          closeModal(warnUserModal);
          showToast('Hoiatus edukalt väljastatud!', 'success');
          loadUsersManagement();
        }
      } catch (err) {
        showToast('Hoiatuse väljastamine ebaõnnestus', 'error');
      }
    });

    // Ban User Form
    document.getElementById('formBanUser').addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserId = document.getElementById('banTargetUserId').value;
      const durationMinutes = document.getElementById('banDuration').value;
      const reason = document.getElementById('banReasonText').value.trim();

      try {
        const res = await fetch(`/api/users/${targetUserId}/ban`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ durationMinutes, reason })
        });
        if (res.ok) {
          closeModal(banUserModal);
          showToast('Kasutaja on bännitud!', 'success');
          loadUsersManagement();
        }
      } catch (err) {
        showToast('Bännimine ebaõnnestus', 'error');
      }
    });

    // Edit Officer Form
    document.getElementById('formEditOfficer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editOfficerId').value;
      const name = document.getElementById('editOfficerName').value.trim();
      const tag = document.getElementById('editOfficerTag').value.trim();

      try {
        const res = await fetch(`/api/officers/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name, tag })
        });
        if (res.ok) {
          closeModal(editOfficerModal);
          showToast('Ohvitseri andmed uuendatud!', 'success');
          loadOfficers();
          if (currentUser && currentUser.id === id) {
            currentUser.name = name;
            currentUser.tag = tag;
            updateAuthUI();
          }
        }
      } catch (err) {
        showToast('Uuendamine ebaõnnestus', 'error');
      }
    });

    // Nominate Officer Modal
    document.getElementById('btnOpenNominateOfficerModal').addEventListener('click', () => {
      openModal(nominateOfficerModal);
    });

    document.getElementById('formNominateOfficer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('nominateName').value.trim();
      const proposedTag = document.getElementById('nominateTag').value.trim();
      const reason = document.getElementById('nominateReason').value.trim();

      try {
        const res = await fetch('/api/officers/nominate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name, proposedTag, reason })
        });
        const data = await res.json();
        if (res.ok) {
          closeModal(nominateOfficerModal);
          document.getElementById('formNominateOfficer').reset();
          showToast(data.message || 'Ettepanek saadetud Rogerile!', 'success');
        }
      } catch (err) {
        showToast('Ettepaneku saatmine ebaõnnestus', 'error');
      }
    });

    // Live Warning Acknowledge
    document.getElementById('btnAcknowledgeLiveWarning').addEventListener('click', () => {
      closeModal(liveWarningModal);
    });

    // Banned Screen Logout
    document.getElementById('btnBannedLogout').addEventListener('click', () => {
      closeModal(bannedSplashModal);
      logout();
    });
  }

  function openModal(modalEl) {
    if (modalEl) modalEl.classList.remove('hidden');
  }

  function closeModal(modalEl) {
    if (modalEl) modalEl.classList.add('hidden');
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function showLiveWarning(warning, totalWarnings) {
    document.getElementById('liveWarningText').textContent = warning.text;
    document.getElementById('liveWarningMeta').textContent = `Määranud: ${warning.officer}`;
    document.getElementById('liveWarningStrikes').textContent = `Teil on ${totalWarnings} hoiatust (5 hoiatuse täitumisel eemaldamine!).`;
    openModal(liveWarningModal);
  }

  function showBannedScreen(reason, banUntil) {
    document.getElementById('bannedSplashReason').textContent = `Põhjus: ${reason || 'KSG korrareeglite rikkumine'}`;
    let timeStr = 'Igavene (Permanent)';
    if (banUntil && banUntil !== 'permanent') {
      timeStr = new Date(banUntil).toLocaleString('et-EE');
    }
    document.getElementById('bannedSplashTime').textContent = `Bänni kestvus: ${timeStr}`;
    openModal(bannedSplashModal);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start app
  window.addEventListener('DOMContentLoaded', init);

})();

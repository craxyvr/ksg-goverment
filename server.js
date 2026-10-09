const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial seed data
const initialData = {
  officers: [
    {
      id: 'officer_roger',
      name: 'Roger',
      email: 'roger@ksg.ee',
      tag: 'Pea FBI',
      code: '77701', // Roger's 5-digit secret code
      role: 'roger',
      isOfficer: true,
      warnings: [],
      isBanned: false,
      banUntil: null,
      banReason: null,
      createdAt: new Date().toISOString()
    },
    {
      id: 'officer_oliver',
      name: 'Oliver',
      email: 'oliver@ksg.ee',
      tag: 'Pea Detective',
      code: '54321', // Oliver's 5-digit secret code
      role: 'officer',
      isOfficer: true,
      warnings: [],
      isBanned: false,
      banUntil: null,
      banReason: null,
      createdAt: new Date().toISOString()
    },
    {
      id: 'officer_miron',
      name: 'Miron',
      email: 'miron@ksg.ee',
      tag: 'Omanik',
      code: '99001', // Miron's 5-digit secret code
      role: 'officer',
      isOfficer: true,
      warnings: [],
      isBanned: false,
      banUntil: null,
      banReason: null,
      createdAt: new Date().toISOString()
    }
  ],
  users: [],
  applications: [],
  cases: [],
  pendingOfficers: [],
  announcements: []
};

// Database helper functions
function loadData() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
      return initialData;
    }
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    // ensure all root keys exist
    for (const key of Object.keys(initialData)) {
      if (!parsed[key]) parsed[key] = initialData[key];
    }
    return parsed;
  } catch (err) {
    console.error('Error loading db:', err);
    return initialData;
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving db:', err);
  }
}

let db = loadData();

// Helper to generate 5-digit random numeric code
function generate5DigitCode(existingCodes = []) {
  let code = '';
  do {
    code = Math.floor(10000 + Math.random() * 90000).toString();
  } while (existingCodes.includes(code));
  return code;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple Token / Session map: token -> user
const activeSessions = new Map();

function generateToken() {
  return 'ksg_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Autoriseerimine puudub' });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  const session = activeSessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Sessioon on aegunud või vigane' });
  }
  // Refresh user data from db
  let user = null;
  if (session.isOfficer) {
    user = db.officers.find(o => o.id === session.id);
  } else {
    user = db.users.find(u => u.id === session.id);
  }
  if (!user) {
    activeSessions.delete(token);
    return res.status(401).json({ error: 'Kasutajat ei leitud' });
  }
  // Check ban
  if (user.isBanned) {
    if (user.banUntil && user.banUntil !== 'permanent' && Date.now() > user.banUntil) {
      user.isBanned = false;
      user.banUntil = null;
      user.banReason = null;
      saveData(db);
    } else {
      return res.status(403).json({
        error: 'Teie konto on bännitud',
        banned: true,
        banUntil: user.banUntil,
        banReason: user.banReason
      });
    }
  }
  req.user = user;
  req.token = token;
  next();
}

function officerMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user || !req.user.isOfficer) {
      return res.status(403).json({ error: 'Juurdepääs lubatud ainult ohvitseridele' });
    }
    next();
  });
}

function rogerMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user || req.user.role !== 'roger') {
      return res.status(403).json({ error: 'Juurdepääs lubatud ainult Rogerile (Pea FBI)' });
    }
    next();
  });
}

// Real-Time WebSockets
const clients = new Map(); // ws -> { userId, userName, role, isOfficer }

function broadcast(msg) {
  const json = JSON.stringify(msg);
  for (const [ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

function broadcastPresence() {
  const onlineUserIds = Array.from(new Set(Array.from(clients.values()).map(c => c.userId)));
  broadcast({
    type: 'presence',
    onlineUserIds
  });
}

function sendToUser(userId, msg) {
  const json = JSON.stringify(msg);
  for (const [ws, info] of clients.entries()) {
    if (info.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        clients.set(ws, {
          userId: data.userId,
          userName: data.userName,
          role: data.role,
          isOfficer: data.isOfficer
        });
        broadcastPresence();
      }
    } catch (e) {
      console.error('WS msg error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastPresence();
  });
});

/* =========================================================
   ROUTES: AUTHENTICATION
   ========================================================= */

// Log in
// Supports regular user login (email + pass)
// AND officer login: 5-number code + random email/password
app.post('/api/auth/login', (req, res) => {
  const { email, password, officerCode } = req.body;

  // 1. Check if an officer code is supplied
  if (officerCode && officerCode.trim().length > 0) {
    const trimmedCode = officerCode.trim();
    const officer = db.officers.find(o => o.code === trimmedCode);
    if (!officer) {
      return res.status(401).json({ error: 'Vigane 5-kohaline ohvitseri turvakood!' });
    }

    // Check if officer is banned
    if (officer.isBanned) {
      if (officer.banUntil && officer.banUntil !== 'permanent' && Date.now() > officer.banUntil) {
        officer.isBanned = false;
        officer.banUntil = null;
        officer.banReason = null;
        saveData(db);
      } else {
        return res.status(403).json({
          error: 'See ohvitseri konto on ajutiselt suletud / bännitud!',
          banned: true,
          banUntil: officer.banUntil,
          banReason: officer.banReason
        });
      }
    }

    const token = generateToken();
    activeSessions.set(token, officer);

    return res.json({
      success: true,
      token,
      user: {
        id: officer.id,
        name: officer.name,
        email: officer.email,
        tag: officer.tag,
        role: officer.role,
        isOfficer: true,
        warnings: officer.warnings || []
      }
    });
  }

  // 2. Regular user login
  if (!email || !password) {
    return res.status(400).json({ error: 'Palun sisestage e-post ja parool (või ohvitseri kood)!' });
  }

  const user = db.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Vale e-post või parool!' });
  }

  // Check ban
  if (user.isBanned) {
    if (user.banUntil && user.banUntil !== 'permanent' && Date.now() > user.banUntil) {
      user.isBanned = false;
      user.banUntil = null;
      user.banReason = null;
      saveData(db);
    } else {
      return res.status(403).json({
        error: 'Teie konto on bännitud!',
        banned: true,
        banUntil: user.banUntil,
        banReason: user.banReason
      });
    }
  }

  user.lastSeen = new Date().toISOString();
  saveData(db);

  const token = generateToken();
  activeSessions.set(token, user);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      tag: user.tag || 'Kodanik',
      role: 'user',
      isOfficer: false,
      warnings: user.warnings || []
    }
  });
});

// Register regular citizen
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Kõik väljad on kohustuslikud!' });
  }

  const existing = db.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'Sellise e-postiga kasutaja on juba olemas!' });
  }

  const newUser = {
    id: 'user_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name: name.trim(),
    email: email.trim(),
    password: password.trim(),
    role: 'user',
    isOfficer: false,
    tag: 'Kodanik / Õpilane',
    warnings: [],
    isBanned: false,
    banUntil: null,
    banReason: null,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveData(db);

  const token = generateToken();
  activeSessions.set(token, newUser);

  broadcast({ type: 'user_registered', user: { id: newUser.id, name: newUser.name } });

  return res.json({
    success: true,
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      tag: newUser.tag,
      role: newUser.role,
      isOfficer: false,
      warnings: []
    }
  });
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      tag: req.user.tag,
      role: req.user.role,
      isOfficer: req.user.isOfficer,
      warnings: req.user.warnings || [],
      isBanned: req.user.isBanned
    }
  });
});

// Acknowledge warning
app.post('/api/auth/acknowledge-warning', authMiddleware, (req, res) => {
  const { warningId } = req.body;
  if (req.user.warnings) {
    const w = req.user.warnings.find(item => item.id === warningId);
    if (w) w.acknowledged = true;
    saveData(db);
  }
  res.json({ success: true });
});

/* =========================================================
   ROUTES: ANNOUNCEMENTS
   ========================================================= */

app.get('/api/announcements', (req, res) => {
  res.json({ announcements: db.announcements || [] });
});

app.post('/api/announcements', officerMiddleware, (req, res) => {
  const { title, content, tag } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Pealkiri ja sisu on kohustuslikud!' });
  }

  const newAnn = {
    id: 'ann_' + Date.now(),
    title: title.trim(),
    content: content.trim(),
    author: `${req.user.name} (${req.user.tag || 'Ohvitser'})`,
    tag: tag ? tag.trim().toUpperCase() : 'TEADAANNE',
    createdAt: new Date().toISOString()
  };

  db.announcements.unshift(newAnn);
  saveData(db);

  broadcast({ type: 'announcement_new', announcement: newAnn });
  res.json({ success: true, announcement: newAnn });
});

app.delete('/api/announcements/:id', officerMiddleware, (req, res) => {
  const id = req.params.id;
  db.announcements = db.announcements.filter(a => a.id !== id);
  saveData(db);
  broadcast({ type: 'announcement_deleted', id });
  res.json({ success: true });
});

/* =========================================================
   ROUTES: SIGN UP AS OFFICER (KANDIDEERIMINE)
   ========================================================= */

// User fetches their own application
app.get('/api/applications/my', authMiddleware, (req, res) => {
  const appItem = db.applications.find(a => a.userId === req.user.id || a.applicantEmail === req.user.email);
  res.json({ application: appItem || null });
});

// User submits application
app.post('/api/applications', authMiddleware, (req, res) => {
  const { answers } = req.body;
  if (!answers || answers.trim().length === 0) {
    return res.status(400).json({ error: 'Palun kirjutage oma vastus / allkiri!' });
  }

  // Check if active pending exists
  let appItem = db.applications.find(a => a.userId === req.user.id || a.applicantEmail === req.user.email);
  if (appItem && appItem.status === 'pending') {
    return res.status(400).json({ error: 'Teil on juba esitatud avaldus ootel!' });
  }

  if (appItem) {
    // Re-submission if previously accepted or denied
    appItem.answers = answers.trim();
    appItem.status = 'pending';
    appItem.createdAt = new Date().toISOString();
    // keep prior comments or start fresh
  } else {
    appItem = {
      id: 'app_' + Date.now(),
      userId: req.user.id,
      applicantName: req.user.name,
      applicantEmail: req.user.email,
      answers: answers.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      comments: []
    };
    db.applications.push(appItem);
  }

  saveData(db);
  broadcast({ type: 'application_submitted', application: appItem });
  res.json({ success: true, application: appItem });
});

// Officers view all applications
app.get('/api/applications', officerMiddleware, (req, res) => {
  res.json({ applications: db.applications || [] });
});

// Officers accept or deny
app.post('/api/applications/:id/decision', officerMiddleware, (req, res) => {
  const { decision } = req.body; // 'accepted' | 'denied'
  if (!['accepted', 'denied'].includes(decision)) {
    return res.status(400).json({ error: 'Vigane otsus' });
  }

  const appItem = db.applications.find(a => a.id === req.params.id);
  if (!appItem) {
    return res.status(404).json({ error: 'Avaldust ei leitud' });
  }

  appItem.status = decision;
  appItem.decisionBy = `${req.user.name} (${req.user.tag})`;
  appItem.decidedAt = new Date().toISOString();

  // If accepted, add applicant to pending officers or directly notify Roger
  if (decision === 'accepted') {
    // Add to pending officers for Roger to confirm and issue 5-digit code
    const existingPending = db.pendingOfficers.find(p => p.email === appItem.applicantEmail);
    if (!existingPending) {
      db.pendingOfficers.push({
        id: 'pend_' + Date.now(),
        name: appItem.applicantName,
        email: appItem.applicantEmail,
        proposedTag: 'Noorem Ohvitser',
        nominatedBy: `${req.user.name} (${req.user.tag})`,
        reason: 'Läbis kandideerimise edukalt',
        createdAt: new Date().toISOString()
      });
    }
  }

  saveData(db);
  broadcast({ type: 'application_updated', application: appItem });
  res.json({ success: true, application: appItem });
});

// Add comment to application (Officers or Applicant)
app.post('/api/applications/:id/comments', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Kommentaari tekst on kohustuslik' });
  }

  const appItem = db.applications.find(a => a.id === req.params.id);
  if (!appItem) {
    return res.status(404).json({ error: 'Avaldust ei leitud' });
  }

  // Permission check: must be officer OR the applicant
  const isApplicant = appItem.userId === req.user.id || appItem.applicantEmail === req.user.email;
  if (!req.user.isOfficer && !isApplicant) {
    return res.status(403).json({ error: 'Teil pole õigust sellele avaldusele kommenteerida' });
  }

  if (!appItem.comments) appItem.comments = [];

  const newComment = {
    id: 'c_' + Date.now(),
    authorName: `${req.user.name}${req.user.isOfficer ? ` (${req.user.tag})` : ''}`,
    authorRole: req.user.role,
    isOfficer: req.user.isOfficer,
    text: text.trim(),
    date: new Date().toISOString()
  };

  appItem.comments.push(newComment);
  saveData(db);

  broadcast({ type: 'application_comment_added', appId: appItem.id, comment: newComment });
  res.json({ success: true, comment: newComment });
});

/* =========================================================
   ROUTES: CASES (TOIMIKUD JA JUHTUMID)
   ========================================================= */

// Lookup case by 5-digit code (Any authorized user or officer)
app.post('/api/cases/lookup', (req, res) => {
  const { code } = req.body;
  if (!code || code.trim().length === 0) {
    return res.status(400).json({ error: 'Sisestage toimiku 5-kohaline kood!' });
  }

  const targetCase = db.cases.find(c => c.code === code.trim());
  if (!targetCase) {
    return res.status(404).json({ error: 'Toimikut selle 5-kohalise koodiga ei leitud!' });
  }

  res.json({ success: true, case: targetCase });
});

// Officers view all cases
app.get('/api/cases', officerMiddleware, (req, res) => {
  res.json({ cases: db.cases || [] });
});

// Officers create a new case -> generates 5-digit code
app.post('/api/cases', officerMiddleware, (req, res) => {
  const { title, suspectName, category, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'Toimiku pealkiri ja kirjeldus on kohustuslikud!' });
  }

  const existingCodes = db.cases.map(c => c.code);
  const newCode = generate5DigitCode(existingCodes);

  const newCase = {
    id: 'case_' + Date.now(),
    code: newCode,
    title: title.trim(),
    suspectName: (suspectName || 'Tuvastamisel').trim(),
    category: (category || 'Korra rikkumine').trim(),
    description: description.trim(),
    status: 'Aktiivne',
    createdBy: `${req.user.name} (${req.user.tag})`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: []
  };

  db.cases.unshift(newCase);
  saveData(db);

  broadcast({ type: 'case_created', caseId: newCase.id });
  res.json({ success: true, case: newCase });
});

// Officers edit a case
app.put('/api/cases/:id', officerMiddleware, (req, res) => {
  const targetCase = db.cases.find(c => c.id === req.params.id);
  if (!targetCase) {
    return res.status(404).json({ error: 'Toimikut ei leitud' });
  }

  const { title, suspectName, category, description, status, newNote } = req.body;
  if (title) targetCase.title = title.trim();
  if (suspectName) targetCase.suspectName = suspectName.trim();
  if (category) targetCase.category = category.trim();
  if (description) targetCase.description = description.trim();
  if (status) targetCase.status = status.trim();

  if (newNote && newNote.trim()) {
    if (!targetCase.notes) targetCase.notes = [];
    targetCase.notes.push({
      id: 'cn_' + Date.now(),
      author: `${req.user.name} (${req.user.tag})`,
      text: newNote.trim(),
      date: new Date().toISOString()
    });
  }

  targetCase.updatedAt = new Date().toISOString();
  saveData(db);

  broadcast({ type: 'case_updated', case: targetCase });
  res.json({ success: true, case: targetCase });
});

// Officers delete a case
app.delete('/api/cases/:id', officerMiddleware, (req, res) => {
  db.cases = db.cases.filter(c => c.id !== req.params.id);
  saveData(db);
  broadcast({ type: 'case_deleted', id: req.params.id });
  res.json({ success: true });
});

/* =========================================================
   ROUTES: USER MANAGEMENT & ONLINE/OFFLINE PRESENCE
   ========================================================= */

// Officers see all users with online status
app.get('/api/users', officerMiddleware, (req, res) => {
  const onlineUserIds = new Set(Array.from(clients.values()).map(c => c.userId));

  const userList = db.users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    tag: u.tag || 'Kodanik',
    role: u.role,
    warnings: u.warnings || [],
    isBanned: !!u.isBanned,
    banUntil: u.banUntil,
    banReason: u.banReason,
    isOnline: onlineUserIds.has(u.id),
    lastSeen: u.lastSeen,
    createdAt: u.createdAt
  }));

  res.json({ users: userList });
});

// Officers warn a user (custom warning text)
app.post('/api/users/:id/warn', officerMiddleware, (req, res) => {
  const { warningText } = req.body;
  if (!warningText || warningText.trim().length === 0) {
    return res.status(400).json({ error: 'Hoiatuse tekst on kohustuslik!' });
  }

  const user = db.users.find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Kasutajat ei leitud' });
  }

  if (!user.warnings) user.warnings = [];
  const warningObj = {
    id: 'w_' + Date.now(),
    text: warningText.trim(),
    officer: `${req.user.name} (${req.user.tag})`,
    date: new Date().toISOString(),
    acknowledged: false
  };

  user.warnings.push(warningObj);
  saveData(db);

  // Send real-time alert to user if online
  sendToUser(user.id, {
    type: 'user_warned',
    warning: warningObj,
    totalWarnings: user.warnings.length
  });

  broadcast({ type: 'user_updated', userId: user.id });
  res.json({ success: true, warnings: user.warnings });
});

// Officers ban a user (custom duration and reason)
app.post('/api/users/:id/ban', officerMiddleware, (req, res) => {
  const { durationMinutes, reason } = req.body;
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Kasutajat ei leitud' });
  }

  let banUntil = null;
  if (durationMinutes === 'permanent' || durationMinutes === -1) {
    banUntil = 'permanent';
  } else {
    const mins = parseInt(durationMinutes, 10) || 60;
    banUntil = Date.now() + mins * 60 * 1000;
  }

  user.isBanned = true;
  user.banUntil = banUntil;
  user.banReason = reason ? reason.trim() : 'KSG reeglite rikkumine';
  user.bannedBy = `${req.user.name} (${req.user.tag})`;

  saveData(db);

  // Terminate any active sessions
  for (const [token, session] of activeSessions.entries()) {
    if (session.id === user.id) {
      activeSessions.delete(token);
    }
  }

  // Notify target user via WebSocket
  sendToUser(user.id, {
    type: 'user_banned',
    reason: user.banReason,
    banUntil: user.banUntil
  });

  broadcast({ type: 'user_updated', userId: user.id });
  res.json({ success: true, user });
});

// Officers unban a user
app.post('/api/users/:id/unban', officerMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Kasutajat ei leitud' });
  }

  user.isBanned = false;
  user.banUntil = null;
  user.banReason = null;
  user.bannedBy = null;

  saveData(db);
  broadcast({ type: 'user_updated', userId: user.id });
  res.json({ success: true });
});

// Officers delete a user account
app.delete('/api/users/:id', officerMiddleware, (req, res) => {
  const userIndex = db.users.findIndex(u => u.id === req.params.id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Kasutajat ei leitud' });
  }

  const [deletedUser] = db.users.splice(userIndex, 1);
  // Also clean up any active session
  for (const [token, session] of activeSessions.entries()) {
    if (session.id === deletedUser.id) activeSessions.delete(token);
  }

  saveData(db);
  sendToUser(deletedUser.id, { type: 'user_deleted' });
  broadcast({ type: 'user_deleted', userId: deletedUser.id });
  res.json({ success: true });
});

/* =========================================================
   ROUTES: OFFICERS LIST & COLLABORATION
   ========================================================= */

// Officers list: visible to everyone
// ONLY Roger gets the 5-digit codes; other officers and normal users get code redacted!
app.get('/api/officers', (req, res) => {
  const authHeader = req.headers.authorization;
  let isRoger = false;
  let isOfficer = false;

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    const session = activeSessions.get(token);
    if (session) {
      if (session.role === 'roger') isRoger = true;
      if (session.isOfficer) isOfficer = true;
    }
  }

  const onlineUserIds = new Set(Array.from(clients.values()).map(c => c.userId));

  const list = db.officers.map(o => {
    const item = {
      id: o.id,
      name: o.name,
      email: o.email,
      tag: o.tag,
      role: o.role,
      warnings: o.warnings || [],
      isBanned: !!o.isBanned,
      banUntil: o.banUntil,
      banReason: o.banReason,
      isOnline: onlineUserIds.has(o.id)
    };

    // ONLY Roger can see officer codes!
    if (isRoger) {
      item.code = o.code;
    }

    return item;
  });

  res.json({ officers: list });
});

// Officers can change their own or other officers' names & tags (like Omanik)
app.put('/api/officers/:id', officerMiddleware, (req, res) => {
  const { name, tag } = req.body;
  const officer = db.officers.find(o => o.id === req.params.id);
  if (!officer) {
    return res.status(404).json({ error: 'Ohvitseri ei leitud' });
  }

  if (name && name.trim()) officer.name = name.trim();
  if (tag && tag.trim()) officer.tag = tag.trim();

  saveData(db);
  broadcast({ type: 'officer_updated', officer: { id: officer.id, name: officer.name, tag: officer.tag } });
  res.json({ success: true, officer });
});

// Officers can warn other officers
app.post('/api/officers/:id/warn', officerMiddleware, (req, res) => {
  const { warningText } = req.body;
  if (!warningText || !warningText.trim()) {
    return res.status(400).json({ error: 'Hoiatuse tekst on kohustuslik' });
  }

  const officer = db.officers.find(o => o.id === req.params.id);
  if (!officer) {
    return res.status(404).json({ error: 'Ohvitseri ei leitud' });
  }

  if (!officer.warnings) officer.warnings = [];
  const warnObj = {
    id: 'ow_' + Date.now(),
    text: warningText.trim(),
    officer: `${req.user.name} (${req.user.tag})`,
    date: new Date().toISOString()
  };

  officer.warnings.push(warnObj);
  saveData(db);

  sendToUser(officer.id, {
    type: 'user_warned',
    warning: warnObj,
    totalWarnings: officer.warnings.length
  });

  broadcast({ type: 'officer_warned', officerId: officer.id });
  res.json({ success: true, warnings: officer.warnings });
});

// Officers propose/add a new officer (creates pending officer for Roger to review)
app.post('/api/officers/nominate', officerMiddleware, (req, res) => {
  const { name, email, proposedTag, reason } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Ohvitseri nimi on kohustuslik!' });
  }

  const pendingObj = {
    id: 'pend_' + Date.now(),
    name: name.trim(),
    email: email ? email.trim() : `${name.trim().toLowerCase().replace(/\s+/g, '')}@ksg.ee`,
    proposedTag: proposedTag ? proposedTag.trim() : 'Ohvitser',
    nominatedBy: `${req.user.name} (${req.user.tag})`,
    reason: reason ? reason.trim() : 'Ohvitseride ettepanek',
    createdAt: new Date().toISOString()
  };

  if (!db.pendingOfficers) db.pendingOfficers = [];
  db.pendingOfficers.push(pendingObj);
  saveData(db);

  broadcast({ type: 'officer_nominated', pending: pendingObj });
  res.json({ success: true, pending: pendingObj, message: 'Ettepanek saadetud Rogerile kinnitamiseks!' });
});

/* =========================================================
   ROUTES: ROGER EXCLUSIVE TAB (SUPER ADMIN & JUHTKOND)
   ========================================================= */

// Roger overview: see all officers with codes & pending nominations
app.get('/api/roger/overview', rogerMiddleware, (req, res) => {
  const onlineUserIds = new Set(Array.from(clients.values()).map(c => c.userId));

  const officersWithCodes = db.officers.map(o => ({
    id: o.id,
    name: o.name,
    email: o.email,
    tag: o.tag,
    code: o.code, // Roger sees the 5-digit code!
    role: o.role,
    warnings: o.warnings || [],
    isBanned: !!o.isBanned,
    banUntil: o.banUntil,
    banReason: o.banReason,
    isOnline: onlineUserIds.has(o.id)
  }));

  res.json({
    officers: officersWithCodes,
    pendingOfficers: db.pendingOfficers || []
  });
});

// Roger accepts or denies nominated officer
app.post('/api/roger/nominations/:id/decision', rogerMiddleware, (req, res) => {
  const { decision } = req.body; // 'accept' | 'deny'
  const index = (db.pendingOfficers || []).findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Ettepanekut ei leitud' });
  }

  const pending = db.pendingOfficers[index];

  if (decision === 'accept') {
    // Generate new 5-digit officer code
    const existingCodes = db.officers.map(o => o.code);
    const newOfficerCode = generate5DigitCode(existingCodes);

    const newOfficer = {
      id: 'officer_' + Date.now(),
      name: pending.name,
      email: pending.email,
      tag: pending.proposedTag || 'Ohvitser',
      code: newOfficerCode,
      role: 'officer',
      isOfficer: true,
      warnings: [],
      isBanned: false,
      banUntil: null,
      banReason: null,
      createdAt: new Date().toISOString()
    };

    db.officers.push(newOfficer);
    db.pendingOfficers.splice(index, 1);
    saveData(db);

    broadcast({ type: 'officer_added', officer: { id: newOfficer.id, name: newOfficer.name, tag: newOfficer.tag } });

    return res.json({
      success: true,
      accepted: true,
      code: newOfficerCode,
      officer: newOfficer,
      message: `Ohvitser ${newOfficer.name} on kinnitatud! Tema 5-kohaline turvakood on: ${newOfficerCode}`
    });
  } else {
    // Denied
    db.pendingOfficers.splice(index, 1);
    saveData(db);
    return res.json({ success: true, accepted: false, message: 'Ettepanek lükati tagasi.' });
  }
});

// Roger moderates officers: warn, ban, delete
app.post('/api/roger/officers/:id/discipline', rogerMiddleware, (req, res) => {
  const { action, text, durationMinutes, reason } = req.body;
  const officer = db.officers.find(o => o.id === req.params.id);
  if (!officer) {
    return res.status(404).json({ error: 'Ohvitseri ei leitud' });
  }

  // Cannot ban/delete Roger himself
  if (officer.role === 'roger') {
    return res.status(400).json({ error: 'Rogerit (Pea FBI) ei saa distsiplineerida!' });
  }

  if (action === 'warn') {
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Hoiatuse tekst on kohustuslik' });
    }
    if (!officer.warnings) officer.warnings = [];
    const w = {
      id: 'rw_' + Date.now(),
      text: text.trim(),
      officer: 'Roger (Pea FBI)',
      date: new Date().toISOString()
    };
    officer.warnings.push(w);
    saveData(db);
    sendToUser(officer.id, { type: 'user_warned', warning: w, totalWarnings: officer.warnings.length });
    broadcast({ type: 'officer_updated', officerId: officer.id });
    return res.json({ success: true, message: `Hoiatus lisatud ohvitserile ${officer.name}` });
  }

  if (action === 'ban') {
    let banUntil = null;
    if (durationMinutes === 'permanent' || durationMinutes === -1) {
      banUntil = 'permanent';
    } else {
      const mins = parseInt(durationMinutes, 10) || 60;
      banUntil = Date.now() + mins * 60 * 1000;
    }
    officer.isBanned = true;
    officer.banUntil = banUntil;
    officer.banReason = reason ? reason.trim() : 'Roger määras ametist kõrvaldamise';
    officer.bannedBy = 'Roger (Pea FBI)';
    saveData(db);

    // Invalidate sessions
    for (const [token, session] of activeSessions.entries()) {
      if (session.id === officer.id) activeSessions.delete(token);
    }

    sendToUser(officer.id, { type: 'user_banned', reason: officer.banReason, banUntil });
    broadcast({ type: 'officer_updated', officerId: officer.id });
    return res.json({ success: true, message: `Ohvitser ${officer.name} on bännitud!` });
  }

  if (action === 'unban') {
    officer.isBanned = false;
    officer.banUntil = null;
    officer.banReason = null;
    saveData(db);
    broadcast({ type: 'officer_updated', officerId: officer.id });
    return res.json({ success: true, message: `Ohvitseri ${officer.name} bänn tühistatud!` });
  }

  if (action === 'delete') {
    const idx = db.officers.findIndex(o => o.id === officer.id);
    if (idx !== -1) {
      db.officers.splice(idx, 1);
      saveData(db);
      for (const [token, session] of activeSessions.entries()) {
        if (session.id === officer.id) activeSessions.delete(token);
      }
      sendToUser(officer.id, { type: 'user_deleted' });
      broadcast({ type: 'officer_deleted', officerId: officer.id });
      return res.json({ success: true, message: `Ohvitser ${officer.name} eemaldatud politseist!` });
    }
  }

  res.status(400).json({ error: 'Tundmatu tegevus' });
});

// Fallback to index.html for Single Page Application (Express 5 compatible)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` KSG Goverment Portal käivitatud pordil ${PORT}`);
  console.log(` Render valmis! URL: http://localhost:${PORT}`);
  console.log(` Ohvitseride koodid:`);
  console.log(`  - Roger (Pea FBI): 77701`);
  console.log(`  - Oliver (Pea Detective): 54321`);
  console.log(`  - Miron (Omanik): 99001`);
  console.log(`===============================================`);
});

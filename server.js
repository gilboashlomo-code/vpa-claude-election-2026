const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('.'));

const DATA_FILE = '/var/data/data.json';
let voters = [];
let polls = [];
let nextVoterId = 1;
let nextPollId = 1;
const DEFAULT_RADIUS = 20;
let systemMode = 'test';

function getIsraelTime() {
  return new Date().toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem'
  });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      voters = data.voters || [];
      polls = data.polls || [];
      nextVoterId = data.nextVoterId || 1;
      nextPollId = data.nextPollId || 1;
      systemMode = data.systemMode || 'test';
      console.log('נתונים נטענו מהקובץ');
      console.log('מצב מערכת:', systemMode === 'test' ? 'ניסיון/דמו' : 'יום בחירות');
    }
  } catch (err) { console.error('שגיאה בטעינת נתונים:', err); }
}

function saveData() {
  try {
    const data = { voters, polls, nextVoterId, nextPollId, systemMode };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('נתונים נשמרו');
  } catch (err) { console.error('שגיאה בשמירת נתונים:', err); }
}

async function geocodeAddress(address) {
  return new Promise((resolve) => {
    const encodedAddress = encodeURIComponent(address + ', Israel');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${process.env.GOOGLE_MAPS_API_KEY}&language=he&region=IL`;
    https.get(url, { headers: { 'User-Agent': 'VPA-Election-System/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results.status === 'OK' && results.results.length > 0) {
            const loc = results.results[0].geometry.location;
            resolve({ lat: loc.lat, lng: loc.lng });
          } else { resolve(null); }
        } catch (e) { resolve(null); }
      });
    }).on('error', () => { resolve(null); });
  });
}

loadData();

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
app.get('/admin', (req, res) => { res.sendFile(__dirname + '/admin.html'); });

app.get('/api/admin/data', (req, res) => {
  const votedCount = voters.filter(v => v.voted).length;
  const totalVoters = voters.length;
  const votedPercentage = totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(1) : 0;
  const pollsWithStats = polls.map(poll => {
    const pollVoters = voters.filter(v => v.pollId === poll.id);
    const pollVoted = pollVoters.filter(v => v.voted).length;
    return {
      ...poll, totalVoters: pollVoters.length, voted: pollVoted,
      percentage: pollVoters.length > 0 ? ((pollVoted / pollVoters.length) * 100).toFixed(1) : 0
    };
  });
  res.json({
    voters: voters.map(v => ({ ...v, pollName: polls.find(p => p.id === v.pollId)?.name || 'לא משויך' })),
    polls: pollsWithStats, votedCount, totalVoters, votedPercentage,
    defaultRadius: DEFAULT_RADIUS, systemMode,
    recentEvents: voters.filter(v => v.voted).slice(-10).reverse()
  });
});

app.post('/api/admin/system-mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'test' && mode !== 'election') return res.status(400).json({ error: 'מצב לא תקין' });
  systemMode = mode;
  saveData();
  res.json({ success: true, mode: systemMode });
});

app.post('/api/admin/reset-all', (req, res) => {
  voters = []; polls = []; nextVoterId = 1; nextPollId = 1;
  saveData();
  res.json({ success: true });
});

// ── VOTERS/ADD — with FIX 1 (not_found) + FIX 2 (already_voted) + FIX 3 (assigned poll) ──
app.post('/api/admin/voters/add', (req, res) => {
  const { name, idNumber, pollId, address, notes, source } = req.body;

  // Called from voter2.html (source = 'voter2'): check existing voter only
  if (source === 'voter2') {
    if (!idNumber || idNumber.trim() === '') {
      return res.json({ success: false, error: 'not_found' });
    }
    const existing = voters.find(v => v.idNumber === idNumber.trim());
    if (!existing) return res.json({ success: false, error: 'not_found' });
    if (existing.voted) return res.json({ success: false, error: 'already_voted' });
    return res.json({ success: true, voter: existing, existing: true });
  }

  // Called from Admin panel: add new voter
  const poll = polls.find(p => p.id === pollId);
  if (!poll) return res.status(400).json({ error: 'קלפי לא נמצאה' });
  if (idNumber && idNumber.trim() !== '') {
    const existing = voters.find(v => v.idNumber === idNumber.trim());
    if (existing) return res.json({ success: true, voter: existing, existing: true });
  }
  if (name && name.trim() !== '') {
    const existingByName = voters.find(v =>
      v.name.trim().toLowerCase() === name.trim().toLowerCase() && v.pollId === pollId
    );
    if (existingByName) return res.json({ success: true, voter: existingByName, existing: true });
  }
  const lat = (parseFloat(poll.lat) + (Math.random() - 0.5) * 0.001).toFixed(6);
  const lng = (parseFloat(poll.lng) + (Math.random() - 0.5) * 0.001).toFixed(6);
  const voter = {
    id: nextVoterId++, name, idNumber: idNumber || '', pollId,
    address: address || '', lat, lng, voted: false, votedAt: null, notes: notes || ''
  };
  voters.push(voter);
  saveData();
  res.json({ success: true, voter, existing: false });
});

app.post('/api/admin/polls/add', async (req, res) => {
  const { name, address, lat, lng, radius } = req.body;
  let finalLat = lat, finalLng = lng;
  if (!finalLat && !finalLng && address) {
    const coords = await geocodeAddress(address);
    if (coords) { finalLat = coords.lat.toFixed(6); finalLng = coords.lng.toFixed(6); }
  }
  if (!finalLat || !finalLng) {
    finalLat = (32.0853 + (Math.random() - 0.5) * 0.05).toFixed(6);
    finalLng = (34.7818 + (Math.random() - 0.5) * 0.05).toFixed(6);
  }
  const poll = { id: nextPollId++, name, address: address || '', lat: finalLat, lng: finalLng, radius: radius || DEFAULT_RADIUS };
  polls.push(poll);
  saveData();
  res.json({ success: true, poll });
});

app.post('/api/admin/polls/update', (req, res) => {
  const { id, radius } = req.body;
  const poll = polls.find(p => p.id === id);
  if (!poll) return res.status(404).json({ error: 'קלפי לא נמצאה' });
  if (radius !== undefined) poll.radius = radius;
  saveData();
  res.json({ success: true, poll });
});

app.post('/api/admin/voters/update', (req, res) => {
  const { id, voted, notes } = req.body;
  const voter = voters.find(v => v.id === id);
  if (!voter) return res.status(404).json({ error: 'בוחר לא נמצא' });
  if (voted !== undefined) { voter.voted = voted; voter.votedAt = voted ? getIsraelTime() : null; }
  if (notes !== undefined) voter.notes = notes;
  saveData();
  res.json({ success: true, voter });
});

app.post('/api/admin/voters/delete', (req, res) => {
  const { id } = req.body;
  voters = voters.filter(v => v.id !== id);
  saveData();
  res.json({ success: true });
});

app.post('/api/admin/polls/delete', (req, res) => {
  const { id } = req.body;
  if (voters.some(v => v.pollId === id)) return res.status(400).json({ error: 'לא ניתן למחוק קלפי עם בוחרים משוייכים' });
  polls = polls.filter(p => p.id !== id);
  saveData();
  res.json({ success: true });
});

app.get('/api/admin/export/voted', (req, res) => {
  const voted = voters.filter(v => v.voted);
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי,שעת הצבעה\n' +
    voted.map(v => { const poll = polls.find(p => p.id === v.pollId); return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''},${v.votedAt}`; }).join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="voted.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/export/not-voted', (req, res) => {
  const notVoted = voters.filter(v => !v.voted);
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי\n' +
    notVoted.map(v => { const poll = polls.find(p => p.id === v.pollId); return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''}`; }).join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="not-voted.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/export/all', (req, res) => {
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי,סטטוס,שעת הצבעה\n' +
    voters.map(v => { const poll = polls.find(p => p.id === v.pollId); const status = v.voted ? 'הצביע' : 'טרם הצביע'; return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''},${status},${v.votedAt || '-'}`; }).join('\n');
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="all-voters.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/voter/check-proximity', (req, res) => {
  const { lat, lng, voterId } = req.query;
  if (!lat || !lng || !voterId) return res.json({ inRange: false });
  const voter = voters.find(v => v.id === parseInt(voterId));
  if (!voter) return res.json({ inRange: false });
  const poll = polls.find(p => p.id === voter.pollId);
  if (!poll) return res.json({ inRange: false });
  const distance = calculateDistance(parseFloat(lat), parseFloat(lng), parseFloat(poll.lat), parseFloat(poll.lng));
  const pollRadius = poll.radius || DEFAULT_RADIUS;
  res.json({ inRange: distance <= pollRadius, distance: Math.round(distance), pollName: poll.name, radius: pollRadius });
});

app.post('/api/voter/mark-voted', (req, res) => {
  const { voterId } = req.body;
  if (!voterId) return res.json({ success: false });
  const voter = voters.find(v => v.id === parseInt(voterId));
  if (!voter) return res.json({ success: false, error: 'בוחר לא נמצא' });
  if (!voter.voted) { voter.voted = true; voter.votedAt = getIsraelTime(); saveData(); }
  res.json({ success: true, voter });
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

app.listen(PORT, () => {
  console.log('מערכת VPA פועלת על פורט ' + PORT);
  console.log('אדמין: http://localhost:' + PORT + '/admin');
  console.log('קובץ נתונים: ' + DATA_FILE);
  console.log('רדיוס ברירת מחדל: ' + DEFAULT_RADIUS + ' מטר');
  console.log('מצב מערכת:', systemMode === 'test' ? 'ניסיון/דמו' : 'יום בחירות');
});

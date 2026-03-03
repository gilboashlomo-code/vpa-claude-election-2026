const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('.'));

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Load data from file or initialize
let voters = [];
let polls = [];
let nextVoterId = 1;
let nextPollId = 1;
const RADIUS = 10;

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      voters = data.voters || [];
      polls = data.polls || [];
      nextVoterId = data.nextVoterId || 1;
      nextPollId = data.nextPollId || 1;
      console.log('✅ Data loaded from file');
    }
  } catch (err) {
    console.error('❌ Error loading data:', err);
  }
}

function saveData() {
  try {
    const data = {
      voters,
      polls,
      nextVoterId,
      nextPollId
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('💾 Data saved to file');
  } catch (err) {
    console.error('❌ Error saving data:', err);
  }
}

// Load data on startup
loadData();

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

app.get('/api/admin/data', (req, res) => {
  const votedCount = voters.filter(v => v.voted).length;
  const totalVoters = voters.length;
  const votedPercentage = totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(1) : 0;
  
  const pollsWithStats = polls.map(poll => {
    const pollVoters = voters.filter(v => v.pollId === poll.id);
    const pollVoted = pollVoters.filter(v => v.voted).length;
    return {
      ...poll,
      totalVoters: pollVoters.length,
      voted: pollVoted,
      percentage: pollVoters.length > 0 ? ((pollVoted / pollVoters.length) * 100).toFixed(1) : 0
    };
  });

  res.json({
    voters: voters.map(v => ({
      ...v,
      pollName: polls.find(p => p.id === v.pollId)?.name || 'לא משויך'
    })),
    polls: pollsWithStats,
    votedCount,
    totalVoters,
    votedPercentage,
    radius: RADIUS,
    recentEvents: voters.filter(v => v.voted).slice(-10).reverse()
  });
});

app.post('/api/admin/voters/add', (req, res) => {
  const { name, idNumber, pollId, address, notes } = req.body;
  
  const poll = polls.find(p => p.id === pollId);
  if (!poll) {
    return res.status(400).json({ error: 'קלפי לא נמצאה' });
  }
  
  const lat = (parseFloat(poll.lat) + (Math.random() - 0.5) * 0.001).toFixed(6);
  const lng = (parseFloat(poll.lng) + (Math.random() - 0.5) * 0.001).toFixed(6);
  
  const voter = {
    id: nextVoterId++,
    name,
    idNumber: idNumber || '',
    pollId,
    address: address || '',
    lat,
    lng,
    voted: false,
    votedAt: null,
    notes: notes || ''
  };
  
  voters.push(voter);
  saveData();
  res.json({ success: true, voter });
});

app.post('/api/admin/polls/add', (req, res) => {
  const { name, address, lat, lng } = req.body;
  
  const finalLat = lat || (32.0853 + (Math.random() - 0.5) * 0.05).toFixed(6);
  const finalLng = lng || (34.7818 + (Math.random() - 0.5) * 0.05).toFixed(6);
  
  const poll = {
    id: nextPollId++,
    name,
    address: address || '',
    lat: finalLat,
    lng: finalLng
  };
  
  polls.push(poll);
  saveData();
  res.json({ success: true, poll });
});

app.post('/api/admin/voters/update', (req, res) => {
  const { id, voted, notes } = req.body;
  const voter = voters.find(v => v.id === id);
  
  if (!voter) {
    return res.status(404).json({ error: 'בוחר לא נמצא' });
  }
  
  if (voted !== undefined) {
    voter.voted = voted;
    voter.votedAt = voted ? new Date().toLocaleTimeString('he-IL') : null;
  }
  
  if (notes !== undefined) {
    voter.notes = notes;
  }
  
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
  
  if (voters.some(v => v.pollId === id)) {
    return res.status(400).json({ error: 'לא ניתן למחוק קלפי עם בוחרים משוייכים' });
  }
  
  polls = polls.filter(p => p.id !== id);
  saveData();
  res.json({ success: true });
});

app.get('/api/admin/export/voted', (req, res) => {
  const voted = voters.filter(v => v.voted);
  const csv = 'שם,ת.ז,קלפי,שעת הצבעה\n' + 
    voted.map(v => {
      const poll = polls.find(p => p.id === v.pollId);
      return `${v.name},${v.idNumber},${poll?.name || ''},${v.votedAt}`;
    }).join('\n');
  
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="voted.csv"');
  res.send('\uFEFF' + csv);
});

app.listen(PORT, () => {
  console.log('🚀 VPA Dashboard running on http://localhost:' + PORT);
  console.log('📍 Admin: http://localhost:' + PORT + '/admin');
  console.log('💾 Data file: ' + DATA_FILE);
});
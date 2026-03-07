const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('.'));

const DATA_FILE = path.join(__dirname, 'data.json');

let voters = [];
let polls = [];
let nextVoterId = 1;
let nextPollId = 1;
const DEFAULT_RADIUS = 20;
let systemMode = 'test';

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      voters = data.voters || [];
      polls = data.polls || [];
      nextVoterId = data.nextVoterId || 1;
      nextPollId = data.nextPollId || 1;
      systemMode = data.systemMode || 'test';
      console.log('✅ Data loaded from file');
      console.log('🔧 System mode:', systemMode === 'test' ? 'Test/Demo' : 'Election Day');
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
      nextPollId,
      systemMode
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('💾 Data saved to file');
  } catch (err) {
    console.error('❌ Error saving data:', err);
  }
}

async function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const encodedAddress = encodeURIComponent(address + ', Israel');
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`;
    
    https.get(url, {
      headers: {
        'User-Agent': 'VPA-Election-System/1.0'
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results && results.length > 0) {
            resolve({
              lat: parseFloat(results[0].lat),
              lng: parseFloat(results[0].lon)
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
}

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
    defaultRadius: DEFAULT_RADIUS,
    systemMode,
    recentEvents: voters.filter(v => v.voted).slice(-10).reverse()
  });
});

app.post('/api/admin/system-mode', (req, res) => {
  const { mode } = req.body;
  
  if (mode !== 'test' && mode !== 'election') {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  
  systemMode = mode;
  saveData();
  
  console.log('🔄 System mode changed to:', mode === 'test' ? 'Test/Demo' : 'Election Day');
  
  res.json({ success: true, mode: systemMode });
});

app.post('/api/admin/reset-all', (req, res) => {
  voters = [];
  polls = [];
  nextVoterId = 1;
  nextPollId = 1;
  saveData();
  
  console.log('🗑️ All data reset');
  
  res.json({ success: true });
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

app.post('/api/admin/polls/add', async (req, res) => {
  const { name, address, lat, lng, radius } = req.body;
  
  let finalLat = lat;
  let finalLng = lng;
  
  if (!finalLat && !finalLng && address) {
    console.log('🔍 Geocoding address:', address);
    const coords = await geocodeAddress(address);
    if (coords) {
      finalLat = coords.lat.toFixed(6);
      finalLng = coords.lng.toFixed(6);
      console.log('✅ Geocoded successfully:', finalLat, finalLng);
    } else {
      console.log('⚠️ Geocoding failed, using default location');
    }
  }
  
  if (!finalLat || !finalLng) {
    finalLat = (32.0853 + (Math.random() - 0.5) * 0.05).toFixed(6);
    finalLng = (34.7818 + (Math.random() - 0.5) * 0.05).toFixed(6);
  }
  
  const finalRadius = radius || DEFAULT_RADIUS;
  
  const poll = {
    id: nextPollId++,
    name,
    address: address || '',
    lat: finalLat,
    lng: finalLng,
    radius: finalRadius
  };
  
  polls.push(poll);
  saveData();
  res.json({ success: true, poll });
});

app.post('/api/admin/polls/update', (req, res) => {
  const { id, radius } = req.body;
  const poll = polls.find(p => p.id === id);
  
  if (!poll) {
    return res.status(404).json({ error: 'קלפי לא נמצאה' });
  }
  
  if (radius !== undefined) {
    poll.radius = radius;
  }
  
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
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי,שעת הצבעה\n' + 
    voted.map(v => {
      const poll = polls.find(p => p.id === v.pollId);
      return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''},${v.votedAt}`;
    }).join('\n');
  
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="voted.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/export/not-voted', (req, res) => {
  const notVoted = voters.filter(v => !v.voted);
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי\n' + 
    notVoted.map(v => {
      const poll = polls.find(p => p.id === v.pollId);
      return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''}`;
    }).join('\n');
  
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="not-voted.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/export/all', (req, res) => {
  const csv = 'שם,ת.ז,שם קלפי,מספר קלפי,סטטוס,שעת הצבעה\n' + 
    voters.map(v => {
      const poll = polls.find(p => p.id === v.pollId);
      const status = v.voted ? 'הצביע' : 'טרם הצביע';
      return `${v.name},${v.idNumber},${poll?.name || ''},${poll?.id || ''},${status},${v.votedAt || '-'}`;
    }).join('\n');
  
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.header('Content-Disposition', 'attachment; filename="all-voters.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/voter/check-proximity', (req, res) => {
  const { lat, lng, voterId } = req.query;
  
  if (!lat || !lng || !voterId) {
    return res.json({ inRange: false });
  }
  
  const voter = voters.find(v => v.id === parseInt(voterId));
  if (!voter) {
    return res.json({ inRange: false });
  }
  
  const poll = polls.find(p => p.id === voter.pollId);
  if (!poll) {
    return res.json({ inRange: false });
  }
  
  const distance = calculateDistance(
    parseFloat(lat), parseFloat(lng),
    parseFloat(poll.lat), parseFloat(poll.lng)
  );
  
  const pollRadius = poll.radius || DEFAULT_RADIUS;
  const inRange = distance <= pollRadius;
  
  res.json({
    inRange,
    distance: Math.round(distance),
    pollName: poll.name,
    radius: pollRadius
  });
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

app.listen(PORT, () => {
  console.log('🚀 VPA Dashboard running on http://localhost:' + PORT);
  console.log('📍 Admin: http://localhost:' + PORT + '/admin');
  console.log('💾 Data file: ' + DATA_FILE);
  console.log('📏 Default radius: ' + DEFAULT_RADIUS + ' meters');
  console.log('🌐 Geocoding: OpenStreetMap Nominatim');
  console.log('🔧 System mode:', systemMode === 'test' ? 'Test/Demo ⚠️' : 'Election Day ✅');
});

/**
 * ATİK VİEWER — Backend Proxy Sunucusu
 * QIDO-RS / WADO-RS / C-FIND (saf JS) Proxy
 * Native modul yok — npm install sadece express kurar
 */

const express = require('express');
const http    = require('http');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const net     = require('net');
const { cfind } = require('./dicom-cfind.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Ana sayfa
app.get('/', (req, res) => {
  const p = path.join(__dirname, 'atik-viewer.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('atik-viewer.html bulunamadi.');
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.1.0', time: new Date().toISOString() });
});

// C-ECHO — TCP ping
app.get('/api/pacs/echo', async (req, res) => {
  const { ip, port, ae } = req.query;
  if (!ip || !port) return res.json({ ok: false, msg: 'IP ve port gerekli' });
  try {
    await tcpPing(ip, parseInt(port), 4000);
    return res.json({ ok: true, msg: `Baglanti OK: ${ip}:${port}`, method: 'tcp' });
  } catch (e) {
    return res.json({ ok: false, msg: `Baglanti hatasi: ${ip}:${port} — ${e.message}` });
  }
});

// C-FIND — once QIDO-RS, basarisizsa saf JS C-FIND
app.post('/api/pacs/find', async (req, res) => {
  const { serverIp, serverPort, serverAE, clientAE,
          patientName, patientId, accessionNumber,
          dateFrom, dateTo, modality } = req.body;

  if (!serverIp || !serverPort) {
    return res.json({ ok: false, results: [], msg: 'Sunucu bilgisi eksik' });
  }

  const filters = { patientName, patientId, accessionNumber, dateFrom, dateTo, modality };

  // 1. QIDO-RS dene
  try {
    const qido = await tryQIDO(serverIp, serverPort, filters);
    if (qido && qido.length > 0) {
      console.log(`[QIDO-RS] ${qido.length} sonuc`);
      return res.json({ ok: true, results: qido, method: 'qido-rs' });
    }
  } catch (e) {
    console.log(`[QIDO-RS] Basarisiz: ${e.message}`);
  }

  // 2. Saf JS C-FIND dene
  try {
    console.log(`[C-FIND] ${serverAE}@${serverIp}:${serverPort} sorgulanıyor...`);
    const cfindResults = await cfind(serverIp, parseInt(serverPort), serverAE, clientAE || 'ATIKVIEWER', filters, 20000);
    console.log(`[C-FIND] ${cfindResults.length} sonuc`);
    if (cfindResults.length > 0) {
      return res.json({ ok: true, results: cfindResults, method: 'c-find' });
    }
    return res.json({ ok: false, results: [], msg: 'Sonuc bulunamadi. Hasta adi veya tarih araligini kontrol edin.' });
  } catch (e) {
    console.log(`[C-FIND] Basarisiz: ${e.message}`);
    const msg = e.message || 'Bilinmeyen hata';
    const hint = msg.includes('A-ASSOCIATE-RJ')
      ? msg
      : msg.includes('TCP') || msg.includes('ECONNREFUSED')
        ? `Sunucuya baglanamadi: ${serverIp}:${serverPort} — IP/port dogru mu?`
        : `C-FIND hatasi: ${msg}`;
    return res.json({ ok: false, results: [], msg: hint });
  }
});

// WADO-RS proxy
app.get('/api/pacs/wado', async (req, res) => {
  const { serverIp, serverPort, studyUID, seriesUID } = req.query;
  if (!serverIp) return res.status(400).json({ error: 'Sunucu IP gerekli' });

  const bases = [
    `http://${serverIp}:${serverPort}/wado/rs`,
    `http://${serverIp}:${serverPort}/dicomweb`,
    `http://${serverIp}:${serverPort}/dcm4chee-arc/aets/DCM4CHEE/rs`,
    `http://${serverIp}:${serverPort}/orthanc/dicom-web`,
  ];

  for (const base of bases) {
    const url = seriesUID
      ? `${base}/studies/${studyUID}/series/${seriesUID}`
      : `${base}/studies/${studyUID}`;
    try {
      const data = await httpFetch(url, { Accept: 'application/json' }, 5000);
      return res.json({ ok: true, url, data: data.substring(0, 1000) });
    } catch (e) { /* dene sonraki */ }
  }
  res.json({ ok: false, msg: 'WADO-RS endpoint bulunamadi.' });
});

// Goruntu proxy
app.get('/api/pacs/image', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL gerekli');
  const proto = url.startsWith('https') ? https : http;
  proto.get(url, { headers: { Accept: 'application/octet-stream, application/dicom, */*' } }, (r) => {
    res.setHeader('Content-Type', r.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    r.pipe(res);
  }).on('error', e => res.status(502).send(e.message));
});

// QIDO-RS yardimcisi
async function tryQIDO(ip, port, filters) {
  const { patientName, patientId, dateFrom, dateTo, modality } = filters;
  const bases = [
    `http://${ip}:${port}/wado/rs`,
    `http://${ip}:${port}/dicomweb`,
    `http://${ip}:${port}/dcm4chee-arc/aets/DCM4CHEE/rs`,
    `http://${ip}:${port}/orthanc/dicom-web`,
    `http://${ip}:${port}/rs`,
  ];
  const params = new URLSearchParams();
  if (patientName) params.set('PatientName', patientName.replace(/\*/g,'') + '*');
  if (patientId)   params.set('PatientID', patientId);
  if (dateFrom && dateTo) params.set('StudyDate', `${dateFrom}-${dateTo}`);
  if (modality)    params.set('ModalitiesInStudy', modality);
  params.set('limit', '100');
  params.set('includefield', 'all');

  for (const base of bases) {
    try {
      const url = `${base}/studies?${params.toString()}`;
      const data = await httpFetch(url, { Accept: 'application/json' }, 5000);
      const json = JSON.parse(data);
      if (Array.isArray(json) && json.length > 0) {
        return json.map(s => ({
          patientName:  getTag(s, '00100010', 'Alphabetic') || 'Bilinmeyen',
          patientId:    getTag(s, '00100020') || '',
          patientBirth: getTag(s, '00100030') || '',
          studyDate:    formatDate(getTag(s, '00080020') || ''),
          modality:     getTag(s, '00080060') || getTag(s, '00080061') || '',
          description:  getTag(s, '00081030') || 'Calisma',
          accession:    getTag(s, '00080050') || '',
          numImages:    parseInt(getTag(s, '00201208') || '0') || 0,
          studyUID:     getTag(s, '0020000D') || '',
          seriesCount:  parseInt(getTag(s, '00201206') || '1'),
          source:       'qido-rs',
        }));
      }
    } catch (e) { /* sonraki */ }
  }
  throw new Error('QIDO-RS yanit vermedi');
}

function tcpPing(ip, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => { sock.destroy(); resolve(); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Zaman asimi')); });
    sock.on('error', reject);
    sock.connect(port, ip);
  });
}

function httpFetch(url, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const chunks = [];
    const req = proto.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function getTag(obj, tag, sub) {
  const t = obj?.[tag];
  if (!t) return '';
  const val = t.Value?.[0];
  if (val === undefined || val === null) return '';
  if (typeof val === 'object' && sub) return val[sub] || Object.values(val)[0] || '';
  return String(val);
}

function formatDate(v) {
  if (!v || v.length < 8) return v || '';
  return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
}

app.listen(PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  const ips = Object.values(ifaces).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   ATİK VİEWER — Proxy Sunucu Basladi        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Yerel:    http://localhost:${PORT}             ║`);
  ips.forEach(ip => {
    const pad = ' '.repeat(Math.max(0, 14 - ip.length));
    console.log(`║   Ag:       http://${ip}:${PORT}${pad}  ║`);
  });
  console.log('╚══════════════════════════════════════════════╝\n');
});
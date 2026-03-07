/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   ATİK VİEWER — Backend Proxy Sunucusu                  ║
 * ║   DICOM C-FIND / C-MOVE / WADO-RS Proxy                 ║
 * ║   Node.js + Express + dicom-dimse                        ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * KURULUM:
 *   npm install
 *   node server.js
 *
 * Tarayıcıdan erişim: http://localhost:3000
 */

const express    = require('express');
const http       = require('http');
const https      = require('https');
const path       = require('path');
const fs         = require('fs');
const net        = require('net');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CORS — tarayıcıdan erişime izin ver ───────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Ana sayfa — viewer ────────────────────────────────────
app.get('/', (req, res) => {
  const viewerPath = path.join(__dirname, 'atik-viewer.html');
  if (fs.existsSync(viewerPath)) {
    res.sendFile(viewerPath);
  } else {
    res.status(404).send('atik-viewer.html bulunamadı. Aynı klasöre koyun.');
  }
});

// ─── PACS C-ECHO test (TCP ping) ──────────────────────────
app.get('/api/pacs/echo', async (req, res) => {
  const { ip, port, ae } = req.query;
  if (!ip || !port) return res.json({ ok: false, msg: 'IP ve port gerekli' });

  try {
    await tcpPing(ip, parseInt(port), 4000);
    
    // Gerçek C-ECHO denemesi (dicom-dimse varsa)
    try {
      const result = await dicomEcho(ip, parseInt(port), ae || 'ECHOSCU', 'ATIKVIEWER');
      return res.json({ ok: true, msg: `C-ECHO başarılı: ${ae}@${ip}:${port}`, method: 'dicom' });
    } catch (e) {
      // TCP açık ama DICOM yanıt vermedi — yine de bağlantı var
      return res.json({ ok: true, msg: `TCP bağlantı OK: ${ip}:${port} (C-ECHO: ${e.message})`, method: 'tcp' });
    }
  } catch (e) {
    return res.json({ ok: false, msg: `Bağlantı reddedildi: ${ip}:${port} — ${e.message}` });
  }
});

// ─── PACS C-FIND proxy ─────────────────────────────────────
app.post('/api/pacs/find', async (req, res) => {
  const { serverIp, serverPort, serverAE, clientAE,
          patientName, patientId, accessionNumber,
          dateFrom, dateTo, modality } = req.body;

  if (!serverIp || !serverPort) {
    return res.json({ ok: false, results: [], msg: 'Sunucu bilgisi eksik' });
  }

  console.log(`[C-FIND] ${serverAE}@${serverIp}:${serverPort} — Hasta: "${patientName || '*'}"`);

  // Önce DICOMweb QIDO-RS dene
  try {
    const qidoResults = await tryQIDO(serverIp, serverPort, {
      patientName, patientId, accessionNumber, dateFrom, dateTo, modality
    });
    if (qidoResults && qidoResults.length > 0) {
      console.log(`[QIDO-RS] ${qidoResults.length} sonuç bulundu`);
      return res.json({ ok: true, results: qidoResults, method: 'qido-rs' });
    }
  } catch (e) {
    console.log(`[QIDO-RS] Başarısız: ${e.message}`);
  }

  // QIDO-RS yoksa — dicom-dimse ile C-FIND
  try {
    const cfindResults = await dicomFind(serverIp, parseInt(serverPort), serverAE, clientAE || 'ATIKVIEWER', {
      patientName, patientId, accessionNumber, dateFrom, dateTo, modality
    });
    console.log(`[C-FIND] ${cfindResults.length} sonuç`);
    return res.json({ ok: true, results: cfindResults, method: 'c-find' });
  } catch (e) {
    console.log(`[C-FIND] Başarısız: ${e.message}`);
    return res.json({ ok: false, results: [], msg: `C-FIND hatası: ${e.message}` });
  }
});

// ─── WADO-RS proxy — görüntü getir ─────────────────────────
app.get('/api/pacs/wado', async (req, res) => {
  const { serverIp, serverPort, studyUID, seriesUID, instanceUID, wadoPath } = req.query;
  if (!serverIp) return res.status(400).json({ error: 'Sunucu IP gerekli' });

  // Çeşitli WADO endpoint formatlarını dene
  const endpoints = [
    `http://${serverIp}:${serverPort}/wado/rs/studies/${studyUID}`,
    `http://${serverIp}:${serverPort}/dcm4chee-arc/aets/DCM4CHEE/rs/studies/${studyUID}`,
    `http://${serverIp}:${serverPort}/orthanc/studies/${studyUID}`,
    `http://${serverIp}:${serverPort}:8080/wado?requestType=WADO&studyUID=${studyUID}`,
  ];

  for (const url of endpoints) {
    try {
      const data = await httpFetch(url, { 'Accept': 'application/json' });
      res.json({ ok: true, url, data });
      return;
    } catch (e) {
      // dene sonraki
    }
  }
  res.json({ ok: false, msg: 'WADO-RS endpoint bulunamadı' });
});

// ─── WADO görüntü proxy — tarayıcıya CORS bypass ile ilet ─
app.get('/api/pacs/image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL gerekli');

  try {
    const proto = url.startsWith('https') ? https : http;
    const proxyReq = proto.get(url, {
      headers: { 'Accept': 'application/octet-stream, application/dicom, */*' }
    }, (proxyRes) => {
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      proxyRes.pipe(res);
    });
    proxyReq.on('error', e => res.status(502).send(e.message));
  } catch (e) {
    res.status(502).send(e.message);
  }
});

// ─── QIDO-RS sorgu yardımcısı ─────────────────────────────
async function tryQIDO(ip, port, filters) {
  const { patientName, patientId, dateFrom, dateTo, modality } = filters;

  // Yaygın QIDO-RS endpoint formatları
  const baseUrls = [
    `http://${ip}:${port}/wado/rs`,
    `http://${ip}:${port}/dicomweb`,
    `http://${ip}:${port}/dcm4chee-arc/aets/DCM4CHEE/rs`,
    `http://${ip}:${port}/orthanc/dicom-web`,
  ];

  const params = new URLSearchParams();
  if (patientName) params.set('PatientName', patientName + '*');
  if (patientId)   params.set('PatientID', patientId);
  if (dateFrom && dateTo) params.set('StudyDate', `${dateFrom}-${dateTo}`);
  if (modality)    params.set('ModalitiesInStudy', modality);
  params.set('limit', '100');
  params.set('includefield', 'all');

  for (const base of baseUrls) {
    try {
      const url = `${base}/studies?${params.toString()}`;
      const data = await httpFetch(url, { 'Accept': 'application/json' }, 5000);
      const json = JSON.parse(data);
      if (Array.isArray(json) && json.length > 0) {
        return json.map(s => ({
          patientName:  getTag(s, '00100010', 'Alphabetic') || getTag(s, '00100010') || 'Bilinmeyen',
          patientId:    getTag(s, '00100020') || '',
          patientBirth: getTag(s, '00100030') || '',
          studyDate:    formatDicomDate(getTag(s, '00080020') || ''),
          studyTime:    getTag(s, '00080030') || '',
          modality:     getTag(s, '00080060') || getTag(s, '00080061') || 'CT',
          description:  getTag(s, '00081030') || 'Çalışma',
          accession:    getTag(s, '00080050') || '',
          numImages:    parseInt(getTag(s, '00201208') || '0') || '',
          studyUID:     getTag(s, '0020000D') || '',
          seriesCount:  parseInt(getTag(s, '00201206') || '1'),
          source:       'qido-rs',
        }));
      }
    } catch (e) {
      // dene sonraki
    }
  }
  throw new Error('QIDO-RS erişilemez');
}

// ─── dicom-dimse C-FIND ────────────────────────────────────
async function dicomFind(ip, port, serverAE, clientAE, filters) {
  // dicom-dimse paketi yüklü mü kontrol et
  let dicom;
  try {
    dicom = require('dicom-dimse');
  } catch (e) {
    throw new Error('dicom-dimse paketi yüklü değil. "npm install dicom-dimse" çalıştırın.');
  }

  return new Promise((resolve, reject) => {
    const { patientName, patientId, dateFrom, dateTo, modality } = filters;

    const request = dicom.requests.CFindRequest.createStudyFindRequest({
      PatientName: patientName ? `*${patientName}*` : '*',
      PatientID: patientId || '',
      StudyDate: (dateFrom && dateTo) ? `${dateFrom}-${dateTo}` : '',
      ModalitiesInStudy: modality || '',
    });

    const client = new dicom.Client();
    const results = [];

    client.on('response', (responses) => {
      responses.forEach(r => {
        if (r.getStatus() === 0xFF00 || r.getStatus() === 0xFF01) {
          const ds = r.getDataset();
          results.push({
            patientName:  ds?.PatientName?.value || 'Bilinmeyen',
            patientId:    ds?.PatientID?.value || '',
            patientBirth: ds?.PatientBirthDate?.value || '',
            studyDate:    formatDicomDate(ds?.StudyDate?.value || ''),
            modality:     ds?.ModalitiesInStudy?.value || ds?.Modality?.value || 'CT',
            description:  ds?.StudyDescription?.value || 'Çalışma',
            accession:    ds?.AccessionNumber?.value || '',
            numImages:    parseInt(ds?.NumberOfStudyRelatedInstances?.value || '0'),
            studyUID:     ds?.StudyInstanceUID?.value || '',
            source:       'c-find',
          });
        }
      });
    });

    client.on('done', () => resolve(results));
    client.on('error', reject);

    try {
      client.connect(ip, port, serverAE, clientAE);
      client.sendRequest(request);
    } catch (e) {
      reject(e);
    }
  });
}

// ─── dicom-dimse C-ECHO ────────────────────────────────────
async function dicomEcho(ip, port, serverAE, clientAE) {
  let dicom;
  try {
    dicom = require('dicom-dimse');
  } catch (e) {
    throw new Error('dicom-dimse yüklü değil');
  }

  return new Promise((resolve, reject) => {
    const client = new dicom.Client();
    client.on('done', resolve);
    client.on('error', reject);
    try {
      client.connect(ip, port, serverAE, clientAE);
      client.sendEcho();
    } catch (e) {
      reject(e);
    }
  });
}

// ─── TCP ping ─────────────────────────────────────────────
function tcpPing(ip, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;
    sock.setTimeout(timeout);
    sock.on('connect', () => { done = true; sock.destroy(); resolve(); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Zaman aşımı')); });
    sock.on('error', (e) => { if (!done) reject(e); });
    sock.connect(port, ip);
  });
}

// ─── HTTP fetch yardımcısı ─────────────────────────────────
function httpFetch(url, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const chunks = [];
    const req = proto.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Zaman asimi')); });
  });
}

// ─── DICOMweb tag okuma yardımcısı ─────────────────────────
function getTag(obj, tag, sub) {
  const t = obj?.[tag];
  if (!t) return '';
  const val = t.Value?.[0];
  if (val === undefined || val === null) return '';
  if (typeof val === 'object' && sub) return val[sub] || Object.values(val)[0] || '';
  return String(val);
}

function formatDicomDate(v) {
  if (!v || v.length < 8) return v || '';
  return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
}

// ─── Sunucuyu başlat ──────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  const ips = Object.values(ifaces).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   ATİK VİEWER — Proxy Sunucu Başladı        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Yerel:    http://localhost:${PORT}             ║`);
  ips.forEach(ip => {
    const pad = ' '.repeat(Math.max(0, 14 - ip.length));
    console.log(`║   Ağ:       http://${ip}:${PORT}${pad}  ║`);
  });
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║   PACS API:  /api/pacs/echo                  ║');
  console.log('║             /api/pacs/find                   ║');
  console.log('║             /api/pacs/image                  ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});

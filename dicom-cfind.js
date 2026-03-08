/**
 * Saf Node.js ile DICOM C-FIND (Study Root)
 * - A-ASSOCIATE-AC'den kabul edilen PC-ID okunur
 * - Command ve Dataset AYRI P-DATA-TF PDU'lar olarak gonderilir
 * - DICOM PS3.8 tam uyumlu
 */
'use strict';
const net = require('net');

const STUDY_ROOT_FIND = '1.2.840.10008.5.1.4.1.2.2.1';
const IMPLICIT_VR_LE  = '1.2.840.10008.1.2';
const EXPLICIT_VR_LE  = '1.2.840.10008.1.2.1';
const APP_CONTEXT_UID = '1.2.840.10008.3.1.1.1';

/* ── Encode yardimcilari ─────────────────────────────────── */
const u16BE = v => { const b=Buffer.alloc(2); b.writeUInt16BE(v,0); return b; };
const u16LE = v => { const b=Buffer.alloc(2); b.writeUInt16LE(v,0); return b; };
const u32LE = v => { const b=Buffer.alloc(4); b.writeUInt32LE(v,0); return b; };
const u32BE = v => { const b=Buffer.alloc(4); b.writeUInt32BE(v,0); return b; };

// DICOM PS3.5: UID'ler null (0x00) ile cift bayta tamamlanir
function padUID(uid) {
  const b = Buffer.from(uid, 'ascii');
  return b.length % 2 === 0 ? b : Buffer.concat([b, Buffer.from([0x00])]);
}

// String degerler space (0x20) ile cift bayta tamamlanir
function padStr(s) {
  const b = Buffer.from(s || '', 'ascii');
  return b.length % 2 === 0 ? b : Buffer.concat([b, Buffer.from([0x20])]);
}

// Implicit VR LE data element
function de(group, elem, val) {
  const vb = Buffer.isBuffer(val) ? val : padStr(val);
  return Buffer.concat([u16LE(group), u16LE(elem), u32LE(vb.length), vb]);
}

// PDU sarmalayici: [type(1), reserved(1), length(4BE), data]
function wrapPDU(type, data) {
  return Buffer.concat([Buffer.from([type, 0x00]), u32BE(data.length), data]);
}

// Association sub-item: [type(1), reserved(1), length(2BE), data]
function uidItem(type, uid) {
  const data = padUID(uid);
  return Buffer.concat([Buffer.from([type, 0x00]), u16BE(data.length), data]);
}

/* ── A-ASSOCIATE-RQ (PDU 0x01) ──────────────────────────── */
function buildAssocRQ(callingAE, calledAE) {
  const called  = Buffer.alloc(16, 0x20);
  const calling = Buffer.alloc(16, 0x20);
  Buffer.from(calledAE.substring(0,16),  'ascii').copy(called);
  Buffer.from(callingAE.substring(0,16), 'ascii').copy(calling);

  // Application Context Item (0x10)
  const appCtxItem = uidItem(0x10, APP_CONTEXT_UID);

  // Presentation Context Item (0x20)
  // [item-type(1), reserved(1), length(2BE), pc-id(1), reserved(3), sub-items...]
  const absSynItem = uidItem(0x30, STUDY_ROOT_FIND);
  const ts1Item    = uidItem(0x40, EXPLICIT_VR_LE);
  const ts2Item    = uidItem(0x40, IMPLICIT_VR_LE);

  const pcInner = Buffer.concat([
    Buffer.from([0x01, 0x00, 0x00, 0x00]), // PC-ID=1, 3 reserved
    absSynItem, ts1Item, ts2Item,
  ]);
  const pcItem = Buffer.concat([
    Buffer.from([0x20, 0x00]), u16BE(pcInner.length), pcInner,
  ]);

  // User Information (0x50) + Max PDU Sub-Item (0x51) = 16384
  const maxPDUSub = Buffer.concat([
    Buffer.from([0x51, 0x00, 0x00, 0x04]),
    u32BE(16384),
  ]);
  const userInfo = Buffer.concat([
    Buffer.from([0x50, 0x00]), u16BE(maxPDUSub.length), maxPDUSub,
  ]);

  const body = Buffer.concat([
    u16BE(0x0001),    // Protocol version
    Buffer.alloc(2),  // Reserved
    called, calling,
    Buffer.alloc(32), // Reserved
    appCtxItem, pcItem, userInfo,
  ]);
  return wrapPDU(0x01, body);
}

/* ── A-ASSOCIATE-AC parse: kabul edilen PC-ID'yi bul ────── */
function parseAssocAC(pduData) {
  // PDU body: 2(version) + 2(reserved) + 16(called) + 16(calling) + 32(reserved) = 68
  let off = 68;
  let acceptedPcId = 1; // varsayilan

  while (off + 4 <= pduData.length) {
    const itype = pduData[off];
    const ilen  = pduData.readUInt16BE(off + 2);
    const idata = pduData.slice(off + 4, off + 4 + ilen);

    if (itype === 0x21 && ilen >= 4) {
      // Presentation Context Item (AC) - accepted
      const pcId     = idata[0];
      const result   = idata[2]; // 0=accepted
      if (result === 0) {
        acceptedPcId = pcId;
        console.log(`[C-FIND] Kabul edilen PC-ID: ${pcId}`);
      }
    }
    off += 4 + ilen;
  }
  return acceptedPcId;
}

/* ── C-FIND-RQ P-DATA-TF'leri ───────────────────────────── */
function buildCFindPDUs(pcId, filters) {
  const { patientName, patientId, dateFrom, dateTo, modality } = filters || {};

  // Tarih: YYYYMMDD-YYYYMMDD
  let studyDate = '';
  if (dateFrom || dateTo) {
    const d1 = (dateFrom || '').replace(/-/g,'');
    const d2 = (dateTo   || '').replace(/-/g,'');
    if (d1 && d2 && d1 !== d2) studyDate = `${d1}-${d2}`;
    else studyDate = d1 || d2;
  }

  // ── Command Set (Implicit VR LE, group 0x0000) ────────
  // (0000,0002) AffectedSOPClassUID
  const de0002 = de(0x0000, 0x0002, padUID(STUDY_ROOT_FIND));
  // (0000,0100) CommandField = 0x0020 C-FIND-RQ
  const de0100 = de(0x0000, 0x0100, u16LE(0x0020));
  // (0000,0110) MessageID = 1
  const de0110 = de(0x0000, 0x0110, u16LE(0x0001));
  // (0000,0600) Priority = 0x0000 MEDIUM
  const de0600 = de(0x0000, 0x0600, u16LE(0x0000));
  // (0000,0800) CommandDataSetType = 0x0001 (dataset var)
  const de0800 = de(0x0000, 0x0800, u16LE(0x0001));

  const cmdRest = Buffer.concat([de0002, de0100, de0110, de0600, de0800]);
  // (0000,0000) CommandGroupLength = toplam bytes AFTER this element
  const de0000  = de(0x0000, 0x0000, u32LE(cmdRest.length));
  const cmdSet  = Buffer.concat([de0000, cmdRest]);

  // ── Dataset (Implicit VR LE) ──────────────────────────
  const dataset = Buffer.concat([
    de(0x0008, 0x0052, 'STUDY'),
    de(0x0010, 0x0010, patientName ? patientName.replace(/\*/g,'').trim() + '*' : ''),
    de(0x0010, 0x0020, patientId   || ''),
    de(0x0010, 0x0030, ''),
    de(0x0010, 0x0040, ''),
    de(0x0008, 0x0020, studyDate),
    de(0x0008, 0x0030, ''),
    de(0x0008, 0x0050, ''),
    de(0x0008, 0x0060, modality    || ''),
    de(0x0008, 0x0061, ''),
    de(0x0008, 0x1030, ''),
    de(0x0020, 0x000D, ''),
    de(0x0020, 0x1206, ''),
    de(0x0020, 0x1208, ''),
  ]);

  // ── P-DATA-TF PDU: ayri PDU olarak gonder ────────────
  // [pdvLen(4LE), pcId(1), msgCtrl(1), payload]
  // msgCtrl: bit0=1:command 0:dataset, bit1=1:last-fragment
  function makePDataPDU(payload, isCommand) {
    const msgCtrl = isCommand ? 0x03 : 0x02;
    const pdvInner = Buffer.concat([Buffer.from([pcId, msgCtrl]), payload]);
    const pdv = Buffer.concat([u32LE(pdvInner.length), pdvInner]);
    return wrapPDU(0x04, pdv);
  }

  return {
    cmdPDU: makePDataPDU(cmdSet,  true),
    dsPDU:  makePDataPDU(dataset, false),
  };
}

/* ── Tag parser (Implicit VR LE) ─────────────────────────── */
function parseTags(buf) {
  const out = {};
  let i = 0;
  while (i + 8 <= buf.length) {
    const group = buf.readUInt16LE(i);
    const elem  = buf.readUInt16LE(i + 2);
    const vlen  = buf.readUInt32LE(i + 4);
    if (vlen === 0xFFFFFFFF || vlen > buf.length - i - 8) break;
    const val = buf.slice(i + 8, i + 8 + vlen).toString('latin1').trim().replace(/\x00/g,'');
    out[`${group.toString(16).padStart(4,'0')}${elem.toString(16).padStart(4,'0')}`] = val;
    i += 8 + vlen;
  }
  return out;
}

function fmtDate(v) {
  if (!v || v.length < 8) return v || '';
  return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
}

/* ── Ana cfind fonksiyonu ────────────────────────────────── */
function cfind(ip, port, serverAE, clientAE, filters, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const sock    = new net.Socket();
    const results = [];
    let   rxBuf   = Buffer.alloc(0);
    let   state   = 'connecting';
    let   settled = false;
    let   acceptedPcId = 1;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch(_) {}
      if (err && results.length === 0) reject(err);
      else resolve(results);
    };

    const timer = setTimeout(() => {
      console.log(`[C-FIND] Zaman asimi, ${results.length} sonuc donduruldu`);
      finish(null);
    }, timeout);

    const aeServer = (serverAE || 'PACS').trim().toUpperCase().substring(0,16);
    const aeClient = (clientAE || 'ATIKVIEWER').trim().toUpperCase().substring(0,16);

    sock.connect(port, ip, () => {
      state = 'assoc';
      console.log(`[C-FIND] A-ASSOCIATE-RQ: ${aeClient} -> ${aeServer}@${ip}:${port}`);
      sock.write(buildAssocRQ(aeClient, aeServer));
    });

    sock.on('data', chunk => {
      rxBuf = Buffer.concat([rxBuf, chunk]);

      while (!settled && rxBuf.length >= 6) {
        const pduType = rxBuf[0];
        const pduLen  = rxBuf.readUInt32BE(2);
        if (rxBuf.length < 6 + pduLen) break;
        const pduData = rxBuf.slice(6, 6 + pduLen);
        rxBuf = rxBuf.slice(6 + pduLen);

        /* A-ASSOCIATE-AC (0x02) */
        if (pduType === 0x02 && state === 'assoc') {
          acceptedPcId = parseAssocAC(pduData);
          console.log(`[C-FIND] A-ASSOCIATE-AC alindi, PC-ID=${acceptedPcId}, C-FIND-RQ gonderiliyor...`);
          state = 'cfind';
          const { cmdPDU, dsPDU } = buildCFindPDUs(acceptedPcId, filters);
          // Command PDU'yu gonder, dataset PDU'yu hemen ardindan gonder
          sock.write(cmdPDU);
          sock.write(dsPDU);

        /* P-DATA-TF (0x04) */
        } else if (pduType === 0x04 && state === 'cfind') {
          let off = 0;
          while (off + 4 <= pduData.length) {
            const pdvLen = pduData.readUInt32LE(off);
            if (pdvLen < 2 || off + 4 + pdvLen > pduData.length) break;
            const ctrl    = pduData[off + 5];
            const isCmd   = (ctrl & 0x01) !== 0;
            const isLast  = (ctrl & 0x02) !== 0;
            const payload = pduData.slice(off + 6, off + 4 + pdvLen);

            if (!isCmd && payload.length > 0) {
              const parsed = parseTags(payload);
              if (parsed['0020000d'] || parsed['00100010'] || parsed['00100020']) {
                results.push({
                  patientName:  (parsed['00100010'] || 'Bilinmeyen').replace(/\^/g,' ').replace(/\s+/g,' ').trim(),
                  patientId:    parsed['00100020'] || '',
                  patientBirth: parsed['00100030'] || '',
                  studyDate:    fmtDate(parsed['00080020'] || ''),
                  modality:     parsed['00080060'] || parsed['00080061'] || '',
                  description:  parsed['00081030'] || '',
                  accession:    parsed['00080050'] || '',
                  numImages:    parseInt(parsed['00201208'] || '0') || 0,
                  seriesCount:  parseInt(parsed['00201206'] || '0') || 0,
                  studyUID:     parsed['0020000d'] || '',
                  source:       'c-find',
                });
              }
            }

            // Son command fragment = C-FIND-RSP final status
            if (isCmd && isLast) {
              console.log(`[C-FIND] Tamamlandi: ${results.length} sonuc`);
              finish(null);
              return;
            }
            off += 4 + pdvLen;
          }

        /* A-ASSOCIATE-RJ (0x03) */
        } else if (pduType === 0x03) {
          const src    = pduData.length > 3 ? pduData[3] : 0;
          const reason = pduData.length > 4 ? pduData[4] : 0;
          const r3 = {1:'Geçici tıkanma',2:'Yerel sınır',7:'Called AE tanınmıyor'};
          const r1 = {1:'Desteklenmiyor',2:'Versiyon uyumsuzluğu'};
          const rStr = (src===3?r3:src===1?r1:{})[reason] || `reason=${reason}`;
          finish(new Error(`PACS bağlantıyı reddetti: ${rStr}. AE="${aeClient}" PACS listesinde var mı?`));
          return;

        /* A-ABORT (0x07) */
        } else if (pduType === 0x07) {
          const src    = pduData.length > 2 ? pduData[2] : 0;
          const reason = pduData.length > 3 ? pduData[3] : 0;
          const rMap   = {0:'Belirtilmemiş',1:'Tanımsız PDU',2:'Beklenmedik PDU',4:'Tanımsız param',5:'Beklenmedik param',6:'Geçersiz param'};
          const rStr   = rMap[reason] || `reason=${reason}`;
          console.error(`[C-FIND] A-ABORT: src=${src}, reason=${reason} (${rStr})`);
          finish(new Error(`A-ABORT (${rStr}): PACS bağlantıyı kesti.`));
          return;
        }
      }
    });

    sock.on('error', e => {
      console.error('[C-FIND] TCP hata:', e.message);
      finish(new Error(`TCP hatası: ${e.message}`));
    });
    sock.on('close', () => finish(null));
  });
}

module.exports = { cfind };
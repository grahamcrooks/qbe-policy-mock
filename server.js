// Mock Guidewire PolicyCenter and Duck Creek Policy APIs for Pega training.
// Illustrative only: paths and payloads are simplified, not the vendors' official APIs.
const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json({ limit: '1mb' }));

const API_KEY = process.env.API_KEY || 'qbe-demo';
const now = () => new Date().toISOString();
const id = (p) => `${p}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// CORS and simple API key check (header X-API-Key). /health and / are open.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Idempotency-Key, X-Mock-Scenario');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.path === '/' || req.path === '/health' || req.path === '/openapi.yaml') return next();
  if (req.get('X-API-Key') !== API_KEY) return res.status(401).json({ error: 'UNAUTHORISED', message: 'Missing or invalid X-API-Key header' });
  next();
});

// Scenario switch for teaching error handling: header X-Mock-Scenario = timeout | validation | unavailable
app.use(async (req, res, next) => {
  const s = (req.get('X-Mock-Scenario') || '').toLowerCase();
  if (s === 'timeout') { await new Promise(r => setTimeout(r, 30000)); return res.status(504).json({ error: 'TIMEOUT' }); }
  if (s === 'validation') return res.status(422).json({ error: 'VALIDATION_FAILED', message: 'Simulated validation error', fields: ['insured.name'] });
  if (s === 'unavailable') return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Simulated outage' });
  next();
});

// ---------- In-memory stores, seeded with demo data ----------
const gw = { submissions: {}, policies: {}, idem: {} };
const dc = { quotes: {}, policies: {}, idem: {} };

gw.policies['GW-POL-100001'] = {
  policyNumber: 'GW-POL-100001', accountNumber: 'ACC-SYD-001', status: 'InForce',
  insured: { name: 'Harbour Tower Holdings Pty Ltd', abn: '12 345 678 901' },
  product: 'TerrorismSabotage', jurisdiction: 'AU',
  periodStart: '2026-01-01', periodEnd: '2026-12-31',
  sumInsured: { amount: 1200000000, currency: 'AUD' }, sharePercent: 15, role: 'Lead',
  premium: { amount: 48600, currency: 'AUD' }, terrorismPool: 'ARPC',
  location: { address: '1 Harbour St, Sydney NSW 2000', lat: -33.8615, lon: 151.2055 }
};
dc.policies['DC-POL-200001'] = {
  policyId: 'DC-POL-200001', insuredId: 'INS-LON-001', policyStatus: 'ISSUED',
  insuredName: 'Thames Office Estates Ltd', lineOfBusiness: 'TERRORISM', territory: 'GB',
  effectiveDate: '2026-03-01', expirationDate: '2027-02-28',
  totalInsuredValue: 900000000, currencyCode: 'GBP', participationPct: 10, participationRole: 'FOLLOW',
  writtenPremium: 19800, terrorismPool: 'POOL_RE',
  riskAddress: { line1: '1 Thames Walk', city: 'London', postcode: 'EC4R 1AA', country: 'GB' }
};
const claims = {
  'GW-POL-100001': [
    { claimNumber: 'GW-CLM-5001', lossDate: '2024-07-14', cause: 'Malicious damage', paid: 42000, reserved: 0, currency: 'AUD', status: 'Closed' }
  ],
  'DC-POL-200001': [
    { claimId: 'DC-CLM-8001', dateOfLoss: '2025-02-02', causeOfLoss: 'DENIAL_OF_ACCESS', paidAmount: 0, reserveAmount: 75000, currencyCode: 'GBP', claimStatus: 'OPEN' }
  ]
};

// Simple rating: rate per mille on sum insured times share, plus loadings
function rate(sumInsured, sharePct, jurisdiction) {
  const ratePerMille = jurisdiction === 'GB' ? 0.22 : 0.27;
  const base = (sumInsured / 1000) * ratePerMille * (sharePct / 100);
  return Math.round(base);
}
function idempotent(store, req, res) {
  const key = req.get('Idempotency-Key');
  if (key && store.idem[key]) { res.status(200).json(store.idem[key]); return { done: true }; }
  return { key };
}

// ---------- Info ----------
app.get('/', (req, res) => res.json({
  service: 'QBE training mock: Guidewire PolicyCenter and Duck Creek Policy',
  note: 'Illustrative only. Not the vendors\' official APIs.',
  auth: 'Send header X-API-Key',
  guidewireBase: '/guidewire/pc/rest', duckCreekBase: '/duckcreek/policy/api/v1',
  docs: '/openapi.yaml'
}));
app.get('/health', (req, res) => res.json({ status: 'ok', time: now() }));
app.get('/openapi.yaml', (req, res) => res.type('text/yaml').sendFile(__dirname + '/openapi.yaml'));

// ---------- Guidewire-style ----------
const G = express.Router();
G.post('/job/v1/submissions', (req, res) => {
  const b = req.body || {};
  if (!b.insured || !b.insured.name) return res.status(422).json({ error: 'VALIDATION_FAILED', message: 'insured.name is required' });
  const s = { submissionId: id('GW-SUB'), status: 'Draft', createdAt: now(), pegaCaseId: b.pegaCaseId || null,
    accountNumber: b.accountNumber || id('ACC'), insured: b.insured, product: b.product || 'Property',
    jurisdiction: b.jurisdiction || 'AU', periodStart: b.periodStart, periodEnd: b.periodEnd,
    sumInsured: b.sumInsured || { amount: 0, currency: 'AUD' }, sharePercent: b.sharePercent ?? 100, role: b.role || 'Lead',
    location: b.location || null };
  gw.submissions[s.submissionId] = s;
  res.status(201).json(s);
});
G.get('/job/v1/submissions/:id', (req, res) => {
  const s = gw.submissions[req.params.id]; if (!s) return res.status(404).json({ error: 'NOT_FOUND' }); res.json(s);
});
G.post('/job/v1/submissions/:id/quote', (req, res) => {
  const s = gw.submissions[req.params.id]; if (!s) return res.status(404).json({ error: 'NOT_FOUND' });
  if (s.status === 'Bound') return res.status(409).json({ error: 'ALREADY_BOUND', policyNumber: s.policyNumber });
  const premium = rate(s.sumInsured.amount, s.sharePercent, s.jurisdiction);
  s.status = 'Quoted';
  s.quote = { quoteId: id('GW-QTE'), quotedAt: now(), validUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    premium: { amount: premium, currency: s.sumInsured.currency }, ratingModelVersion: 'GW-RATE-2026.2',
    taxes: s.jurisdiction === 'AU' ? { gst: Math.round(premium * 0.1), stampDutyEstimate: Math.round(premium * 0.09) } : {} };
  res.json(s);
});
G.post('/job/v1/submissions/:id/bind', (req, res) => {
  const i = idempotent(gw, req, res); if (i.done) return;
  const s = gw.submissions[req.params.id]; if (!s) return res.status(404).json({ error: 'NOT_FOUND' });
  if (s.status === 'Bound') return res.status(409).json({ error: 'ALREADY_BOUND', policyNumber: s.policyNumber });
  if (s.status !== 'Quoted') return res.status(422).json({ error: 'NOT_QUOTED', message: 'Submission must be quoted before bind' });
  const decisionId = (req.body || {}).pegaDecisionId;
  if (!decisionId) return res.status(403).json({ error: 'APPROVED_DECISION_REQUIRED', message: 'Bind rejected: no approved Pega decision ID (one front door).' });
  const policyNumber = id('GW-POL');
  s.status = 'Bound'; s.policyNumber = policyNumber;
  const p = { policyNumber, accountNumber: s.accountNumber, status: 'InForce', boundAt: now(), pegaDecisionId: decisionId,
    pegaCaseId: s.pegaCaseId, insured: s.insured, product: s.product, jurisdiction: s.jurisdiction,
    periodStart: s.periodStart, periodEnd: s.periodEnd, sumInsured: s.sumInsured, sharePercent: s.sharePercent, role: s.role,
    premium: s.quote.premium, location: s.location };
  gw.policies[policyNumber] = p;
  const out = { submissionId: s.submissionId, status: 'Bound', policyNumber, policy: p };
  if (i.key) gw.idem[i.key] = out;
  res.status(201).json(out);
});
G.get('/policy/v1/policies', (req, res) => {
  const acc = req.query.accountNumber;
  res.json({ data: Object.values(gw.policies).filter(p => !acc || p.accountNumber === acc) });
});
G.get('/policy/v1/policies/:policyNumber', (req, res) => {
  const p = gw.policies[req.params.policyNumber]; if (!p) return res.status(404).json({ error: 'NOT_FOUND' }); res.json(p);
});
G.get('/policy/v1/policies/:policyNumber/claims', (req, res) => {
  if (!gw.policies[req.params.policyNumber]) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ data: claims[req.params.policyNumber] || [] });
});
app.use('/guidewire/pc/rest', G);

// ---------- Duck Creek-style ----------
const D = express.Router();
D.post('/quotes', (req, res) => {
  const b = req.body || {};
  if (!b.insuredName) return res.status(422).json({ error: 'VALIDATION_FAILED', message: 'insuredName is required' });
  const q = { quoteId: id('DC-QTE'), quoteStatus: 'IN_PROGRESS', createdDate: now(), externalReference: b.externalReference || null,
    insuredId: b.insuredId || id('INS'), insuredName: b.insuredName, lineOfBusiness: b.lineOfBusiness || 'PROPERTY',
    territory: b.territory || 'GB', effectiveDate: b.effectiveDate, expirationDate: b.expirationDate,
    totalInsuredValue: b.totalInsuredValue || 0, currencyCode: b.currencyCode || 'GBP',
    participationPct: b.participationPct ?? 100, participationRole: b.participationRole || 'LEAD', riskAddress: b.riskAddress || null };
  dc.quotes[q.quoteId] = q;
  res.status(201).json(q);
});
D.get('/quotes/:id', (req, res) => {
  const q = dc.quotes[req.params.id]; if (!q) return res.status(404).json({ error: 'NOT_FOUND' }); res.json(q);
});
D.post('/quotes/:id/rate', (req, res) => {
  const q = dc.quotes[req.params.id]; if (!q) return res.status(404).json({ error: 'NOT_FOUND' });
  if (q.quoteStatus === 'ISSUED') return res.status(409).json({ error: 'ALREADY_ISSUED', policyId: q.policyId });
  const premium = rate(q.totalInsuredValue, q.participationPct, q.territory);
  q.quoteStatus = 'RATED';
  q.rating = { writtenPremium: premium, currencyCode: q.currencyCode, ratedDate: now(), rateTableVersion: 'DC-RT-26.07',
    taxes: q.territory === 'GB' ? { insurancePremiumTax: Math.round(premium * 0.12) } : {} };
  res.json(q);
});
D.post('/quotes/:id/issue', (req, res) => {
  const i = idempotent(dc, req, res); if (i.done) return;
  const q = dc.quotes[req.params.id]; if (!q) return res.status(404).json({ error: 'NOT_FOUND' });
  if (q.quoteStatus === 'ISSUED') return res.status(409).json({ error: 'ALREADY_ISSUED', policyId: q.policyId });
  if (q.quoteStatus !== 'RATED') return res.status(422).json({ error: 'NOT_RATED', message: 'Quote must be rated before issue' });
  const decisionId = (req.body || {}).approvedDecisionRef;
  if (!decisionId) return res.status(403).json({ error: 'APPROVED_DECISION_REQUIRED', message: 'Issue rejected: no approved Pega decision reference (one front door).' });
  const policyId = id('DC-POL');
  q.quoteStatus = 'ISSUED'; q.policyId = policyId;
  const p = { policyId, insuredId: q.insuredId, policyStatus: 'ISSUED', issuedDate: now(), approvedDecisionRef: decisionId,
    externalReference: q.externalReference, insuredName: q.insuredName, lineOfBusiness: q.lineOfBusiness, territory: q.territory,
    effectiveDate: q.effectiveDate, expirationDate: q.expirationDate, totalInsuredValue: q.totalInsuredValue, currencyCode: q.currencyCode,
    participationPct: q.participationPct, participationRole: q.participationRole, writtenPremium: q.rating.writtenPremium, riskAddress: q.riskAddress };
  dc.policies[policyId] = p;
  const out = { quoteId: q.quoteId, quoteStatus: 'ISSUED', policyId, policy: p };
  if (i.key) dc.idem[i.key] = out;
  res.status(201).json(out);
});
D.get('/policies', (req, res) => {
  const ins = req.query.insuredId;
  res.json({ items: Object.values(dc.policies).filter(p => !ins || p.insuredId === ins) });
});
D.get('/policies/:id', (req, res) => {
  const p = dc.policies[req.params.id]; if (!p) return res.status(404).json({ error: 'NOT_FOUND' }); res.json(p);
});
D.get('/policies/:id/claims', (req, res) => {
  if (!dc.policies[req.params.id]) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ items: claims[req.params.id] || [] });
});
app.use('/duckcreek/policy/api/v1', D);

app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', path: req.path }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mock policy APIs listening on ${port}`));

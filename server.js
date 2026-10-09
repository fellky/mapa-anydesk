const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

// ---------- config (usuário, senha, pasta de backup) ----------
const CFG = path.join(DATA, 'config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch {}
const saveCfg = () => fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
if (!cfg.secret) { cfg.secret = crypto.randomBytes(32).toString('hex'); saveCfg(); }

// ---------- banco ----------
const db = new DatabaseSync(path.join(DATA, 'mapa.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS setores (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS impressoras (
  id INTEGER PRIMARY KEY,
  setor_id INTEGER NOT NULL REFERENCES setores(id) ON DELETE RESTRICT,
  nome TEXT NOT NULL,
  modelo TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  referencia TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS maquinas (
  id INTEGER PRIMARY KEY,
  setor_id INTEGER NOT NULL REFERENCES setores(id) ON DELETE RESTRICT,
  nome TEXT NOT NULL,
  referencia TEXT NOT NULL DEFAULT '',
  anydesk_id TEXT NOT NULL DEFAULT '',
  hostname TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '',
  impressora_id INTEGER REFERENCES impressoras(id) ON DELETE SET NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
// bancos criados antes: 'posicao' virou 'referencia' (colunas antigas sem uso ficam no arquivo, sem problema)
try { db.exec('ALTER TABLE maquinas RENAME COLUMN posicao TO referencia'); } catch {}
try { db.exec('ALTER TABLE maquinas ADD COLUMN impressora_id INTEGER REFERENCES impressoras(id) ON DELETE SET NULL'); } catch {}

// ---------- sessão (cookie assinado, sem dependências) ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const sign = v => crypto.createHmac('sha256', cfg.secret).update(v).digest('hex');
const makeToken = () => { const exp = String(Date.now() + 12 * 3600e3); return `${exp}.${sign(exp)}`; };
const validToken = t => {
  const [exp, sig] = String(t || '').split('.');
  return !!sig && sig.length === 64 && Number(exp) > Date.now() &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp)));
};
const getCookie = req => (req.headers.cookie || '').split('; ').find(c => c.startsWith('sid='))?.slice(4);
const setSession = res => res.setHeader("Set-Cookie", `sid=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
const auth = (req, res, next) => validToken(getCookie(req)) ? next() : res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });

const fails = {};
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/alpine.js', (_, res) => res.sendFile(path.join(__dirname, 'node_modules/alpinejs/dist/cdn.min.js')));

app.get('/api/estado', (req, res) => res.json({ configurado: !!cfg.hash, autenticado: validToken(getCookie(req)) }));

app.post('/api/setup', (req, res) => {
  if (cfg.hash) return res.status(403).json({ erro: 'Acesso já configurado.' });
  const { usuario, senha } = req.body;
  if (!usuario?.trim() || (senha || '').length < 6) return res.status(400).json({ erro: 'Informe usuário e uma senha com 6 caracteres ou mais.' });
  cfg.user = usuario.trim(); cfg.salt = crypto.randomBytes(16).toString('hex'); cfg.hash = hashPw(senha, cfg.salt);
  saveCfg(); setSession(res); res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const f = fails[req.ip] || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 600e3) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 5) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  const { usuario, senha } = req.body;
  const ok = cfg.hash && usuario === cfg.user &&
    crypto.timingSafeEqual(Buffer.from(hashPw(String(senha || ''), cfg.salt)), Buffer.from(cfg.hash));
  if (!ok) { f.n++; fails[req.ip] = f; return res.status(401).json({ erro: 'Usuário ou senha incorretos.' }); }
  delete fails[req.ip]; setSession(res); res.json({ ok: true });
});

app.post('/api/logout', (_, res) => { res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });

// ---------- setores ----------
app.get('/api/setores', auth, (_, res) => res.json(db.prepare(
  `SELECT s.*, (SELECT COUNT(*) FROM maquinas m WHERE m.setor_id = s.id) AS total FROM setores s ORDER BY s.nome COLLATE NOCASE`).all()));

const nomeSetor = req => String(req.body.nome || '').trim();
app.post('/api/setores', auth, (req, res) => {
  if (!nomeSetor(req)) return res.status(400).json({ erro: 'Informe o nome do setor.' });
  try { res.json({ id: db.prepare('INSERT INTO setores (nome) VALUES (?)').run(nomeSetor(req)).lastInsertRowid }); }
  catch { res.status(409).json({ erro: 'Já existe um setor com esse nome.' }); }
});
app.put('/api/setores/:id', auth, (req, res) => {
  if (!nomeSetor(req)) return res.status(400).json({ erro: 'Informe o nome do setor.' });
  try { db.prepare('UPDATE setores SET nome = ? WHERE id = ?').run(nomeSetor(req), req.params.id); res.json({ ok: true }); }
  catch { res.status(409).json({ erro: 'Já existe um setor com esse nome.' }); }
});
app.delete('/api/setores/:id', auth, (req, res) => {
  try { db.prepare('DELETE FROM setores WHERE id = ?').run(req.params.id); res.json({ ok: true }); }
  catch { res.status(409).json({ erro: 'Este setor ainda tem máquinas ou impressoras. Mova ou exclua esses itens primeiro.' }); }
});

// ---------- máquinas ----------
const F = ['setor_id', 'nome', 'referencia', 'anydesk_id', 'hostname', 'ip', 'obs', 'impressora_id'];
const limpar = b => {
  const d = Object.fromEntries(F.map(k => [k, String(b[k] ?? '').trim()]));
  d.setor_id = Number(d.setor_id); d.anydesk_id = d.anydesk_id.replace(/\D/g, ''); d.impressora_id = Number(d.impressora_id) || null; return d;
};
const valida = d => !d.setor_id ? 'Escolha o setor.' : !d.nome ? 'Informe o nome do PC (ex.: PC1).' : null;

app.get('/api/maquinas', auth, (_, res) => res.json(db.prepare(
  `SELECT m.*, s.nome AS setor_nome, i.nome AS impressora_nome FROM maquinas m JOIN setores s ON s.id = m.setor_id LEFT JOIN impressoras i ON i.id = m.impressora_id`).all()));
app.post('/api/maquinas', auth, (req, res) => {
  const d = limpar(req.body), e = valida(d); if (e) return res.status(400).json({ erro: e });
  res.json({ id: db.prepare(`INSERT INTO maquinas (${F}) VALUES (${F.map(k => '@' + k)})`).run(d).lastInsertRowid });
});
app.put('/api/maquinas/:id', auth, (req, res) => {
  const d = limpar(req.body), e = valida(d); if (e) return res.status(400).json({ erro: e });
  db.prepare(`UPDATE maquinas SET ${F.map(k => `${k}=@${k}`)}, atualizado_em=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...d, id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/maquinas/:id', auth, (req, res) => { db.prepare('DELETE FROM maquinas WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------- impressoras ----------
const PF = ['setor_id', 'nome', 'modelo', 'ip', 'referencia', 'obs'];
const limparI = b => { const d = Object.fromEntries(PF.map(k => [k, String(b[k] ?? '').trim()])); d.setor_id = Number(d.setor_id); return d; };
const validaI = d => !d.setor_id ? 'Escolha o setor.' : !d.nome ? 'Informe o nome da impressora.' : null;
app.get('/api/impressoras', auth, (_, res) => res.json(db.prepare(
  `SELECT i.*, s.nome AS setor_nome FROM impressoras i JOIN setores s ON s.id = i.setor_id`).all()));
app.post('/api/impressoras', auth, (req, res) => {
  const d = limparI(req.body), e = validaI(d); if (e) return res.status(400).json({ erro: e });
  res.json({ id: db.prepare(`INSERT INTO impressoras (${PF}) VALUES (${PF.map(k => '@' + k)})`).run(d).lastInsertRowid });
});
app.put('/api/impressoras/:id', auth, (req, res) => {
  const d = limparI(req.body), e = validaI(d); if (e) return res.status(400).json({ erro: e });
  db.prepare(`UPDATE impressoras SET ${PF.map(k => `${k}=@${k}`)} WHERE id=@id`).run({ ...d, id: req.params.id });
  res.json({ ok: true });
});
app.delete('/api/impressoras/:id', auth, (req, res) => { db.prepare('DELETE FROM impressoras WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------- backup ----------
const backupDir = () => cfg.backupDir || path.join(DATA, 'backups');
async function fazerBackup() {
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `mapa-${new Date().toISOString().slice(0, 10)}.db`);
  fs.rmSync(arquivo, { force: true });
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  fs.readdirSync(dir).filter(f => /^mapa-.*\.db$/.test(f)).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(dir, f)));
  cfg.ultimoBackup = { em: new Date().toISOString(), arquivo }; saveCfg(); return cfg.ultimoBackup;
}
const backupInfo = () => ({ dir: backupDir(), padrao: !cfg.backupDir, ultimo: cfg.ultimoBackup || null });
app.get('/api/backup', auth, (_, res) => res.json(backupInfo()));
app.put('/api/backup', auth, (req, res) => {
  const dir = String(req.body.dir || '').trim();
  try {
    if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); cfg.backupDir = dir; } else delete cfg.backupDir;
    saveCfg(); res.json(backupInfo());
  } catch { res.status(400).json({ erro: 'Não foi possível usar essa pasta. Confira o caminho e a permissão de escrita.' }); }
});
app.post('/api/backup/agora', auth, async (_, res) => {
  try { await fazerBackup(); res.json(backupInfo()); } catch (e) { res.status(500).json({ erro: 'Falha ao gravar o backup: ' + e.message }); }
});
const backupDiario = () => { if (cfg.ultimoBackup?.em.slice(0, 10) !== new Date().toISOString().slice(0, 10)) fazerBackup().catch(console.error); };
backupDiario(); setInterval(backupDiario, 3600e3);

app.listen(PORT, () => console.log(`Mapa AnyDesk em http://localhost:${PORT}`));
/* Rack Space — data-centre idle tycoon.
   One screen of telemetry. Cores make money, cores make heat, heat needs cooling,
   cooling eats power, the PSU caps everything. Upgrade the wrong thing and the rack shuts down. */
'use strict';

const VERSION = '0.1.2';
const SAVE_KEY = 'rack-space-v1';
const TICK = 200;                 // ms
const AMBIENT = 35;               // °C
const TEMP_THROTTLE = 85;         // °C where the rack starts to slow
const TEMP_SHUTDOWN = 108;        // °C where it trips
const SHUTDOWN_MS = 9000;

const BAL = {
  tokPerCompute: 75,              // tokens/s per core·GHz
  rateBase: 0.02,                 // $ per token at billing ×1
  heatPerCompute: 3.2,            // heat units/s per core·GHz
  coolPerUnit: 8,                 // heat units/s removed per cooling unit
  ambientCool: 2,
  tempPerHeat: 0.35,              // °C per heat unit
  powerPerCore: 34,
  powerPerClock: 30,              // × clock^1.5
  powerPerCool: 26,
  prestigeAt: 20000,              // lifetime $ for first migration
  prestigeBoost: 0.30,
};

const UPGRADES = [
  { id:'core',  ico:'▣', name:'Add Core',        desc:'+1 core · more compute, more heat', base:22,  mult:1.24 },
  { id:'clock', ico:'◷', name:'Raise Clock',     desc:'+0.15 GHz · +power draw',           base:20,  mult:1.24 },
  { id:'psu',   ico:'⚡', name:'Bigger PSU',      desc:'+200 W headroom',                   base:45,  mult:1.30 },
  { id:'cool',  ico:'❄', name:'Add Fan',         desc:'+1 cooling · removes heat',         base:30,  mult:1.35 },
  { id:'bill',  ico:'$', name:'Billing Plan',    desc:'+10% rate per token',               base:120, mult:1.70 },
];

let S = blank();
let lastSig = '';

function blank(){
  return {
    v:1, cash:0, lifetime:0, gen:1,
    cores:1, clockLvl:0, psuLvl:0, coolLvl:0, billLvl:0,
    temp:AMBIENT, shutdownUntil:0, limpUntil:0, lastSeen:Date.now(),
  };
}

/* ---------- derived ---------- */
const clockGHz = () => 1 + S.clockLvl * 0.15;
const psuW      = () => 300 + S.psuLvl * 200;
const coolU     = () => 1 + S.coolLvl;
const billMult  = () => 1 + S.billLvl * 0.10;
const compute   = () => S.cores * clockGHz();
const genMult   = () => 1 + (S.gen - 1) * BAL.prestigeBoost;
const ratePerTok = () => BAL.rateBase * billMult();

const powerDraw = () => S.cores*BAL.powerPerCore + Math.pow(clockGHz(),1.5)*BAL.powerPerClock + coolU()*BAL.powerPerCool;
const heatGen   = () => compute() * BAL.heatPerCompute;
const heatOut   = () => coolU() * BAL.coolPerUnit + BAL.ambientCool;

function efficiency(){
  const now = Date.now();
  if (now < S.shutdownUntil) return 0;
  const pwr = Math.min(1, psuW() / Math.max(powerDraw(), 1));
  let tmp = 1;
  if (S.temp > TEMP_THROTTLE) tmp = Math.max(0.25, 1 - (S.temp - TEMP_THROTTLE) / 30);
  return pwr * tmp;
}
const tokensPerSec = () => compute() * BAL.tokPerCompute * genMult() * efficiency();
const incomePerSec = () => tokensPerSec() * ratePerTok();

/* ---------- upgrades ---------- */
function costOf(u){
  const lvl = { core:S.cores-1, clock:S.clockLvl, psu:S.psuLvl, cool:S.coolLvl, bill:S.billLvl }[u.id];
  return Math.round(u.base * Math.pow(u.mult, Math.max(0, lvl)));
}
function buy(id){
  const u = UPGRADES.find(x => x.id === id);
  if (!u) return;
  const c = costOf(u);
  if (S.cash < c) return;
  S.cash -= c;
  if (id === 'core')  S.cores++;
  if (id === 'clock') S.clockLvl++;
  if (id === 'psu')   S.psuLvl++;
  if (id === 'cool')  S.coolLvl++;
  if (id === 'bill')  S.billLvl++;
  render(true);
  save();
}

/* ---------- loop ---------- */
function step(dt){
  const now = Date.now();

  // heat model
  const limp = now < (S.limpUntil || 0) ? 0.45 : 1;   // shed heat while recovering
  const net = heatGen() * limp - heatOut();
  S.temp += net * BAL.tempPerHeat * dt;
  if (S.temp < AMBIENT) S.temp = AMBIENT;
  if (S.temp > 115) S.temp = 115;

  // trip the breaker
  if (S.temp >= TEMP_SHUTDOWN && now >= S.shutdownUntil) {
    S.shutdownUntil = now + SHUTDOWN_MS;
    S.limpUntil = now + SHUTDOWN_MS + 10000;   // thermal protection after a trip
    S.temp = 62;
  }

  const inc = incomePerSec() * dt;
  S.cash += inc;
  S.lifetime += inc;
}

/* ---------- render ---------- */
const $ = id => document.getElementById(id);
const fmt = n => {
  if (n < 1000) return n.toFixed(2);
  const u = ['','K','M','B','T','Qa'];
  let i = 0;
  while (n >= 1000 && i < u.length-1) { n /= 1000; i++; }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i];
};
const money = n => '$' + fmt(n);

function renderChips(){
  const box = $('chips');
  const SLOTS = 24;                       // rack always shows the empty bays
  if (box.childElementCount !== SLOTS) {
    box.innerHTML = '';
    for (let i = 0; i < SLOTS; i++) box.appendChild(document.createElement('div'));
  }
  const hot = S.temp > TEMP_THROTTLE;
  [...box.children].forEach((c, i) => {
    const owned = i < Math.min(S.cores, SLOTS);
    c.className = 'chip' + (owned ? ' on' : '') + (owned && hot ? ' hot' : '');
  });
  const fans = $('fans');
  const nf = Math.min(coolU(), 6);
  if (fans.childElementCount !== nf) {
    fans.innerHTML = '';
    for (let i = 0; i < nf; i++) {
      const f = document.createElement('div');
      f.className = 'fan on';
      fans.appendChild(f);
    }
  }
}

function renderShop(){
  const box = $('shop');
  box.innerHTML = UPGRADES.map(u => {
    const c = costOf(u);
    const can = S.cash >= c;
    const extra = u.id === 'core' ? ` → ${S.cores+1} cores`
                : u.id === 'clock' ? ` → ${(clockGHz()+0.15).toFixed(2)} GHz`
                : u.id === 'psu' ? ` → ${(psuW()+200).toFixed(0)} W`
                : u.id === 'cool' ? ` → ${coolU()+1} cooling`
                : ` → ${Math.round(billMult()*100+10)}% rate`;
    return `<button class="buy ${can?'can':'cant'}" data-buy="${u.id}">
      <span class="ico">${u.ico}</span>
      <span class="txt"><span class="n">${u.name}</span>
        <span class="d">${u.desc}${extra}</span></span>
      <span class="p">${money(c)}</span>
    </button>`;
  }).join('');
}

function renderPrestige(){
  const box = $('prestigeBox');
  if (S.lifetime < BAL.prestigeAt) { box.hidden = true; return; }
  box.hidden = false;
  $('pGen').textContent = S.gen + 1;
  $('pGain').textContent = '+' + Math.round(BAL.prestigeBoost*100) + '%';
}

function render(force){
  const eff = efficiency();
  $('cash').textContent = money(S.cash);
  $('rate').textContent = money(incomePerSec());
  $('toks').textContent = fmt(tokensPerSec());
  $('genChip').textContent = 'GEN ' + S.gen;

  $('tempLbl').textContent = Math.round(S.temp) + '°C';
  $('tempLbl').style.color = S.temp > TEMP_THROTTLE ? '#ff7a45' : 'var(--cyan)';

  const pwrPct = Math.min(100, (powerDraw()/psuW())*100);
  $('pwrFill').style.width = pwrPct + '%';
  $('pwrFill').style.background = pwrPct > 95 ? 'linear-gradient(90deg,#8a2b2b,#ff5a5a)' : '';
  $('pwrLbl').textContent = Math.round(powerDraw()) + ' / ' + psuW() + ' W';

  const heatPct = Math.min(100, Math.max(0, ((S.temp - AMBIENT) / (TEMP_SHUTDOWN - AMBIENT)) * 100));
  $('heatFill').style.width = heatPct + '%';
  $('heatLbl').textContent = 'HEAT ' + Math.round(heatPct) + '%';

  $('sCores').textContent = S.cores;
  $('sClock').textContent = clockGHz().toFixed(2);
  $('sPsu').textContent = psuW();
  $('sCool').textContent = coolU();
  $('sBill').textContent = '$' + ratePerTok().toFixed(3);
  $('sEff').textContent = Math.round(eff*100) + '%';

  const down = Date.now() < S.shutdownUntil;
  const st = $('status');
  if (down) {
    st.hidden = false;
    $('statusText').textContent = 'SHUTDOWN · ' + Math.ceil((S.shutdownUntil - Date.now())/1000) + 's';
  } else if (eff < 0.995) {
    st.hidden = false;
    $('statusText').textContent = powerDraw() > psuW() ? 'PSU OVERLOAD' : 'THROTTLING · ' + Math.round(eff*100) + '%';
  } else st.hidden = true;

  renderChips();
  renderPrestige();

  const sig = [S.cash>0?Math.floor(S.cash):0, S.cores, S.clockLvl, S.psuLvl, S.coolLvl, S.billLvl, Math.round(S.temp)].join('|');
  if (force || sig !== lastSig) { lastSig = sig; renderShop(); }
}

/* ---------- persistence ---------- */
function save(){ S.lastSeen = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
function load(){
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return false;
    S = Object.assign(blank(), d);
    return true;
  } catch(e){ return false; }
}

function offline(){
  const gap = Math.max(0, (Date.now() - (S.lastSeen || Date.now())) / 1000);
  if (gap < 30) return;
  const cap = 4 * 3600;
  const secs = Math.min(gap, cap);
  // offline runs at 50% and ignores heat (the rack idled on light load)
  const gain = compute() * BAL.tokPerCompute * genMult() * ratePerTok() * secs * 0.5;
  if (gain > 0) {
    S.cash += gain; S.lifetime += gain;
    toast(`Away ${(secs/60).toFixed(0)} min · +${money(gain)}`);
  }
}

let toastEl = null;
function toast(msg){
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);' +
      'background:#13202c;border:1px solid #2b6b62;color:#dbe7f5;padding:10px 14px;border-radius:9px;' +
      'font:700 11px/1.3 ui-monospace,Menlo,monospace;z-index:99;box-shadow:0 8px 24px #000a';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
}

/* ---------- prestige ---------- */
function prestige(){
  if (S.lifetime < BAL.prestigeAt) return;
  S.gen++;
  S.cash = 0; S.cores = 1; S.clockLvl = 0; S.psuLvl = 0; S.coolLvl = 0; S.billLvl = 0;
  S.temp = AMBIENT; S.shutdownUntil = 0;
  toast('Migrated · GEN ' + S.gen + ' · +' + Math.round(BAL.prestigeBoost*100) + '% forever');
  render(true); save();
}

/* ---------- boot ---------- */
function boot(){
  const had = load();
  if (had) offline();
  $('ver').textContent = 'Rack Space ' + VERSION;

  $('shop').addEventListener('click', e => {
    const b = e.target.closest('[data-buy]');
    if (b) buy(b.dataset.buy);
  });
  $('prestigeBtn').addEventListener('click', prestige);
  $('resetBtn').addEventListener('click', () => {
    if (confirm('Wipe this save and start over?')) {
      localStorage.removeItem(SAVE_KEY);
      S = blank(); render(true);
    }
  });

  render(true);
  if (!had) setTimeout(() => toast('Cores earn. Cores make heat. Fans fight heat. Fans eat watts.'), 700);
  setInterval(() => { step(TICK/1000); render(false); }, TICK);
  setInterval(save, 5000);
  window.addEventListener('beforeunload', save);
}

boot();

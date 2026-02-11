/* Proyéctate — Web app (vanilla JS)
   Ajustes:
   - Diseño blanco + neon (CSS)
   - Test: solo pregunta (sin progreso/etapa)
   - Antes de mostrar ocupaciones: gate obligatorio por Área principal CUOC + nivel de competencia
   - PDF: modo pdf (sin controles) y mejor paginado
*/

const JSON_FILE = "proyectate_con_cuoc_map_y_recomendador_v2.json";
// 1) Primero intentamos datos embebidos (funciona también en file://)
// 2) Si no están, intentamos cargar el JSON desde el mismo directorio (GitHub Pages / servidor local)
const JSON_URLS = [
  new URL(`${JSON_FILE}`, document.baseURI).toString(),
  new URL(`./${JSON_FILE}`, document.baseURI).toString(),
];

/** ---------- Utils ---------- **/
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

function normalize(s){
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu,"")
    .replace(/[^a-z0-9ñ\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

const STOP = new Set([
  "de","la","el","y","en","a","por","para","con","sin","del","las","los","un","una","unos","unas",
  "que","se","su","sus","al","o","u","e","como","mas","más","menos","sobre","entre","tambien","también",
  "trabajar","hacer","realizar","desarrollar","disenar","diseñar","organizar","planear","crear","usar","gestionar","administrar","apoyar"
]);

function tokenize(s){
  const t = normalize(s).split(" ").filter(w => w.length >= 3 && !STOP.has(w));
  return Array.from(new Set(t));
}

/** ---------- Beta sampling (for Monte Carlo) ---------- **/
function randn(){
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function gammaRand(shape){
  if (shape < 1){
    const u = Math.random();
    return gammaRand(shape + 1) * Math.pow(u, 1/shape);
  }
  const d = shape - 1/3;
  const c = 1 / Math.sqrt(9*d);
  while (true){
    const x = randn();
    let v = 1 + c*x;
    if (v <= 0) continue;
    v = v*v*v;
    const u = Math.random();
    if (u < 1 - 0.0331*(x*x)*(x*x)) return d*v;
    if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d*v;
  }
}
function betaRand(alpha, beta){
  const x = gammaRand(alpha);
  const y = gammaRand(beta);
  return x / (x + y);
}

/** ---------- Adaptive test engine (areas I–V) ---------- **/
function initAdaptiveSession(){
  const areas = ["I","II","III","IV","V"];
  const st = {};
  for (const a of areas){
    st[a] = { asked:0, yes:0, no:0, alpha:1, beta:1, mean:0.5 };
  }
  return { stage: 1, asked_items: [], responses: {}, areas_state: st };
}

function recordAnswerAdaptive(session, item_no, answer, item_to_area){
  if (session.responses[String(item_no)] !== undefined) return;
  const area = item_to_area[item_no];
  session.asked_items.push(item_no);
  session.responses[String(item_no)] = answer;

  const st = session.areas_state[area];
  st.asked += 1;
  if (answer === 1) st.yes += 1; else st.no += 1;

  st.alpha = 1 + st.yes;
  st.beta  = 1 + st.no;
  st.mean  = st.alpha / (st.alpha + st.beta);
}

function monteCarloTop2Areas(session, draws=2000){
  const areas = ["I","II","III","IV","V"];
  const means = areas.map(a => ({a, m: session.areas_state[a].mean})).sort((x,y)=>y.m-x.m);
  const a1 = means[0].a, a2 = means[1].a, a3 = means[2].a;

  let top2Counts = new Map();
  let p2gt3 = 0;

  for (let i=0;i<draws;i++){
    const samples = areas.map(a => ({a, p: betaRand(session.areas_state[a].alpha, session.areas_state[a].beta)}))
                         .sort((x,y)=>y.p-x.p);
    const top2 = [samples[0].a, samples[1].a].sort().join("+");
    top2Counts.set(top2, (top2Counts.get(top2) ?? 0) + 1);

    const sMap = {};
    for (const s of samples) sMap[s.a]=s.p;
    if (sMap[a2] > sMap[a3]) p2gt3++;
  }

  let bestKey = "";
  let bestVal = 0;
  for (const [k,v] of top2Counts.entries()){
    if (v > bestVal){ bestVal=v; bestKey=k; }
  }
  return {
    a1, a2, a3,
    top2_best: bestKey,
    top2_stability: bestVal/draws,
    p_area2_greater_area3: p2gt3/draws
  };
}

function nextItemAdaptive(session, adaptive_model){
  const asked = new Set(session.asked_items);

  if (session.stage === 1){
    for (const it of adaptive_model.stages[0].core_items){
      if (!asked.has(it)) return it;
    }

    const mc = monteCarloTop2Areas(session, 1500);
    if (mc.top2_stability >= 0.90 && mc.p_area2_greater_area3 >= 0.90){
      session.stage = 2;
    } else {
      const opt = adaptive_model.stages[0].optional_items_by_area;
      for (const a of ["I","II","III","IV","V"]){
        for (const it of (opt[a] ?? [])){
          if (!asked.has(it)) return it;
        }
      }
      session.stage = 2;
    }
  }

  const mc = monteCarloTop2Areas(session, 2000);
  const focus = [];
  if (mc.p_area2_greater_area3 < 0.90) focus.push(mc.a2, mc.a3);
  else focus.push(mc.a1, mc.a2);

  const seen = new Set();
  const focusU = focus.filter(a => (seen.has(a) ? false : (seen.add(a), true)));

  const pools = adaptive_model.stages[1].item_order_by_area;
  for (const a of focusU){
    for (const it of pools[a]){
      if (!asked.has(it)) return it;
    }
  }
  return null;
}

function shouldStopAdaptive(session, adaptive_model){
  const n = session.asked_items.length;
  const minTotal = adaptive_model.stopping_rules.min_total_questions ?? 10;
  const maxTotal = adaptive_model.stopping_rules.max_total_questions ?? 35;

  if (n < minTotal) return { stop:false, reason:"min_total_not_reached" };
  if (n >= maxTotal) return { stop:true, reason:"max_total_reached" };

  const mc = monteCarloTop2Areas(session, 2500);
  const th = adaptive_model.stopping_rules.confidence_thresholds ?? {};
  const p23 = th.p_area2_greater_area3 ?? 0.90;
  const stable = th.top2_set_stability ?? 0.90;

  if (mc.top2_stability >= stable && mc.p_area2_greater_area3 >= p23){
    return { stop:true, reason:"top2_confident", mc };
  }
  return { stop:false, reason:"not_confident_yet", mc };
}

/** ---------- CUOC recommendation v2 (light) ---------- **/
function overlapScore(userTokens, doc){
  const tokens = tokenize(doc);
  if (!tokens.length) return 0;
  let hit=0;
  for (const w of tokens) if (userTokens.has(w)) hit++;
  return hit / Math.sqrt(tokens.length);
}
function affinitySigla(userTokens, protoTokens){
  if (!protoTokens?.length) return 0;
  let hit=0;
  for (const w of protoTokens) if (userTokens.has(w)) hit++;
  return hit / Math.sqrt(protoTokens.length);
}

function buildUserSignalV2(jsonData, session){
  const itemByNo = {};
  for (const it of jsonData.items) itemByNo[it.item_no] = it;

  const itemToProfile = jsonData.recommendation_model_v2.bridge.item_to_profile;
  const yesItems = Object.entries(session.responses).filter(([,v])=>v===1).map(([k])=>Number(k));
  const userText = yesItems.map(n => itemByNo[n]?.actividad ?? "").join(" ");
  const userTokens = new Set(tokenize(userText));

  const profiles = ["A","B","C","D","E"];
  const st = {};
  for (const p of profiles) st[p] = { asked:0, yes:0, no:0, alpha:1, beta:1, mean:0.5 };

  for (const n of session.asked_items){
    const p = itemToProfile[String(n)];
    if (!p) continue;
    st[p].asked++;
    const ans = session.responses[String(n)];
    if (ans===1) st[p].yes++; else if (ans===0) st[p].no++;
    st[p].alpha = 1 + st[p].yes;
    st[p].beta  = 1 + st[p].no;
    st[p].mean  = st[p].alpha / (st[p].alpha + st[p].beta);
  }

  const ranked = profiles.map(p=>({p, mean:st[p].mean, asked:st[p].asked}))
                         .sort((x,y)=> (y.mean-x.mean) || (y.asked-x.asked));
  const top2 = [ranked[0].p, ranked[1].p];
  return { userTokens, profilePosterior: st, top2 };
}

function recommendCUOCv2(jsonData, session, opts){
  const { userTokens, profilePosterior, top2 } = buildUserSignalV2(jsonData, session);
  const cfg = jsonData.recommendation_model_v2.ranking.defaults;

  const topN = opts?.topN ?? cfg.topN;
  const perProfile = opts?.perProfile ?? cfg.perProfile;
  const maxPerSigla = opts?.maxPerSigla ?? cfg.maxPerSigla;
  const lambdaSigla = opts?.lambdaSigla ?? cfg.lambdaSigla;
  const maxCompetence = opts?.maxCompetence;
  const excludeDefaultAssignments = !!opts?.excludeDefaultAssignments;

  const siglaProto = jsonData.recommendation_model_v2.prototypes.sigla;
  const occs = jsonData.cuoc_map.occupations;

  const candidates = occs.filter(o => top2.includes(o.area_test_code));
  const scored = candidates.map(o => {
    const doc = [o.ocupacion, o.cuoc_area_principal, o.perfil, o.funciones, o.conocimientos, o.destrezas].filter(Boolean).join(" ");
    let s = overlapScore(userTokens, doc);

    const proto = (siglaProto?.[o.cuoc_area_sigla]?.top_tokens) ?? [];
    const aff = affinitySigla(userTokens, proto);
    s = s + lambdaSigla * aff;

    const p = o.area_test_code;
    s *= (0.85 + 0.30 * (profilePosterior[p]?.mean ?? 0.5));

    if (maxCompetence !== undefined && maxCompetence !== null && maxCompetence !== ""){
      if (Number(o.nivel_competencia) > Number(maxCompetence)) s *= 0.70;
    } else {
      const nc = Number(o.nivel_competencia);
      if (nc===2 || nc===3) s *= 1.05;
    }

    if (excludeDefaultAssignments){
      if ((o.justificacion_regla ?? "").toLowerCase().includes("asignación por defecto")) s *= 0.60;
    }
    return { ...o, score: s, sigla_affinity: aff };
  }).sort((a,b)=>b.score-a.score);

  // diversity global
  const topGlobal = [];
  const siglaCounts = {};
  for (const o of scored){
    const sig = o.cuoc_area_sigla;
    siglaCounts[sig] = siglaCounts[sig] ?? 0;
    if (siglaCounts[sig] >= maxPerSigla) continue;
    topGlobal.push(o);
    siglaCounts[sig] += 1;
    if (topGlobal.length >= topN) break;
  }

  // by profile diversified
  const byProfile = {A:[],B:[],C:[],D:[],E:[]};
  const siglaCountsByProfile = {A:{},B:{},C:{},D:{},E:{}};
  for (const o of scored){
    const p = o.area_test_code;
    if (!top2.includes(p)) continue;
    if (byProfile[p].length >= perProfile) continue;
    const sig = o.cuoc_area_sigla;
    siglaCountsByProfile[p][sig] = siglaCountsByProfile[p][sig] ?? 0;
    if (siglaCountsByProfile[p][sig] >= maxPerSigla) continue;
    byProfile[p].push(o);
    siglaCountsByProfile[p][sig] += 1;
  }

  return { top2_profiles: top2, profile_posterior: profilePosterior, top_recommendations: topGlobal, recommendations_by_profile: byProfile };
}

/** ---------- UI state ---------- **/
let JSONDATA = null;
let ITEMS = null;
let item_to_area = null;
let adaptive_model = null;
let areasByCode = null;
let currentSession = null;
let currentItem = null;
let currentReco = null;
let occupationsVisible = false;

// Test por bloques (sin perder adaptabilidad)
const PAGE_SIZE = 4; // óptimo por legibilidad (máx. 5)
let pageAnswered = 0;


function setTopButtonsVisible(visible){
  const b1 = $("btnDownloadPdf");
  const b2 = $("btnRestart");
  if (visible){ show(b1); show(b2); } else { hide(b1); hide(b2); }
}

async function loadJsonAuto(){
  // 0) Datos embebidos (ideal para ejecutar en file:// sin servidor)
  if (window.PROYECTATE_DATA){
    return { data: window.PROYECTATE_DATA, attempts: [{ url: "embedded:PROYECTATE_DATA", status: 200, ok: true, contentType: "application/json" }] };
  }

  // 1) Fetch por rutas relativas (GitHub Pages / servidor local)
  const attempts = [];
  for (const url of JSON_URLS){
    const u = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    try{
      const res = await fetch(u, { cache: "no-store" });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      attempts.push({ url: u, status: res.status, ok: res.ok, contentType: ct });

      if (!res.ok) continue;
      // Si GitHub devuelve HTML (404), lo detectamos antes de parsear.
      if (ct.includes("text/html")) continue;

      const data = await res.json();
      return { data, attempts };
    }catch(e){
      attempts.push({ url: u, status: "ERR", ok: false, contentType: "", error: String(e) });
    }
  }
  return { data: null, attempts };
}

function wireManualLoader(){
  $("btnLoadDemo").addEventListener("click", async () => {
    const f = $("fileInput").files?.[0];
    if (!f) return alert("Selecciona un archivo JSON.");
    try{
      const text = await f.text();
      const data = JSON.parse(text);
      boot(data);
    }catch(e){
      alert("No pude leer ese JSON. Revisa el archivo.");
    }
  });
}

function boot(data){
  JSONDATA = data;
  ITEMS = data.items;
  adaptive_model = data.adaptive_model;
  areasByCode = {};
  for (const a of data.areas) areasByCode[a.area_code] = a;

  item_to_area = {};
  for (const it of ITEMS) item_to_area[it.item_no] = it.area_code;

  hide($("loading"));
  show($("intro"));
  setTopButtonsVisible(false);

  $("btnStart").addEventListener("click", startTest);
  $("btnNextBlock").addEventListener("click", nextBlock);
  $("btnRestart").addEventListener("click", resetAll);
  $("btnDownloadPdf").addEventListener("click", downloadPdf);

  // Gate + filters
  $("btnShowOcc").addEventListener("click", () => {
    occupationsVisible = true;
    show($("occContainer"));
    renderOccupations();
  });

  $("filterSearch").addEventListener("input", () => { if (occupationsVisible) renderOccupations(); });
  $("filterAreaPrincipal").addEventListener("change", () => { if (occupationsVisible) renderOccupations(); validateGate(); });
  $("filterMaxCompetence").addEventListener("change", () => { rerunRecoAndRender(); validateGate(); });
  $("filterExcludeDefault").addEventListener("change", () => { rerunRecoAndRender(); validateGate(); });
  $("filterPerProfile").addEventListener("change", () => { rerunRecoAndRender(); validateGate(); });
  $("filterTopN").addEventListener("change", () => { rerunRecoAndRender(); validateGate(); });
}

function startTest(){
  hide($("intro"));
  show($("test"));
  setTopButtonsVisible(true);

  currentSession = initAdaptiveSession();
  pageAnswered = 0;

  $("hint").textContent = ""; // solo preguntas
  hide($("btnNextBlock"));

  renderBlock();
}

function renderBlock(){
  const block = $("qBlock");
  block.innerHTML = "";
  pageAnswered = 0;
  hide($("btnNextBlock"));

  // Llenamos progresivamente la pantalla hasta PAGE_SIZE
  appendNextQuestion();
}

function appendNextQuestion(){
  // Si ya completamos el bloque, esperamos "Siguiente"
  if (pageAnswered >= PAGE_SIZE){
    show($("btnNextBlock"));
    return;
  }

  const next = nextItemAdaptive(currentSession, adaptive_model);
  if (!next){
    finishTest("No hay más preguntas disponibles.");
    return;
  }

  // Crear card
  const it = ITEMS.find(x => x.item_no === next);
  const card = document.createElement("div");
  card.className = "qitem";
  card.dataset.itemNo = String(next);

  const row = document.createElement("div");
  row.className = "qitem__row";

  const txt = document.createElement("div");
  txt.className = "qitem__text";
  txt.textContent = it?.actividad ?? "(Pregunta no encontrada)";

  const btns = document.createElement("div");
  btns.className = "qitem__btns";

  const btnYes = document.createElement("button");
  btnYes.type = "button";
  btnYes.className = "qbtn qbtn--yes";
  btnYes.textContent = "Me interesa";

  const btnNo = document.createElement("button");
  btnNo.type = "button";
  btnNo.className = "qbtn qbtn--no";
  btnNo.textContent = "No me interesa";

  const status = document.createElement("div");
  status.className = "qitem__status muted";
  status.textContent = "";

  const lock = (choiceText) => {
    btnYes.disabled = true;
    btnNo.disabled = true;
    status.textContent = "Respondida: " + choiceText;
  };

  btnYes.addEventListener("click", () => {
    recordAnswerAdaptive(currentSession, next, 1, item_to_area);
    lock("Me interesa");
    pageAnswered++;

    const stop = shouldStopAdaptive(currentSession, adaptive_model);
    if (stop.stop){
      finishTest(stop.reason);
      return;
    }
    appendNextQuestion();
  });

  btnNo.addEventListener("click", () => {
    recordAnswerAdaptive(currentSession, next, 0, item_to_area);
    lock("No me interesa");
    pageAnswered++;

    const stop = shouldStopAdaptive(currentSession, adaptive_model);
    if (stop.stop){
      finishTest(stop.reason);
      return;
    }
    appendNextQuestion();
  });

  btns.appendChild(btnYes);
  btns.appendChild(btnNo);

  row.appendChild(txt);
  row.appendChild(btns);

  card.appendChild(row);
  card.appendChild(status);

  $("qBlock").appendChild(card);
}

function nextBlock(){
  renderBlock();
}






function top2AreasFromSession(){
  const arr = ["I","II","III","IV","V"].map(a => ({a, mean: currentSession.areas_state[a].mean, asked: currentSession.areas_state[a].asked}))
                                  .sort((x,y)=> (y.mean-x.mean) || (y.asked-x.asked));
  return [arr[0], arr[1]];
}

function finishTest(reason){
  hide($("test"));
  show($("results"));
  setTopButtonsVisible(true);

  occupationsVisible = false;
  hide($("occContainer"));
  $("gateMsg").textContent = "Selecciona los filtros obligatorios y luego pulsa “Ver ocupaciones”.";

  const top2 = top2AreasFromSession();
  if (document.getElementById("topAreas")) if (document.getElementById("topAreas")) document.getElementById("topAreas").innerHTML = "";
  for (const t of top2){
    const areaObj = areasByCode[t.a];
    const pct = Math.round(100 * t.mean);
    const div = document.createElement("div");
    div.className = "badge";
    div.textContent = `${t.a}. ${areaObj?.area ?? ""} — ${pct}/100`;
    if (document.getElementById("topAreas")) document.getElementById("topAreas").appendChild(div);
  }

  rerunRecoAndRender(true);

  $("occSummary").textContent = `Finalizó por: ${reason}. Preguntas respondidas: ${currentSession.asked_items.length}.`;
}

function validateGate(){
  const ap = $("filterAreaPrincipal").value;
  const nc = $("filterMaxCompetence").value;
  const btn = $("btnShowOcc");
  const ok = !!ap && !!nc;
  btn.disabled = !ok;
  btn.style.opacity = ok ? "1" : ".55";
  if (!ok){
    $("gateMsg").textContent = "Faltan filtros obligatorios (*).";
  } else {
    $("gateMsg").textContent = "Listo. Pulsa “Ver ocupaciones”.";
  }
}

function rerunRecoAndRender(first=false){
  if (!JSONDATA || !currentSession) return;

  const maxCompetence = $("filterMaxCompetence").value;
  const excludeDefault = $("filterExcludeDefault").checked;
  const perProfile = Number($("filterPerProfile").value);
  const topN = Number($("filterTopN").value);

  currentReco = recommendCUOCv2(JSONDATA, currentSession, {
    maxCompetence: maxCompetence === "" ? undefined : Number(maxCompetence),
    excludeDefaultAssignments: excludeDefault,
    perProfile,
    topN
  });

  // Top profiles
  $("topProfiles").innerHTML = "";
  for (const p of currentReco.top2_profiles){
    const meta = JSONDATA.recommendation_model_v2.profiles[p];
    const mean = currentReco.profile_posterior[p]?.mean ?? 0.5;
    const pct = Math.round(100*mean);
    const div = document.createElement("div");
    div.className = "badge";
    div.textContent = `${p}. ${meta?.name ?? "Perfil"} — ${pct}/100`;
    $("topProfiles").appendChild(div);
  }

  populateAreaPrincipalFilter();
  validateGate();

  if (occupationsVisible){
    renderOccupations();
  } else if (!first) {
    $("occSummary").textContent = "Ajustaste filtros. Pulsa “Ver ocupaciones” para mostrar resultados.";
  }
}

function populateAreaPrincipalFilter(){
  const sel = $("filterAreaPrincipal");
  const prev = sel.value;

  const occs = currentReco?.top_recommendations ?? [];
  const areas = Array.from(new Set(occs.map(o => o.cuoc_area_principal).filter(Boolean)))
    .sort((a,b)=>String(a).localeCompare(String(b),"es"));

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Selecciona…";
  sel.appendChild(opt0);

  for (const a of areas){
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    sel.appendChild(opt);
  }

  if (areas.includes(prev)) sel.value = prev;
}

function renderOccupations(){
  const container = $("occContainer");
  container.innerHTML = "";

  if (!currentReco) return;

  const ap = $("filterAreaPrincipal").value || "";
  const nc = $("filterMaxCompetence").value || "";
  if (!ap || !nc){
    $("occSummary").textContent = "Selecciona Área CUOC y nivel de competencia para ver ocupaciones.";
    return;
  }

  const q = normalize($("filterSearch").value || "");

  let list = currentReco.top_recommendations;

  // required filter by area principal
  list = list.filter(o => o.cuoc_area_principal === ap);

  // hard filter by competence max
  list = list.filter(o => Number(o.nivel_competencia) <= Number(nc));

  if (q){
    list = list.filter(o => {
      const hay = normalize(`${o.ocupacion} ${o.perfil} ${o.funciones} ${o.cuoc_area_principal} ${o.cuoc_area_sigla}`);
      return hay.includes(q);
    });
  }

  // group by competence level 1..4
  const groups = {1:[],2:[],3:[],4:[]};
  for (const o of list){
    const lvl = Number(o.nivel_competencia);
    if (groups[lvl]) groups[lvl].push(o);
  }

  let shown = 0;
  for (const lvl of [1,2,3,4]){
    const arr = groups[lvl];
    if (!arr.length) continue;

    const g = document.createElement("div");
    g.className = "group";

    const head = document.createElement("div");
    head.className = "group__title";
    head.innerHTML = `<div><strong>Nivel ${lvl}</strong> <span class="muted small">(ocupaciones: ${arr.length})</span></div>`;
    g.appendChild(head);

    for (const o of arr){
      g.appendChild(renderOccCard(o));
      shown++;
    }
    container.appendChild(g);
  }

  // PDF summary text (rendered only in pdf-mode)
  $("pdfSummary").innerHTML = `
    <strong>Filtros aplicados</strong><br/>
    Área CUOC: ${escapeHtml(ap)}<br/>
    Nivel máximo de competencia: ${escapeHtml(nc)}<br/>
    Top‑2 perfiles CUOC: ${escapeHtml(currentReco.top2_profiles.join(" y "))}<br/>
    Preguntas respondidas: ${escapeHtml(String(currentSession.asked_items.length))}
  `;

  $("occSummary").textContent = `Mostrando ${shown} ocupaciones para: “${ap}”, hasta nivel ${nc}.`;
}

function renderOccCard(o){
  const div = document.createElement("div");
  div.className = "cardOcc";

  const head = document.createElement("div");
  head.className = "cardOcc__head";

  const left = document.createElement("div");
  left.innerHTML = `<div class="cardOcc__title">${escapeHtml(o.ocupacion)}</div>
                    <div class="cardOcc__meta">
                      Código: <code>${escapeHtml(String(o.codigo_cuoc))}</code> · SIGLA: <strong>${escapeHtml(o.cuoc_area_sigla)}</strong> · Perfil: <strong>${escapeHtml(o.area_test_code)}</strong><br/>
                      Área CUOC: ${escapeHtml(o.cuoc_area_principal)}
                    </div>`;
  head.appendChild(left);

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = `NC ${o.nivel_competencia}`;
  head.appendChild(badge);

  div.appendChild(head);

  const details = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = "Ver detalles (perfil, funciones, conocimientos…)";
  details.appendChild(sum);

  const dl = document.createElement("dl");
  const add = (k,v) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v || "—";
    dl.appendChild(dt); dl.appendChild(dd);
  };

  add("Justificación conceptual (regla aplicada)", o.justificacion_regla);
  add("Perfil", o.perfil);
  add("Funciones", o.funciones);
  add("Conocimientos", o.conocimientos);
  add("Destrezas", o.destrezas);
  add("Ocupaciones afines", o.ocupaciones_afines);

  details.appendChild(dl);
  div.appendChild(details);
  return div;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

/** ---------- PDF ---------- **/
async function downloadPdf(){
  const reportEl = $("report");
  $("pdfSummary").classList.remove("hidden");

  // Make sure occupations are visible in PDF if user already chose them
  if (occupationsVisible) show($("occContainer"));

  document.body.classList.add("pdf-mode");

  try{
    if (window.html2pdf){
      const filename = `Reporte_Proyectate_${new Date().toISOString().slice(0,10)}.pdf`;
      const opt = {
        margin:       [10, 10, 10, 10],
        filename,
        image:        { type: "jpeg", quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak:    { mode: ["css", "legacy"] }
      };
      await window.html2pdf().set(opt).from(reportEl).save();
    } else {
      window.print();
    }
  } finally {
    document.body.classList.remove("pdf-mode");
    $("pdfSummary").classList.add("hidden");
  }
}

/** ---------- Reset ---------- **/
function resetAll(){
  show($("intro"));
  hide($("test"));
  hide($("results"));
  setTopButtonsVisible(false);

  currentSession = null;
  currentItem = null;
  currentReco = null;
  occupationsVisible = false;

  $("filterSearch").value = "";
  $("filterAreaPrincipal").innerHTML = "";
  $("filterMaxCompetence").value = "";
  $("filterExcludeDefault").checked = true;
  $("filterPerProfile").value = "20";
  $("filterTopN").value = "40";

  if ($("qBlock")) $("qBlock").innerHTML = "";
  hide($("btnNextBlock"));
  $("occContainer").innerHTML = "";
  if (document.getElementById("topAreas")) if (document.getElementById("topAreas")) document.getElementById("topAreas").innerHTML = "";
  $("topProfiles").innerHTML = "";
  $("occSummary").textContent = "";
  $("gateMsg").textContent = "";
}

/** ---------- Boot ---------- **/
(async function main(){
  wireManualLoader();

  const result = await loadJsonAuto();
  if (result.data){
    boot(result.data);
  } else {
    $("loadingMsg").textContent = "No pude cargar el JSON automáticamente.";
    const dbg = $("loadDebug");
    if (dbg){
      dbg.classList.remove("hidden");
      const lines = (result.attempts || []).map(a => `• ${a.status} — ${a.url}`).slice(0, 8);
      dbg.textContent = lines.length ? ("Intentos:\n" + lines.join("\n")) : "Sin intentos registrados.";
    }
    show($("manualLoad"));
  }
})();
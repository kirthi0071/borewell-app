/* Borewell Services Manager — Android/web app (Capacitor + Firebase) */
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/noto-sans-tamil/400.css";
import "@fontsource/noto-sans-tamil/600.css";
import "@fontsource/noto-sans-tamil/700.css";
import "./style.css";
import { TA } from "./i18n.js";
import { createFirebaseBackend, createDemoBackend, mergeJobs, cleanMobile, cleanUsername, cleanOrg } from "./backend.js";
import { isNative, openExternal, shareFile, shareText, onBackButton } from "./native.js";

/* ================= i18n ================= */
let LANG = "ta"; try { LANG = localStorage.getItem("bw-lang") || "ta"; } catch (e) {}
function t(s, v) { let r = (LANG === "ta" && TA[s] != null) ? TA[s] : s; if (v) for (const k in v) r = r.split("{" + k + "}").join(v[k]); return r; }

/* ================= constants ================= */
const SERVICE_TYPES=["New borewell drilling","Re-boring / deepening","Motor & pump installation","Motor / pump repair","Borewell flushing / cleaning","Pipe & cable replacement","Yield test","Water quality test","Ground water survey (point marking)","Other"];
const DRILL_TYPES=new Set(["New borewell drilling","Re-boring / deepening"]);
const PUMP_TYPES=new Set(["Motor & pump installation","Motor / pump repair","Pipe & cable replacement"]);
const STATUSES=["Enquiry","Quoted","Scheduled","In Progress","Completed","Cancelled"];
const OPEN=new Set(["Enquiry","Quoted","Scheduled","In Progress"]);
const CREW_ROLES=["Drilling rig","Compressor truck","Driller","Pump mechanic","Electrician","Helper","Surveyor"];
const PAY_MODES=["Cash","UPI","Bank transfer","Cheque"];
const DIAS=['4.5"','6"','7"','8"'];
const EXP_CATS=["Diesel","Crew wages","Batta / food","Drill bit / hammer","Materials purchase","Vehicle repair & maintenance","Transport","Commission","Other"];
const DEFAULT_SETTINGS={bizName:"My Borewell Services",phone:"",address:"",gstin:"",prefix:"BW",gstPct:0,upiId:"",
  slabs:[{upto:300,rate:90},{upto:400,rate:100},{upto:500,rate:120},{upto:600,rate:140},{upto:800,rate:170},{upto:1000,rate:210},{upto:1500,rate:260}],
  casingRates:{'4.5"':300,'6"':450,'7"':550,'8"':700},footer:"Thank you for your business."};

/* ================= helpers ================= */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const inr=n=>(n<0?"-":"")+"₹"+Math.round(Math.abs(num(n))).toLocaleString("en-IN");
const localISO=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const addDays=n=>localISO(new Date(Date.now()+n*864e5));
const LOC=()=>LANG==="ta"?"ta-IN":"en-IN";
const fmtDate=s=>s?new Date(s+"T00:00").toLocaleDateString(LOC(),{day:"numeric",month:"short",year:"numeric"}):"—";
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const clone=o=>JSON.parse(JSON.stringify(o));
const monthName=()=>new Date().toLocaleDateString(LOC(),{month:"long"});
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show"),2800)}

/* ================= state & backend ================= */
const state={customers:{},jobs:{},crew:{},expenses:{},users:{},settings:null,loaded:false,profile:null,raw:{jobs:{},billing:{},jobexp:{}}};
let backend=null;let bannerKey="";
const ROLE=()=>state.profile?state.profile.role:null;
const isAdmin=()=>ROLE()==="admin";
const isOffice=()=>ROLE()==="office";
const isCrew=()=>ROLE()==="crew";
const S=()=>{const s=Object.assign(clone(DEFAULT_SETTINGS),state.settings||{});s.casingRates=Object.assign(clone(DEFAULT_SETTINGS.casingRates),(state.settings||{}).casingRates||{});return s};
function setBanner(k){bannerKey=k||"";const b=$("#banner");if(b)b.innerHTML=k?`<div>${esc(t(k))}</div>`:""}

async function save(coll,id,obj){
  if(!backend||!state.profile){const er=new Error("ro");er.ro=true;throw er}
  if(coll==="jobs")backend.saveJob(Object.assign({},obj,{id}));
  else if(coll==="config"||coll==="settings")backend.saveDoc("settings","main",obj);
  else backend.saveDoc(coll,id,obj);
}
async function removeDoc(coll,id){
  if(coll==="jobs")backend.deleteJob(id);else backend.deleteDoc(coll,id);
}
function onBackendError(e){
  const c=e&&e.code||"";
  if(/permission-denied/.test(c))toast(t("You don't have permission for this."));
  else if(/resource-exhausted|quota/.test(c))toast(t("Storage full — delete old records to add new ones."));
  else toast(t("Couldn't save right now — please try again."));
}
let loadTimer=null;
function startData(){
  state.loaded=false;Object.assign(state,{customers:{},jobs:{},crew:{},expenses:{},users:{},settings:null});state.raw={jobs:{},billing:{},jobexp:{}};
  const r=ROLE();const need=new Set(["settings","crew","jobs"]);if(r!=="crew"){need.add("customers");need.add("billing")}if(r==="admin"){need.add("jobexp");need.add("expenses");need.add("users")}
  clearTimeout(loadTimer);
  loadTimer=setTimeout(()=>{if(!state.loaded){state.loaded=true;setBanner("Can't reach your saved data yet — check your connection. What's shown may be incomplete.");renderAll()}},10000);
  let fromCacheAny=false;
  backend.subscribe({
    set(name,val,fromCache){
      if(name==="settings")state.settings=val;
      else if(name==="jobs"||name==="billing"||name==="jobexp"){state.raw[name]=val;state.jobs=mergeJobs(state.raw.jobs,state.raw.billing,state.raw.jobexp)}
      else state[name]=val;
      need.delete(name);if(fromCache)fromCacheAny=true;
      if(!state.loaded&&!need.size){state.loaded=true;clearTimeout(loadTimer);renderAll();return}
      if(state.loaded){if(bannerKey.startsWith("Can't")&&!fromCache)setBanner("");render()}
    },
    error(name,e){need.delete(name);onBackendError(e);if(!state.loaded&&!need.size){state.loaded=true;renderAll()}}
  });
}

/* ================= billing ================= */
function drillBreakdown(depth,slabs){
  const out=[];const d=num(depth);if(d<=0)return out;
  const s=(slabs||[]).filter(x=>num(x.upto)>0).map(x=>({upto:num(x.upto),rate:num(x.rate)})).sort((a,b)=>a.upto-b.upto);
  let from=0;
  for(const sl of s){if(from>=d)break;const to=Math.min(d,sl.upto);if(to>from){out.push({from,to,ft:to-from,rate:sl.rate,amt:(to-from)*sl.rate});from=to}}
  if(from<d&&s.length){const r=s[s.length-1].rate;out.push({from,to:d,ft:d-from,rate:r,amt:(d-from)*r})}
  return out;
}
function calcBill(j){
  const lines=[];
  if(j.useSlab)drillBreakdown(j.depth,j.slabs).forEach(b=>lines.push({desc:t("Drilling {a}–{b} ft",{a:b.from,b:b.to}),qty:b.ft,unit:LANG==="ta"?"அடி":"ft",rate:b.rate,amt:b.amt}));
  if(num(j.casingFt)>0&&num(j.casingRate)>0)lines.push({desc:`${t("Casing pipe")} ${j.casingDia||""}`.trim(),qty:num(j.casingFt),unit:LANG==="ta"?"அடி":"ft",rate:num(j.casingRate),amt:num(j.casingFt)*num(j.casingRate)});
  (j.items||[]).forEach(it=>{const q=num(it.qty),r=num(it.rate);if((it.desc||"").trim()||q*r)lines.push({desc:it.desc||t("Item"),qty:q,unit:it.unit||"",rate:r,amt:q*r})});
  const sub=lines.reduce((a,l)=>a+l.amt,0);const disc=Math.min(num(j.discount),sub);const taxable=sub-disc;const gst=taxable*num(j.gstPct)/100;
  const total=Math.round(taxable+gst);const paid=(j.payments||[]).reduce((a,p)=>a+num(p.amount),0);
  const exp=(j.expenses||[]).reduce((a,x)=>a+num(x.amount),0);
  return{lines,sub,disc,taxable,gst,total,paid,balance:total-paid,exp,profit:total-exp};
}
const jobNo=j=>`${S().prefix||"BW"}-${String(j.no||0).padStart(4,"0")}`;
const custOf=j=>state.customers[j.customerId]||j.cust||{name:t("(deleted customer)")};
const crewNames=j=>(j.crew||[]).map(id=>state.crew[id]&&state.crew[id].name).filter(Boolean).join(", ");
const dueOf=j=>j.status==="Cancelled"?0:Math.max(0,calcBill(j).balance);
const pill=s=>`<span class="pill st-${esc(String(s).replace(/\s+/g,""))}">${esc(t(s))}</span>`;
const opt=(v,sel)=>`<option value="${esc(v)}"${v===sel?" selected":""}>${esc(t(v))}</option>`;

/* ================= routing & render ================= */
const ALL_ROUTES={admin:[["dashboard","Dashboard"],["jobs","Jobs"],["customers","Customers"],["crew","Crew & rigs"],["reminders","Reminders"],["accounts","Profit & expenses"],["team","Team & logins"],["business","Rates & business"]],
  office:[["dashboard","Dashboard"],["jobs","Jobs"],["customers","Customers"],["crew","Crew & rigs"],["reminders","Reminders"]],
  crew:[["dashboard","My jobs"]]};
const ROUTES_=()=>ALL_ROUTES[ROLE()]||[];
const route=()=>{const h=location.hash.slice(1);return ROUTES_().some(r=>r[0]===h)?h:"dashboard"};
let bizDraft=null,bizDirty=false;
const filters={status:"Open",type:"All",q:"",cq:""};
function renderChrome(){
  document.documentElement.lang=LANG;const p=state.profile;
  $("#nav").innerHTML=p?ROUTES_().map(([k,l])=>`<a href="#${k}" data-r="${k}" class="${route()===k?"on":""}">${esc(t(l))}</a>`).join(""):"";
  $("#nav").style.display=p&&ROUTES_().length>1?"":"none";
  $("#hdrNew").textContent=t("+ New job");$("#hdrNew").style.display=p&&!isCrew()?"":"none";
  $("#acctBtn").style.display=p?"":"none";if(p)$("#acctBtn").textContent="👤 "+(p.name||p.username||"");
  document.querySelectorAll("#langseg button").forEach(b=>b.classList.toggle("on",b.dataset.l===LANG));
  $("#today").textContent="· "+new Date().toLocaleDateString(LOC(),{weekday:"short",day:"numeric",month:"short"});
  $("#bizname").textContent=p?(S().bizName||"Borewell"):t("Borewell Services Manager");
  if(bannerKey)setBanner(bannerKey);
}
function render(force){
  if(!state.loaded)return;
  const r=route();
  if(r==="business"&&bizDirty&&!force)return;
  const ae=document.activeElement;const v=$("#view");
  const fid=ae&&ae.id&&v.contains(ae)?ae.id:null;let sel=null;
  try{if(fid&&ae.selectionStart!=null)sel=[ae.selectionStart,ae.selectionEnd]}catch(e){}
  v.innerHTML=isCrew()?viewMyJobs():({dashboard:viewDashboard,jobs:viewJobs,customers:viewCustomers,crew:viewCrew,reminders:viewReminders,accounts:viewAccounts,team:viewTeam,business:viewBusiness})[r]();
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("on",a.dataset.r===r));
  $("#bizname").textContent=S().bizName||"Borewell";
  if(r==="business")renderTry();
  if(fid){const el=document.getElementById(fid);if(el){el.focus();if(sel)try{el.setSelectionRange(sel[0],sel[1])}catch(e){}}}
}
window.addEventListener("hashchange",()=>{if(!state.profile)return;bizDraft=null;bizDirty=false;renderChrome();render(true);window.scrollTo(0,0)});

/* ================= views ================= */
function jobRow(j){
  const c=custOf(j);const b=calcBill(j);const late=j.date&&j.date<localISO()&&OPEN.has(j.status);
  const d=j.date?new Date(j.date+"T00:00"):null;
  const dbx=d?`<div class="datebox${late?" late":""}"><b>${d.getDate()}</b><span>${d.toLocaleDateString(LOC(),{month:"short"})}</span></div>`:`<div class="datebox"><b>–</b><span>${t("date")}</span></div>`;
  const due=dueOf(j);
  return `<div class="item" data-act="openJob" data-id="${esc(j.id)}">${dbx}
    <div class="main"><div class="t">${esc(c.name)} <span class="muted" style="font-weight:500">· ${esc(t(j.type))}</span></div>
    <div class="m">${esc(jobNo(j))}${j.village||c.village?" · "+esc(j.village||c.village):""}${crewNames(j)?" · "+esc(crewNames(j)):""}${late?` · <span class="due">${t("overdue")}</span>`:""}</div></div>
    <div class="r">${pill(j.status)}<div style="margin-top:3px">${b.total?inr(b.total):'<span class="muted">—</span>'}</div>${due&&b.total?`<div class="due">${inr(due)} ${t("due")}</div>`:(b.total&&b.balance<=0?`<div class="paid">${t("Paid")}</div>`:"")}</div></div>`;
}
function viewDashboard(){
  const jobs=Object.values(state.jobs);const td=localISO();const month=td.slice(0,7);
  const open=jobs.filter(j=>OPEN.has(j.status));
  const week=jobs.filter(j=>OPEN.has(j.status)&&j.date&&j.date>=td&&j.date<=addDays(7));
  let collected=0;jobs.forEach(j=>(j.payments||[]).forEach(p=>{if((p.date||"").startsWith(month))collected+=num(p.amount)}));
  const dues=jobs.reduce((a,j)=>a+dueOf(j),0);
  const feet=jobs.filter(j=>j.status==="Completed"&&DRILL_TYPES.has(j.type)&&(j.date||"").startsWith(month)).reduce((a,j)=>a+num(j.depth),0);
  const upcoming=open.filter(j=>j.date&&j.date<=addDays(14)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10);
  const undated=open.filter(j=>!j.date).length;
  const counts=STATUSES.map(s=>[s,jobs.filter(j=>j.status===s).length]);const maxc=Math.max(1,...counts.map(c=>c[1]));
  const follow=jobs.filter(j=>j.nextService&&j.nextService<=addDays(15)&&j.status!=="Cancelled").sort((a,b)=>a.nextService.localeCompare(b.nextService)).slice(0,8);
  const byCust={};jobs.forEach(j=>{const d=dueOf(j);if(d>0)byCust[j.customerId]=(byCust[j.customerId]||0)+d});
  const topDues=Object.entries(byCust).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const pm=monthStats(month);
  if(!jobs.length&&!Object.keys(state.customers).length){
    return `<div class="card" style="text-align:center;padding:40px 20px"><h2>${t("Welcome 👋")}</h2><p class="muted" style="max-width:560px;margin:10px auto 18px">${esc(t("Start by setting your drilling rates and business details, add your rigs and crew, then create your first job. Customers can be added right from the job form."))}</p>
      <div class="row" style="justify-content:center">${isAdmin()?`<a class="btn" href="#business">${t("Set rates")}</a><a class="btn" href="#crew">${esc(t("Add crew & rigs"))}</a><a class="btn" href="#team">${esc(t("Team & logins"))}</a>`:""}<button class="btn pri" data-act="newJob">${t("+ New job")}</button></div></div>`;
  }
  return `<div class="row"><h2>${t("Dashboard")}</h2><span class="sp"></span><span class="muted">${fmtDate(td)}</span></div>
  <div class="kpis">
    <div class="kpi"><div class="l">${t("Open jobs")}</div><div class="v">${open.length}</div><div class="s">${undated?t("{n} not scheduled yet",{n:undated}):t("all scheduled")}</div></div>
    <div class="kpi"><div class="l">${t("Next 7 days")}</div><div class="v">${week.length}</div><div class="s">${t("jobs on the calendar")}</div></div>
    <div class="kpi"><div class="l">${t("Collected in {m}",{m:monthName()})}</div><div class="v">${inr(collected)}</div><div class="s">${t("payments received")}</div></div>
    <div class="kpi"><div class="l">${t("Outstanding dues")}</div><div class="v" style="color:${dues?"var(--bad)":"inherit"}">${inr(dues)}</div><div class="s">${t("{n} customers",{n:topDues.length})}</div></div>
    ${isAdmin()?`<div class="kpi" data-act="goAccounts" style="cursor:pointer"><div class="l">${t("Profit this month")}</div><div class="v" style="color:${pm.profit>=0?"var(--ok)":"var(--bad)"}">${inr(pm.profit)}</div><div class="s">${t("billed − expenses")}</div></div>`:""}
    <div class="kpi"><div class="l">${t("Feet drilled in {m}",{m:monthName()})}</div><div class="v">${feet.toLocaleString("en-IN")}</div><div class="s">${t("completed drilling jobs")}</div></div>
  </div>
  <div class="grid2">
    <div class="card"><div class="row"><h3 style="margin:0">${esc(t("Upcoming & overdue work"))}</h3><span class="sp"></span><a href="#jobs" class="hint">${t("All jobs →")}</a></div>
      <div class="list" style="margin-top:8px">${upcoming.length?upcoming.map(jobRow).join(""):`<div class="empty">${t("Nothing scheduled in the next 14 days.")}</div>`}</div></div>
    <div class="stack">
      <div class="card"><h3>${t("Job pipeline")}</h3><div class="pipe">${counts.map(([s,c])=>`<div class="p" data-act="filterStatus" data-s="${esc(s)}"><div class="row"><span>${pill(s)}</span><b>${c}</b></div><div class="bar"><i style="width:${c/maxc*100}%"></i></div></div>`).join("")}</div></div>
      <div class="card"><h3>${t("Service follow-ups (next 15 days)")}</h3><div class="list">${follow.length?follow.map(j=>`<div class="item" data-act="openJob" data-id="${esc(j.id)}"><div class="main"><div class="t">${esc(custOf(j).name)}</div><div class="m">${esc(t(j.type))} · ${esc(jobNo(j))}</div></div><div class="r ${j.nextService<localISO()?"due":""}">${fmtDate(j.nextService)}</div></div>`).join(""):`<div class="empty" style="padding:14px">${t("No follow-ups due.")}</div>`}</div></div>
      <div class="card"><h3>${t("Highest dues")}</h3><div class="list">${topDues.length?topDues.map(([cid,amt])=>{const c=state.customers[cid]||{name:t("(deleted customer)")};return `<div class="item" data-act="openCustomer" data-id="${esc(cid)}"><div class="main"><div class="t">${esc(c.name)}</div><div class="m">${esc(c.phone||"")} ${c.village?"· "+esc(c.village):""}</div></div><div class="r due">${inr(amt)}</div></div>`}).join(""):`<div class="empty" style="padding:14px">${t("No pending dues. 🎉")}</div>`}</div></div>
    </div>
  </div>`;
}
function viewJobs(){
  const all=Object.values(state.jobs);const q=filters.q.trim().toLowerCase();
  const stOk=(j,s)=>s==="All"||(s==="Open"?OPEN.has(j.status):s==="Dues"?dueOf(j)>0:j.status===s);
  const list=all.filter(j=>stOk(j,filters.status)&&(filters.type==="All"||j.type===filters.type)&&(!q||[jobNo(j),custOf(j).name,custOf(j).phone,j.village,j.address,j.type,t(j.type),crewNames(j)].join(" ").toLowerCase().includes(q)))
    .sort((a,b)=>(b.date||"9999").localeCompare(a.date||"9999")||(b.no||0)-(a.no||0));
  const chips=["Open","All",...STATUSES,"Dues"].map(s=>`<span class="chip${filters.status===s?" on":""}" data-act="filterStatus" data-s="${esc(s)}">${esc(s==="Dues"?t("With dues"):t(s))}<span class="c">${all.filter(j=>stOk(j,s)).length}</span></span>`).join("");
  return `<div class="row"><h2>${t("Jobs")}</h2><span class="sp"></span><button class="btn pri" data-act="newJob">${t("+ New job")}</button></div>
  <div class="toolbar"><input type="search" id="q-jobs" class="search" placeholder="${esc(t("Search customer, village, job no…"))}" value="${esc(filters.q)}">
    <select id="f-type" style="max-width:280px"><option value="All">${t("All services")}</option>${SERVICE_TYPES.map(s=>opt(s,filters.type)).join("")}</select></div>
  <div class="chips" style="margin-bottom:12px">${chips}</div>
  <div class="card" style="padding:6px 14px"><div class="list">${list.length?list.map(jobRow).join(""):`<div class="empty">${t("No jobs match.")} <a href="#" data-act="newJob">${t("Create one")}</a>.</div>`}</div></div>`;
}
function viewCustomers(){
  const q=filters.cq.trim().toLowerCase();const jobs=Object.values(state.jobs);
  const list=Object.values(state.customers).filter(c=>!q||[c.name,c.phone,c.village,c.address].join(" ").toLowerCase().includes(q)).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  return `<div class="row"><h2>${t("Customers")}</h2><span class="sp"></span><button class="btn pri" data-act="newCustomer">${t("+ Add customer")}</button></div>
  <div class="toolbar"><input type="search" id="q-cust" class="search" placeholder="${esc(t("Search name, phone, village…"))}" value="${esc(filters.cq)}"><span class="muted">${t("{n} customers listed",{n:list.length})}</span></div>
  <div class="card" style="padding:6px 14px"><div class="list">${list.length?list.map(c=>{const cj=jobs.filter(j=>j.customerId===c.id);const due=cj.reduce((a,j)=>a+dueOf(j),0);
    return `<div class="item" data-act="openCustomer" data-id="${esc(c.id)}"><div class="main"><div class="t">${esc(c.name)}</div><div class="m">${esc(c.phone||t("no phone"))}${c.village?" · "+esc(c.village):""}</div></div><div class="r"><div>${t("{n} jobs",{n:cj.length})}</div>${due?`<div class="due">${inr(due)} ${t("due")}</div>`:""}</div></div>`}).join(""):`<div class="empty">${t("No customers yet.")}</div>`}</div></div>`;
}
function viewCrew(){
  const list=Object.values(state.crew).sort((a,b)=>(b.active!==false)-(a.active!==false)||(a.name||"").localeCompare(b.name||""));
  const jobs=Object.values(state.jobs);
  return `<div class="row"><h2>${esc(t("Crew & rigs"))}</h2><span class="sp"></span>${isAdmin()?`<button class="btn pri" data-act="newCrew">${t("+ Add crew / rig")}</button>`:""}</div>
  <p class="hint">${t("Add your drilling rigs, compressor trucks, drillers and pump mechanics so you can assign them to jobs.")}</p>
  <div class="card" style="padding:6px 14px"><div class="list">${list.length?list.map(m=>{const aj=jobs.filter(j=>OPEN.has(j.status)&&(j.crew||[]).includes(m.id));const nx=aj.filter(j=>j.date).sort((a,b)=>a.date.localeCompare(b.date))[0];
    return `<div class="item" data-act="openCrew" data-id="${esc(m.id)}"><div class="main"><div class="t">${esc(m.name)} ${m.active===false?`<span class="pill st-Cancelled">${t("inactive")}</span>`:""}</div><div class="m">${esc(t(m.role||""))}${m.vehicle?" · "+esc(m.vehicle):""}${m.phone?" · "+esc(m.phone):""}</div></div><div class="r"><div>${t("{n} open jobs",{n:aj.length})}</div>${nx?`<div class="hint">${t("next: {d}",{d:fmtDate(nx.date)})}</div>`:""}</div></div>`}).join(""):`<div class="empty">${t("No crew or rigs added yet.")}</div>`}</div></div>`;
}
function viewBusiness(){
  if(!bizDraft)bizDraft=S();const b=bizDraft;
  const slabRows=b.slabs.map((s,i)=>{const from=i?num(b.slabs[i-1].upto):0;return `<tr><td class="muted">${from} →</td><td><input type="number" min="0" data-bs="${i}" data-k="upto" value="${esc(s.upto)}"></td><td><input type="number" min="0" data-bs="${i}" data-k="rate" value="${esc(s.rate)}"></td><td><button class="btn sm icon" data-act="bizDelSlab" data-i="${i}" title="${t("Remove")}">✕</button></td></tr>`}).join("");
  const F=(k,l,ty="text",cls="")=>`<label class="f ${cls}"><span>${esc(t(l))}</span><input type="${ty}" data-b="${k}" value="${esc(b[k])}"></label>`;
  return `<div class="row"><h2>${esc(t("Rates & business"))}</h2><span class="sp"></span>${bizDirty?`<span class="hint">${t("Unsaved changes")}</span>`:""}<button class="btn pri" data-act="bizSave">${t("Save changes")}</button></div>
  <div class="grid2" style="margin-top:14px">
    <div class="stack">
      <div class="card"><h3>${t("Business details (shown on invoices)")}</h3><div class="fg">
        ${F("bizName","Business name","text","w2")}${F("phone","Phone","tel")}${F("gstin","GSTIN (optional)")}${F("address","Address","text","w2")}${F("upiId","UPI ID (shown in payment reminders & bills)","text","w2")}${F("prefix","Job number prefix")}${F("gstPct","Default GST %","number")}${F("footer","Invoice footer note","text","w2")}
      </div></div>
      <div class="card"><h3>${t("Casing pipe rate (₹ per ft)")}</h3><div class="fg">${DIAS.map(d=>`<label class="f"><span>${esc(t("{d} casing",{d}))}</span><input type="number" min="0" data-bc="${esc(d)}" value="${esc(b.casingRates[d]??"")}"></label>`).join("")}</div></div>
      <div class="card"><h3>${t("Backup")}</h3><p class="hint" style="margin-top:0">${t("Copy all data as JSON to keep a backup, or paste a backup to restore it.")}</p>
        <div class="row"><button class="btn" data-act="exportData">${t("Copy backup")}</button><button class="btn" data-act="importOpen">${t("Restore from backup…")}</button></div></div>
    </div>
    <div class="card"><h3>${t("Drilling rate slabs (₹ per ft)")}</h3>
      <p class="hint" style="margin-top:0">${t("Each foot is charged at the rate of the slab it falls in — e.g. a 450 ft bore pays the first slab rate for 0–300 ft, the next for 300–400 ft, and so on. Depth past the last slab uses the last rate. New jobs copy these rates, so changing them later doesn't alter old bills.")}</p>
      <table class="t"><thead><tr><th>${t("From")}</th><th>${t("Up to (ft)")}</th><th>${t("Rate ₹/ft")}</th><th></th></tr></thead><tbody>${slabRows}</tbody></table>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="bizAddSlab">${t("+ Add slab")}</button></div>
      <div class="sec"><h3>${t("Try it")}</h3><div class="row"><label class="f" style="max-width:140px"><span>${t("Depth (ft)")}</span><input type="number" id="try-depth" value="${esc(viewBusiness.tryDepth||500)}"></label><div id="try-out" style="flex:1"></div></div></div>
    </div>
  </div>`;
}
/* ----- profit & expenses ----- */
function monthStats(month){
  const jobs=Object.values(state.jobs).filter(j=>j.status!=="Cancelled");
  const mj=jobs.filter(j=>(j.date||(j.createdAt||"").slice(0,10)).startsWith(month));
  const billed=mj.reduce((a,j)=>a+calcBill(j).total,0);
  let collected=0,jobExp=0;const cats={};
  Object.values(state.jobs).forEach(j=>{(j.payments||[]).forEach(p=>{if((p.date||"").startsWith(month))collected+=num(p.amount)});
    (j.expenses||[]).forEach(x=>{if((x.date||j.date||"").startsWith(month)){jobExp+=num(x.amount);cats[x.category||"Other"]=(cats[x.category||"Other"]||0)+num(x.amount)}})});
  const gen=Object.values(state.expenses).filter(x=>(x.date||"").startsWith(month));
  const genExp=gen.reduce((a,x)=>a+num(x.amount),0);gen.forEach(x=>{cats[x.category||"Other"]=(cats[x.category||"Other"]||0)+num(x.amount)});
  const exp=jobExp+genExp;
  return{mj,billed,collected,jobExp,genExp,exp,profit:billed-exp,cash:collected-exp,cats,gen};
}
const monthLabel=m=>new Date(m+"-01T00:00").toLocaleDateString(LOC(),{month:"short",year:"numeric"});
function viewAccounts(){
  const month=filters.month||localISO().slice(0,7);const m=monthStats(month);
  const catRows=Object.entries(m.cats).sort((a,b)=>b[1]-a[1]);const maxc=Math.max(1,...catRows.map(c=>c[1]));
  const months=[];{const d=new Date(month+"-01T00:00");for(let i=5;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1);months.push(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`)}}
  const trend=months.map(mm=>[mm,monthStats(mm)]);
  const jobsRows=m.mj.sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(j=>{const b=calcBill(j);const mg=b.total?Math.round(b.profit/b.total*100):0;
    return `<tr class="item" data-act="openJob" data-id="${esc(j.id)}" style="display:table-row"><td>${esc(jobNo(j))}<div class="hint">${fmtDate(j.date)}</div></td><td>${esc(custOf(j).name)}<div class="hint">${esc(t(j.type))}</div></td><td class="n">${inr(b.total)}</td><td class="n">${b.exp?inr(b.exp):"—"}</td><td class="n" style="color:${b.profit>=0?"var(--ok)":"var(--bad)"};font-weight:600">${inr(b.profit)}</td><td class="n">${b.total?mg+"%":"—"}</td></tr>`}).join("");
  return `<div class="row"><h2>${esc(t("Profit & expenses"))}</h2><span class="sp"></span><label class="f" style="width:170px"><span>${t("Month")}</span><input type="month" id="f-month" value="${esc(month)}"></label><button class="btn pri" data-act="newExpense" style="align-self:flex-end">${t("+ Add expense")}</button></div>
  <div class="kpis">
    <div class="kpi"><div class="l">${t("Billed")}</div><div class="v">${inr(m.billed)}</div><div class="s">${t("{n} jobs this month",{n:m.mj.length})}</div></div>
    <div class="kpi"><div class="l">${t("Collected")}</div><div class="v">${inr(m.collected)}</div><div class="s">${t("payments received")}</div></div>
    <div class="kpi"><div class="l">${t("Total expenses")}</div><div class="v" style="color:var(--bad)">${inr(m.exp)}</div><div class="s">${t("job + other expenses")}</div></div>
    <div class="kpi"><div class="l">${t("Profit")}</div><div class="v" style="color:${m.profit>=0?"var(--ok)":"var(--bad)"}">${inr(m.profit)}</div><div class="s">${t("billed − expenses")}</div></div>
    <div class="kpi"><div class="l">${t("Cash in hand")}</div><div class="v">${inr(m.cash)}</div><div class="s">${t("collected − expenses")}</div></div>
  </div>
  <div class="grid2">
    <div class="stack">
      <div class="card" style="overflow-x:auto"><h3>${t("Job-wise profit")}</h3>${m.mj.length?`<table class="t"><thead><tr><th>${t("Job")}</th><th>${t("Customer")}</th><th class="n">${t("Billed")}</th><th class="n">${t("Expenses")}</th><th class="n">${t("Profit")}</th><th class="n">${t("Margin")}</th></tr></thead><tbody>${jobsRows}</tbody></table>`:`<div class="empty">${t("No jobs in this month.")}</div>`}</div>
      <div class="card"><div class="row"><h3 style="margin:0">${t("Other expenses (not tied to a job)")}</h3><span class="sp"></span><button class="btn sm" data-act="newExpense">${t("+ Add expense")}</button></div>
        <div class="list" style="margin-top:6px">${m.gen.length?m.gen.sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(x=>`<div class="item" data-act="openExpense" data-id="${esc(x.id)}"><div class="main"><div class="t">${esc(t(x.category||"Other"))}${x.desc?` <span class="muted" style="font-weight:500">· ${esc(x.desc)}</span>`:""}</div><div class="m">${fmtDate(x.date)}${x.crewId&&state.crew[x.crewId]?" · "+esc(state.crew[x.crewId].name):""}</div></div><div class="r due">${inr(x.amount)}</div></div>`).join(""):`<div class="empty" style="padding:14px">${t("No other expenses this month.")}</div>`}</div></div>
    </div>
    <div class="stack">
      <div class="card"><h3>${t("Expenses by type")}</h3><div class="pipe">${catRows.length?catRows.map(([c,v])=>`<div><div class="row" style="justify-content:space-between"><span>${esc(t(c))}</span><b>${inr(v)}</b></div><div class="bar"><i style="width:${v/maxc*100}%;background:var(--bad)"></i></div></div>`).join(""):`<div class="empty" style="padding:14px">${t("No expenses recorded.")}</div>`}</div></div>
      <div class="card"><h3>${t("Last 6 months")}</h3><table class="t"><thead><tr><th>${t("Month")}</th><th class="n">${t("Billed")}</th><th class="n">${t("Expenses")}</th><th class="n">${t("Profit")}</th></tr></thead><tbody>${trend.map(([mm,s])=>`<tr><td>${esc(monthLabel(mm))}</td><td class="n">${inr(s.billed)}</td><td class="n">${inr(s.exp)}</td><td class="n" style="color:${s.profit>=0?"var(--ok)":"var(--bad)"};font-weight:600">${inr(s.profit)}</td></tr>`).join("")}</tbody></table></div>
    </div>
  </div>`;
}
function openExpense(id){
  if(id&&!state.expenses[id])return;
  const x=id?clone(state.expenses[id]):{id:null,date:localISO(),category:"Diesel",desc:"",amount:"",crewId:""};draft=x;modalKind="expense";
  openModal(`<div class="m-h"><h2>${t("Expense")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><div class="fg">
    <label class="f"><span>${t("Date")}</span><input type="date" data-c="date" value="${esc(x.date)}"></label>
    <label class="f"><span>${t("Category")}</span><select data-c="category">${EXP_CATS.map(c=>opt(c,x.category)).join("")}</select></label>
    <label class="f"><span>${t("Amount")} ₹</span><input type="number" min="0" data-c="amount" value="${esc(x.amount)}"></label>
    <label class="f"><span>${t("Rig / crew (optional)")}</span><select data-c="crewId"><option value="">${t("— None —")}</option>${Object.values(state.crew).map(m=>`<option value="${esc(m.id)}"${x.crewId===m.id?" selected":""}>${esc(m.name)}</option>`).join("")}</select></label>
    <label class="f" style="grid-column:1/-1"><span>${t("Description")}</span><input type="text" data-c="desc" value="${esc(x.desc)}" placeholder="${esc(t("Rig maintenance, office rent, salaries…"))}"></label>
  </div></div>
  <div class="m-f">${id?`<button class="btn danger" data-act="delExpense">${t("Delete")}</button>`:""}<span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="saveExpense">${t("Save")}</button></div>`,true);
}

/* ----- reminders ----- */
function reminderMsg(kind,j){
  const s=S();const c=custOf(j);const n=c.name||"";const b=s.bizName;const p=s.phone||"";
  if(kind==="job")return t("Hello {n}, from {b}: your {s} work is scheduled on {d}. Our team will come to the site. For any questions call {p}.",{n,b,s:t(j.type),d:fmtDate(j.date),p});
  if(kind==="pay"){let m=t("Hello {n}, from {b}: a balance of {a} is pending for job {j} ({s}). Kindly pay at your convenience.",{n,b,a:inr(dueOf(j)),j:jobNo(j),s:t(j.type)});if(s.upiId)m+="\n"+t("UPI: {u}",{u:s.upiId});if(p)m+="\n"+t("Call us: {p}",{p});return m+"\n"+t("Thank you!")}
  if(kind==="svc")return t("Hello {n}, from {b}: it's time for the service / check-up of your borewell and motor ({d}). Call us to book a visit: {p}.",{n,b,d:fmtDate(j.nextService),p});
  return "";
}
function crewMsg(m,jobs,date){
  return t("Work for {d}:",{d:fmtDate(date)})+"\n"+jobs.map((j,i)=>{const c=custOf(j);return `${i+1}. ${c.name} – ${j.village||c.village||""} – ${t(j.type)}${c.phone?" – "+c.phone:""}${j.location?"\n   "+j.location:""}${j.address?"\n   "+j.address:""}`}).join("\n");
}
const reminderStore={};
function remRow(key,title,sub,phone,msg,sentOn,markRef){
  reminderStore[key]=msg;const ph=waPhone(phone);
  return `<div class="item" style="cursor:default"><div class="main"><div class="t">${esc(title)}</div><div class="m" style="white-space:normal">${sub}</div>${sentOn?`<div class="paid">✓ ${t("Sent {d}",{d:fmtDate(sentOn)})}</div>`:""}</div>
    <div class="row" style="gap:6px;flex-wrap:nowrap">${ph?`<button class="btn sm pri" data-act="waSent" data-ref="${esc(markRef)}" data-url="${esc("https://wa.me/"+ph+"?text="+encodeURIComponent(msg))}">WhatsApp</button>`:`<span class="hint">${t("no phone")}</span>`}<button class="btn sm" data-act="copyRem" data-k="${esc(key)}">${t("Copy")}</button>${!sentOn&&markRef?`<button class="btn sm" data-act="markSent" data-ref="${esc(markRef)}" title="${esc(t("Mark sent"))}">✓</button>`:""}</div></div>`;
}
function viewReminders(){
  const td=localISO(),tm=addDays(1);const jobs=Object.values(state.jobs);
  const sent=(j,k)=>(j.remind||{})[k];
  const wk=jobs.filter(j=>OPEN.has(j.status)&&(j.date===td||j.date===tm)).sort((a,b)=>a.date.localeCompare(b.date));
  const pay=jobs.filter(j=>dueOf(j)>0&&(j.status==="Completed"||(j.payments||[]).length)).sort((a,b)=>dueOf(b)-dueOf(a));
  const svc=jobs.filter(j=>j.nextService&&j.nextService<=addDays(7)&&j.status!=="Cancelled").sort((a,b)=>a.nextService.localeCompare(b.nextService));
  const tmJobs=jobs.filter(j=>OPEN.has(j.status)&&j.date===tm);
  const crewList=Object.values(state.crew).map(m=>[m,tmJobs.filter(j=>(j.crew||[]).includes(m.id))]).filter(x=>x[1].length);
  const days=d=>d?Math.max(0,Math.round((new Date(td)-new Date(d))/864e5)):0;
  const sec=(title,rows)=>`<div class="card"><h3>${esc(t(title))} (${rows.length})</h3><div class="list">${rows.length?rows.join(""):`<div class="empty" style="padding:14px">${t("Nothing to send.")}</div>`}</div></div>`;
  return `<div class="row"><h2>${t("Messages to send today")}</h2></div>
  <p class="hint">${t("Tap WhatsApp — the message opens ready in Tamil; just press send. It's marked as sent so you don't send twice.")} ${t("Fully automatic sending needs a WhatsApp Business API or SMS gateway account. Ask if you want to set that up later.")}</p>
  <div class="grid2"><div class="stack">
    ${sec("Work reminders (today & tomorrow)",wk.map(j=>{const c=custOf(j);const k=sent(j,"job");return remRow("job-"+j.id,c.name,`${esc(jobNo(j))} · ${esc(t(j.type))} · <b>${j.date===td?t("today"):t("tomorrow")}</b>${c.village?" · "+esc(c.village):""}`,c.phone,reminderMsg("job",j),k&&k>=addDays(-2)?k:"",j.id+"|job")}))}
    ${sec("Payment dues",pay.map(j=>{const c=custOf(j);const k=sent(j,"pay");return remRow("pay-"+j.id,c.name,`${esc(jobNo(j))} · <span class="due">${inr(dueOf(j))} ${t("due")}</span> · ${j.date?(days(j.date)?t("{n} days ago",{n:days(j.date)}):t("today")):""}`,c.phone,reminderMsg("pay",j),k&&k>=addDays(-6)?k:"",j.id+"|pay")}))}
  </div><div class="stack">
    ${sec("Service due (next 7 days)",svc.map(j=>{const c=custOf(j);const k=sent(j,"svc");return remRow("svc-"+j.id,c.name,`${esc(jobNo(j))} · ${fmtDate(j.nextService)}`,c.phone,reminderMsg("svc",j),k&&k>=addDays(-14)?k:"",j.id+"|svc")}))}
    ${sec("Crew schedule for tomorrow",crewList.map(([m,js])=>remRow("crew-"+m.id,m.name,`${esc(t(m.role||""))} · ${t("{n} jobs",{n:js.length})}`,m.phone,crewMsg(m,js,tm),"","")))}
  </div></div>`;
}

function renderTry(){const el=$("#try-out");if(!el||!bizDraft)return;const d=num(viewBusiness.tryDepth||500);const br=drillBreakdown(d,bizDraft.slabs);el.innerHTML=`<div class="bill">${br.map(x=>`<div class="ln"><span>${x.from}–${x.to} × ${inr(x.rate)}</span><span>${inr(x.amt)}</span></div>`).join("")}<div class="ln tot"><span>${t("Drilling {d} ft",{d})}</span><span>${inr(br.reduce((a,x)=>a+x.amt,0))}</span></div></div>`}

/* ================= modal ================= */
function openModal(html,narrow){const m=$("#modal");m.innerHTML=`<div class="m${narrow?" narrow":""}">${html}</div>`;m.classList.add("open");document.body.style.overflow="hidden"}
function closeModal(){const m=$("#modal");m.classList.remove("open");m.innerHTML="";document.body.style.overflow="";draft=null;modalKind=null}
$("#modal").addEventListener("mousedown",e=>{if(e.target.id==="modal")closeModal()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#modal").classList.contains("open")){e.preventDefault();closeModal()}});
let draft=null,modalKind=null;

/* ----- job form ----- */
function newJobDraft(customerId){const s=S();return{id:null,no:null,customerId:customerId||"",type:SERVICE_TYPES[0],status:"Enquiry",date:"",crew:[],village:"",address:"",location:"",
  depth:"",casingFt:"",casingDia:'7"',casingRate:s.casingRates['7"'],waterAt:"",yield:"",motorHp:"",stages:"",pipeFt:"",cableFt:"",report:"",
  useSlab:true,slabs:clone(s.slabs),items:[],discount:"",gstPct:s.gstPct,payments:[],expenses:[],nextService:"",notes:"",_new:{name:"",phone:"",village:""}}}
function openJob(id,customerId){
  if(id&&!state.jobs[id])return;
  if(isCrew()){if(id)openCrewJob(id);return}
  draft=id?Object.assign(newJobDraft(),clone(state.jobs[id])):newJobDraft(customerId);
  if(!draft._new)draft._new={name:"",phone:"",village:""};
  if(!draft.customerId&&!id)draft.customerId=Object.keys(state.customers).length?"":"__new";
  modalKind="job";renderJobModal();
}
function renderJobModal(){
  const body=$("#modal .m-body");const st=body?body.scrollTop:0;const j=draft;const isDrill=DRILL_TYPES.has(j.type);const isPump=PUMP_TYPES.has(j.type);
  const custs=Object.values(state.customers).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const crew=Object.values(state.crew).filter(m=>m.active!==false||(j.crew||[]).includes(m.id));
  const L=(l,inner,cls="")=>`<label class="f ${cls}"><span>${esc(t(l))}</span>${inner}</label>`;
  const I=(f,ty="text",ph="")=>`<input type="${ty}" ${ty==="number"?'min="0"':""} data-f="${f}" value="${esc(j[f])}"${ph?` placeholder="${esc(t(ph))}"`:""}>`;
  const items=(j.items||[]).map((it,i)=>`<tr><td><input type="text" data-arr="items" data-i="${i}" data-k="desc" value="${esc(it.desc)}" placeholder="${esc(t("e.g. 1.5 HP submersible motor"))}"></td><td style="width:72px"><input type="number" data-arr="items" data-i="${i}" data-k="qty" value="${esc(it.qty)}"></td><td style="width:70px"><input type="text" data-arr="items" data-i="${i}" data-k="unit" value="${esc(it.unit)}"></td><td style="width:100px"><input type="number" data-arr="items" data-i="${i}" data-k="rate" value="${esc(it.rate)}"></td><td class="n" style="width:90px" id="it-amt-${i}">${inr(num(it.qty)*num(it.rate))}</td><td style="width:36px"><button class="btn sm icon" data-act="delRow" data-arr="items" data-i="${i}">✕</button></td></tr>`).join("");
  const pays=(j.payments||[]).map((p,i)=>`<tr><td style="width:150px"><input type="date" data-arr="payments" data-i="${i}" data-k="date" value="${esc(p.date)}"></td><td style="width:120px"><input type="number" data-arr="payments" data-i="${i}" data-k="amount" value="${esc(p.amount)}"></td><td style="width:150px"><select data-arr="payments" data-i="${i}" data-k="mode">${PAY_MODES.map(m=>opt(m,p.mode)).join("")}</select></td><td><input type="text" data-arr="payments" data-i="${i}" data-k="note" value="${esc(p.note)}" placeholder="${esc(t("Advance, ref no…"))}"></td><td style="width:36px"><button class="btn sm icon" data-act="delRow" data-arr="payments" data-i="${i}">✕</button></td></tr>`).join("");
  const exps=(j.expenses||[]).map((x,i)=>`<tr><td style="width:150px"><input type="date" data-arr="expenses" data-i="${i}" data-k="date" value="${esc(x.date)}"></td><td style="width:190px"><select data-arr="expenses" data-i="${i}" data-k="category">${EXP_CATS.map(c=>opt(c,x.category)).join("")}</select></td><td><input type="text" data-arr="expenses" data-i="${i}" data-k="desc" value="${esc(x.desc)}" placeholder="${esc(t("Description"))}"></td><td style="width:110px"><input type="number" min="0" data-arr="expenses" data-i="${i}" data-k="amount" value="${esc(x.amount)}"></td><td style="width:36px"><button class="btn sm icon" data-act="delRow" data-arr="expenses" data-i="${i}">✕</button></td></tr>`).join("");
  openModal(`<div class="m-h"><h2>${j.id?esc(jobNo(j)):t("New job")}</h2>${j.id?pill(j.status):""}<span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><div class="jgrid"><div>
    <div class="sec"><h3>${t("Customer")}</h3><div class="fg">
      ${L("Customer",`<select data-f="customerId" data-rr="1"><option value="">${t("— Select customer —")}</option><option value="__new"${j.customerId==="__new"?" selected":""}>${t("+ New customer")}</option>${custs.map(c=>`<option value="${esc(c.id)}"${j.customerId===c.id?" selected":""}>${esc(c.name)}${c.village?" — "+esc(c.village):""}${c.phone?" ("+esc(c.phone)+")":""}</option>`).join("")}</select>`,"w2")}
      ${j.customerId==="__new"?L("Name *",`<input type="text" data-n="name" value="${esc(j._new.name)}">`)+L("Phone",`<input type="tel" data-n="phone" value="${esc(j._new.phone)}">`)+L("Village / town",`<input type="text" data-n="village" value="${esc(j._new.village)}">`):""}
    </div></div>
    <div class="sec"><h3>${t("Service")}</h3><div class="fg">
      ${L("Service type",`<select data-f="type" data-rr="1">${SERVICE_TYPES.map(s=>opt(s,j.type)).join("")}</select>`,"w2")}
      ${L("Status",`<select data-f="status">${STATUSES.map(s=>opt(s,j.status)).join("")}</select>`)}
      ${L("Scheduled / work date",I("date","date"))}
      <label class="f" style="grid-column:1/-1"><span>${esc(t("Assigned crew & rigs"))}</span><div class="crewpick">${crew.length?crew.map(m=>`<label class="${(j.crew||[]).includes(m.id)?"on":""}"><input type="checkbox" data-crew="${esc(m.id)}"${(j.crew||[]).includes(m.id)?" checked":""}>${esc(m.name)} <span class="muted">${esc(t(m.role||""))}</span></label>`).join(""):`<span class="hint">${esc(t("No crew yet — add them under “Crew & rigs”."))}</span>`}</div></label>
    </div></div>
    <div class="sec"><h3>${t("Site")}</h3><div class="fg">
      ${L("Village / area",`<input type="text" data-f="village" value="${esc(j.village)}" placeholder="${esc((state.customers[j.customerId]||{}).village||"")}">`)}
      ${L("Site address / landmark",I("address"),"w2")}
      ${L("Map link / GPS",I("location","text","Paste Google Maps link"))}
    </div></div>
    ${isDrill?`<div class="sec"><h3>${t("Drilling report")}</h3><div class="fg">
      ${L("Total depth (ft)",I("depth","number"))}${L("Water found at (ft)",I("waterAt","text","e.g. 220, 380"))}${L("Yield",I("yield","text","e.g. 2 inch / 1500 LPH"))}
      ${L("Casing diameter",`<select data-f="casingDia" data-rr="1">${DIAS.map(d=>opt(d,j.casingDia)).join("")}</select>`)}
      ${L("Casing length (ft)",I("casingFt","number"))}${L("Casing rate ₹/ft",I("casingRate","number"))}
    </div></div>`:""}
    ${isPump||isDrill?`<div class="sec"><h3>${esc(t("Motor & pump"))}</h3><div class="fg">
      ${L("Motor HP",I("motorHp","text","e.g. 1.5 HP"))}${L("Pump stages",I("stages"))}${L("Column pipe (ft)",I("pipeFt"))}${L("Cable (ft)",I("cableFt"))}
    </div></div>`:""}
    <div class="sec"><h3>${t("Work notes")}</h3><textarea data-f="report" placeholder="${esc(t("Soil/rock layers, problems found, work done…"))}">${esc(j.report)}</textarea></div>
    <div class="sec"><h3>${t("Billing")}</h3>
      ${isDrill?`<label class="cbx"><input type="checkbox" data-f="useSlab" data-rr="1"${j.useSlab?" checked":""}> ${t("Charge drilling by depth using slab rates")}</label>${j.useSlab?`<div class="rates">${t("Rates on this job:")} ${(j.slabs||[]).map((s,i)=>`${i?num(j.slabs[i-1].upto):0}–${esc(s.upto)} ${inr(s.rate)}`).join(" · ")} <a href="#" data-act="reloadRates">${t("use current rates")}</a></div>`:""}`:""}
      <table class="t" style="margin-top:10px"><thead><tr><th>${t("Item / work")}</th><th>${t("Qty")}</th><th>${t("Unit")}</th><th>${t("Rate ₹")}</th><th class="n">${t("Amount")}</th><th></th></tr></thead><tbody>${items||`<tr><td colspan="6" class="hint">${t("No extra items. Add motors, pipes, cable, labour, transport…")}</td></tr>`}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addRow" data-arr="items">${t("+ Add item")}</button><span class="sp"></span>
        <label class="f" style="width:120px"><span>${t("Discount ₹")}</span>${I("discount","number")}</label>
        <label class="f" style="width:90px"><span>${t("GST %")}</span>${I("gstPct","number")}</label></div>
    </div>
    <div class="sec"><h3>${t("Payments received")}</h3>
      <table class="t"><tbody>${pays||`<tr><td class="hint">${t("No payments recorded.")}</td></tr>`}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addRow" data-arr="payments">${t("+ Record payment")}</button></div></div>
    ${isAdmin()?`<div class="sec"><h3>${t("Job expenses")}</h3>
      <table class="t"><tbody>${exps||`<tr><td class="hint">${t("No expenses recorded.")}</td></tr>`}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addRow" data-arr="expenses">${t("+ Add expense")}</button></div></div>`:""}
    <div class="sec"><h3>${t("Follow-up")}</h3><div class="fg">
      ${L("Next service / warranty check",I("nextService","date"))}${L("Internal notes",I("notes"),"w2")}</div></div>
  </div>
  <div class="side"><h3>${t("Bill summary")}</h3><div id="bill-summary"></div>
    <div class="row" style="margin-top:12px"><button class="btn sm pri" data-act="pdfJob">⬇ ${t("Download PDF bill")}</button><button class="btn sm" data-act="copyInvoice">${t("Copy invoice")}</button><button class="btn sm" data-act="copyUpdate">${t("Copy WhatsApp update")}</button></div>
    <div id="wa-link" style="margin-top:8px"></div></div>
  </div></div>
  <div class="m-f">${j.id&&isAdmin()?`<button class="btn danger" data-act="delJob">${t("Delete")}</button>`:""}<span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="saveJob">${j.id?t("Save job"):t("Create job")}</button></div>`);
  const nb=$("#modal .m-body");if(nb)nb.scrollTop=st;updateSummary();
}
function updateSummary(){
  const el=$("#bill-summary");if(!el||!draft)return;const b=calcBill(draft);
  el.innerHTML=`<div class="bill">${b.lines.length?b.lines.map(l=>`<div class="ln"><span>${esc(l.desc)}${l.qty?` <span class="hint">${num(l.qty).toLocaleString("en-IN")} ${esc(l.unit)} × ${inr(l.rate)}</span>`:""}</span><span>${inr(l.amt)}</span></div>`).join(""):`<div class="hint">${t("Add depth, casing or items to build the bill.")}</div>`}
    ${b.disc?`<div class="ln"><span>${t("Discount")}</span><span>-${inr(b.disc)}</span></div>`:""}
    ${b.gst?`<div class="ln"><span>GST ${num(draft.gstPct)}%</span><span>${inr(b.gst)}</span></div>`:""}
    <div class="ln tot"><span>${t("Total")}</span><span>${inr(b.total)}</span></div>
    <div class="ln"><span>${t("Paid")}</span><span>${inr(b.paid)}</span></div>
    <div class="ln bal" style="color:${b.balance>0?"var(--bad)":"var(--ok)"}"><span>${t("Balance")}</span><span>${inr(b.balance)}</span></div>
    ${b.exp&&isAdmin()?`<div class="ln" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px"><span>${t("Expenses")}</span><span>-${inr(b.exp)}</span></div><div class="ln bal" style="color:${b.profit>=0?"var(--ok)":"var(--bad)"}"><span>${t("Profit on this job")}</span><span>${inr(b.profit)}</span></div>`:""}</div>`;
  (draft.items||[]).forEach((it,i)=>{const c=document.getElementById("it-amt-"+i);if(c)c.textContent=inr(num(it.qty)*num(it.rate))});
  const c=draft.customerId==="__new"?draft._new:state.customers[draft.customerId];const ph=waPhone(c&&c.phone);
  const wl=$("#wa-link");if(wl)wl.innerHTML=ph?`<a href="#" data-act="openUrl" data-url="${esc("https://wa.me/"+ph+"?text="+encodeURIComponent(updateText(draft)))}">${t("Open WhatsApp chat with customer ↗")}</a><div class="hint">${esc(c.phone)}</div>`:"";
}
const waPhone=p=>{let d=String(p||"").replace(/\D/g,"");if(d.length===10)d="91"+d;return d.length>=11?d:""};
function invoiceText(j){
  const s=S(),b=calcBill(j);const c=j.customerId==="__new"?j._new:(state.customers[j.customerId]||{});
  const L=[s.bizName,[s.address,s.phone?("Ph: "+s.phone):""].filter(Boolean).join(" | "),s.gstin?("GSTIN: "+s.gstin):"","",
    `${t("INVOICE")} ${j.id?jobNo(j):""}   ${t("Date")}: ${fmtDate(j.date||localISO())}`,`${t("Customer:")} ${c.name||""}${c.phone?" ("+c.phone+")":""}`,`${t("Site:")} ${[j.village||c.village,j.address].filter(Boolean).join(", ")}`,`${t("Service type:")} ${t(j.type)}`];
  if(DRILL_TYPES.has(j.type)&&num(j.depth))L.push(`${t("Depth")}: ${j.depth} ${LANG==="ta"?"அடி":"ft"}${j.waterAt?" | "+t("Water at")+": "+j.waterAt:""}${j.yield?" | "+t("Yield")+": "+j.yield:""}`);
  L.push("----------------------------------------");
  b.lines.forEach(l=>L.push(`${l.desc}${l.qty?`  ${num(l.qty)} ${l.unit} x ${inr(l.rate)}`:""}  =  ${inr(l.amt)}`));
  L.push("----------------------------------------");
  if(b.disc)L.push(`${t("Discount")}: -${inr(b.disc)}`);if(b.gst)L.push(`GST ${num(j.gstPct)}%: ${inr(b.gst)}`);
  L.push(`${t("TOTAL")}: ${inr(b.total)}`,`${t("Paid")}: ${inr(b.paid)}`,`${t("BALANCE DUE")}: ${inr(Math.max(0,b.balance))}`);
  (j.payments||[]).forEach(p=>L.push(`  • ${fmtDate(p.date)} ${t(p.mode||"")} ${inr(p.amount)}${p.note?" ("+p.note+")":""}`));
  if(s.footer)L.push("",s.footer);
  return L.filter((x,i)=>x!==""||i>2).join("\n");
}
function updateText(j){
  const s=S(),b=calcBill(j);const c=j.customerId==="__new"?j._new:(state.customers[j.customerId]||{});
  let m=t("Namaste {n}, update from {b}:",{n:c.name||"",b:s.bizName})+`\n${t(j.type)}${j.id?" ("+jobNo(j)+")":""} — ${t(j.status)}.`;
  if(j.date&&OPEN.has(j.status))m+="\n"+t("Scheduled: {d}.",{d:fmtDate(j.date)});
  if(DRILL_TYPES.has(j.type)&&num(j.depth))m+="\n"+t("Depth drilled: {d} ft",{d:j.depth})+(j.waterAt?t(", water at {w} ft",{w:j.waterAt}):"")+(j.yield?t(", yield {y}",{y:j.yield}):"")+".";
  if(b.total)m+="\n"+t("Bill: {t}, paid {p}, balance {b}.",{t:inr(b.total),p:inr(b.paid),b:inr(Math.max(0,b.balance))});
  if(s.phone)m+="\n"+t("Call us: {p}",{p:s.phone});return m;
}
async function copyText(txt,label){
  try{await navigator.clipboard.writeText(txt);toast(t("{l} copied",{l:label}))}
  catch(e){const keep=draft;const kind=modalKind;
    openModal(`<div class="m-h"><h2>${esc(label)}</h2><span class="sp"></span><button class="btn sm" data-act="${keep&&kind==="job"?"backToJob":"close"}">✕</button></div><div class="m-body"><p class="hint">${t("Copying isn't allowed here — select the text below and copy it.")}</p><textarea class="copybox" readonly>${esc(txt)}</textarea></div><div class="m-f"><span class="sp"></span><button class="btn pri" data-act="${keep&&kind==="job"?"backToJob":"close"}">${t("Done")}</button></div>`,true);
    draft=keep;modalKind=kind;setTimeout(()=>{const x=$(".copybox");if(x){x.focus();x.select()}},30)}
}
const nextJobNo=()=>Math.max(0,...Object.values(state.jobs).map(x=>num(x.no)))+1;
async function saveJob(btn){
  const j=clone(draft);
  if(j.customerId==="__new"){
    if(!j._new.name.trim()){toast(t("Enter the new customer's name"));return}
    const cid=uid();const c={id:cid,name:j._new.name.trim(),phone:j._new.phone.trim(),village:j._new.village.trim(),address:"",notes:"",createdAt:new Date().toISOString()};
    btn.disabled=true;try{await save("customers",cid,c)}catch(e){btn.disabled=false;return}
    state.customers[cid]=Object.assign({},c,{id:cid});
    j.customerId=cid;draft.customerId=cid;
  }
  if(!j.customerId){toast(t("Select a customer"));return}
  delete j._new;const isNew=!j.id;
  {const c=state.customers[j.customerId]||{};j.cust={name:c.name||"",phone:c.phone||"",village:c.village||""}}
  if(isNew){j.id=uid();j.no=nextJobNo();j.createdAt=new Date().toISOString()}
  finalizeJob(j);
  btn.disabled=true;try{await save("jobs",j.id,j)}catch(e){btn.disabled=false;return}
  closeModal();toast(isNew?t("Job {n} created",{n:jobNo(j)}):t("Job saved"));
}
function finalizeJob(j){
  j.updatedAt=new Date().toISOString();
  j.items=(j.items||[]).filter(it=>(it.desc||"").trim()||num(it.qty)*num(it.rate));
  j.payments=(j.payments||[]).filter(p=>num(p.amount));
  j.expenses=(j.expenses||[]).filter(x=>num(x.amount));
  const b=calcBill(j);j.total=b.total;j.balance=b.balance;j.expTotal=b.exp;return j;
}

/* ----- customer & crew modals ----- */
function openCustomer(id){
  if(id&&!state.customers[id])return;
  const c=id?clone(state.customers[id]):{id:null,name:"",phone:"",phone2:"",village:"",address:"",notes:""};draft=c;modalKind="customer";
  const jobs=id?Object.values(state.jobs).filter(j=>j.customerId===id).sort((a,b)=>(b.date||"").localeCompare(a.date||"")):[];
  const due=jobs.reduce((a,j)=>a+dueOf(j),0);const billed=jobs.filter(j=>j.status!=="Cancelled").reduce((a,j)=>a+calcBill(j).total,0);
  const L=(k,l,ty="text",cls="")=>`<label class="f ${cls}"><span>${esc(t(l))}</span><input type="${ty}" data-c="${k}" value="${esc(c[k])}"></label>`;
  openModal(`<div class="m-h"><h2>${id?esc(c.name):t("New customer")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><div class="fg">
    ${L("name","Name *","text","w2")}${L("phone","Phone","tel")}${L("phone2","Alternate phone","tel")}${L("village","Village / town")}${L("address","Address","text","w2")}
    <label class="f" style="grid-column:1/-1"><span>${t("Notes")}</span><textarea data-c="notes">${esc(c.notes)}</textarea></label></div>
    ${id?`<div class="sec"><div class="row"><h3 style="margin:0">${t("Jobs ({n})",{n:jobs.length})}</h3><span class="sp"></span><span class="muted">${t("Billed {t}",{t:inr(billed)})} · </span><span class="${due?"due":"paid"}">${due?inr(due)+" "+t("due"):t("No dues")}</span></div>
      <div class="list" style="margin-top:6px">${jobs.length?jobs.map(jobRow).join(""):`<div class="empty">${t("No jobs yet.")}</div>`}</div></div>`:""}
  </div>
  <div class="m-f">${id&&!jobs.length&&isAdmin()?`<button class="btn danger" data-act="delCustomer">${t("Delete")}</button>`:""}${id?`<button class="btn" data-act="jobForCustomer">${t("+ New job for customer")}</button>`:""}<span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="saveCustomer">${t("Save")}</button></div>`,true);
}
function openCrew(id){
  if(!isAdmin())return;
  if(id&&!state.crew[id])return;
  const m=id?clone(state.crew[id]):{id:null,name:"",role:CREW_ROLES[0],phone:"",vehicle:"",active:true,notes:""};draft=m;modalKind="crew";
  const used=id&&Object.values(state.jobs).some(j=>(j.crew||[]).includes(id));
  openModal(`<div class="m-h"><h2>${id?esc(m.name):t("Add crew / rig")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><div class="fg">
    <label class="f w2"><span>${t("Name *")}</span><input type="text" data-c="name" value="${esc(m.name)}" placeholder="${esc(t("e.g. Rig 1 or Ramesh"))}"></label>
    <label class="f"><span>${t("Type / role")}</span><select data-c="role">${CREW_ROLES.map(r=>opt(r,m.role)).join("")}</select></label>
    <label class="f"><span>${t("Phone")}</span><input type="tel" data-c="phone" value="${esc(m.phone)}"></label>
    <label class="f"><span>${t("Vehicle / rig number")}</span><input type="text" data-c="vehicle" value="${esc(m.vehicle)}"></label>
    <label class="cbx" style="align-self:end;padding-bottom:8px"><input type="checkbox" data-c="active"${m.active!==false?" checked":""}> ${t("Active")}</label>
    <label class="f" style="grid-column:1/-1"><span>${t("Notes")}</span><input type="text" data-c="notes" value="${esc(m.notes)}"></label></div>
    ${used?`<p class="hint">${t("Assigned to jobs — mark inactive instead of deleting.")}</p>`:""}</div>
  <div class="m-f">${id&&!used?`<button class="btn danger" data-act="delCrew">${t("Delete")}</button>`:""}<span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="saveCrew">${t("Save")}</button></div>`,true);
}

/* ================= reminders: mark sent ================= */
async function markSent(ref){
  if(!ref)return;const [id,kind]=ref.split("|");const j0=state.jobs[id];if(!j0||!kind)return;
  const j=clone(j0);j.remind=Object.assign({},j.remind||{},{[kind]:localISO()});
  try{await save("jobs",j.id,j)}catch(e){}
}

/* ================= PDF bill ================= */
function invoiceHTML(j){
  const s=S(),b=calcBill(j);const c=custOf(j);const ft=LANG==="ta"?"அடி":"ft";
  const cell="padding:7px 8px;border-bottom:1px solid #e3e8ec;";
  const rows=b.lines.map((l,i)=>`<tr><td style="${cell}">${i+1}</td><td style="${cell}">${esc(l.desc)}</td><td style="${cell}text-align:right">${l.qty?num(l.qty).toLocaleString("en-IN")+" "+esc(l.unit):""}</td><td style="${cell}text-align:right">${l.qty?inr(l.rate):""}</td><td style="${cell}text-align:right">${inr(l.amt)}</td></tr>`).join("");
  const det=[];
  if(DRILL_TYPES.has(j.type)&&num(j.depth))det.push(`${t("Depth")}: <b>${esc(j.depth)} ${ft}</b>`);
  if(j.waterAt)det.push(`${t("Water found at")}: <b>${esc(j.waterAt)} ${ft}</b>`);
  if(j.yield)det.push(`${t("Yield")}: <b>${esc(j.yield)}</b>`);
  if(num(j.casingFt))det.push(`${t("Casing")}: <b>${esc(j.casingFt)} ${ft} ${esc(j.casingDia||"")}</b>`);
  if(j.motorHp)det.push(`${t("Motor HP")}: <b>${esc(j.motorHp)}</b>`);
  const tot=(l,v,strong,color)=>`<tr><td style="padding:5px 8px;color:${strong?"#14212b":"#5b6a77"};${strong?"font-weight:700;font-size:15px":""}">${l}</td><td style="padding:5px 8px;text-align:right;${strong?"font-weight:700;font-size:15px;":""}${color?"color:"+color:""}">${v}</td></tr>`;
  return `<div style="width:794px;min-height:1123px;padding:44px 48px;box-sizing:border-box;background:#fff;color:#14212b;font:13px/1.5 'Noto Sans Tamil',Inter,sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b6e8a;padding-bottom:14px">
      <div><div style="font-size:22px;font-weight:700;color:#0b6e8a">${esc(s.bizName)}</div>
        <div style="color:#5b6a77">${esc(s.address||"")}</div><div style="color:#5b6a77">${s.phone?"📞 "+esc(s.phone):""}${s.gstin?" &nbsp;·&nbsp; GSTIN: "+esc(s.gstin):""}</div></div>
      <div style="text-align:right"><div style="font-size:20px;font-weight:700;letter-spacing:1px">${t("INVOICE")}</div>
        <div>${t("Bill No.")}: <b>${esc(jobNo(j))}</b></div><div>${t("Date")}: <b>${fmtDate(j.date||localISO())}</b></div></div>
    </div>
    <div style="display:flex;gap:24px;margin:18px 0">
      <div style="flex:1;background:#f6f9fa;border-radius:8px;padding:12px 14px"><div style="color:#5b6a77;font-size:12px">${t("Bill to")}</div>
        <div style="font-weight:700;font-size:15px">${esc(c.name)}</div><div>${esc(c.phone||"")}</div><div>${esc([j.village||c.village,j.address||c.address].filter(Boolean).join(", "))}</div></div>
      <div style="flex:1;background:#f6f9fa;border-radius:8px;padding:12px 14px"><div style="color:#5b6a77;font-size:12px">${t("Work details")}</div>
        <div style="font-weight:700">${esc(t(j.type))}</div>${det.map(d=>`<div>${d}</div>`).join("")}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums">
      <thead><tr style="background:#0b6e8a;color:#fff"><th style="padding:8px;text-align:left;width:40px">${t("S.No")}</th><th style="padding:8px;text-align:left">${t("Item / work")}</th><th style="padding:8px;text-align:right">${t("Qty")}</th><th style="padding:8px;text-align:right">${t("Rate")}</th><th style="padding:8px;text-align:right">${t("Amount")}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div style="display:flex;justify-content:space-between;gap:24px;margin-top:14px">
      <div style="flex:1">${(j.payments||[]).length?`<div style="color:#5b6a77;font-size:12px;margin-bottom:4px">${t("Payments")}</div>${j.payments.map(p=>`<div>${fmtDate(p.date)} · ${esc(t(p.mode||""))} · <b>${inr(p.amount)}</b>${p.note?" · "+esc(p.note):""}</div>`).join("")}`:""}
        ${s.upiId?`<div style="margin-top:10px">UPI: <b>${esc(s.upiId)}</b></div>`:""}</div>
      <table style="width:300px;border-collapse:collapse">
        ${tot(t("Subtotal"),inr(b.sub))}${b.disc?tot(t("Discount"),"-"+inr(b.disc)):""}${b.gst?tot("GST "+num(j.gstPct)+"%",inr(b.gst)):""}
        <tr><td colspan="2" style="border-top:2px solid #14212b"></td></tr>${tot(t("TOTAL"),inr(b.total),true)}${tot(t("Paid"),inr(b.paid))}${tot(t("BALANCE DUE"),inr(Math.max(0,b.balance)),true,b.balance>0?"#b3261e":"#1d7f46")}
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:60px">
      <div style="color:#5b6a77">${esc(s.footer||"")}</div>
      <div style="text-align:center;min-width:200px"><div style="border-top:1px solid #14212b;padding-top:4px">${t("Authorised signature")}</div><div style="font-size:12px;color:#5b6a77">${esc(s.bizName)}</div></div>
    </div></div>`;
}
async function makeInvoicePdf(j){
  const [{default:html2canvas},{jsPDF}]=await Promise.all([import("html2canvas"),import("jspdf")]);
  try{await document.fonts.load("13px 'Noto Sans Tamil'","தமிழ்");await document.fonts.ready}catch(e){}
  const host=document.createElement("div");host.style.cssText="position:fixed;left:-10000px;top:0;z-index:-1";host.innerHTML=invoiceHTML(j);document.body.appendChild(host);
  try{
    const canvas=await html2canvas(host.firstElementChild,{scale:2,backgroundColor:"#ffffff",logging:false});
    const pdf=new jsPDF({unit:"pt",format:"a4",compress:true});
    const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();const pagePx=Math.ceil(canvas.width*ph/pw);
    for(let y=0,pg=0;y<canvas.height;y+=pagePx,pg++){
      if(pg&&canvas.height-y<12)break;
      const h=Math.min(pagePx,canvas.height-y);const c2=document.createElement("canvas");c2.width=canvas.width;c2.height=h;
      const cx=c2.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,c2.width,h);cx.drawImage(canvas,0,y,canvas.width,h,0,0,canvas.width,h);
      if(pg)pdf.addPage();pdf.addImage(c2.toDataURL("image/jpeg",0.92),"JPEG",0,0,pw,h*pw/canvas.width);
    }
    return pdf.output("blob");
  }finally{host.remove()}
}
async function pdfForDraft(btn){
  if(!draft||!draft.id){toast(t("Save the job first to download its bill."));return}
  const j=clone(draft);const c=custOf(j);
  const fname=`${jobNo(j)} ${(c.name||"").replace(/[\\/:*?"<>|]+/g," ").trim()}.pdf`.replace(/\s+/g,"_");
  btn.disabled=true;const old=btn.textContent;btn.textContent=t("Preparing PDF…");
  try{const blob=await makeInvoicePdf(j);await shareFile(blob,fname,jobNo(j));window.__lastPdf=blob}
  catch(e){if(!/cancel/i.test(String(e&&e.message||e)))toast(t("Couldn't create the PDF — please try again."))}
  finally{btn.disabled=false;btn.textContent=old}
}

/* ================= events ================= */
function armDelete(btn,fn){if(btn.classList.contains("arm"))fn();else{btn.classList.add("arm");btn.textContent=t("Tap again to delete");setTimeout(()=>{if(btn.isConnected){btn.classList.remove("arm");btn.textContent=t("Delete")}},3500)}}
const ACT={
  lang:a=>{LANG=a.dataset.l;try{localStorage.setItem("bw-lang",LANG)}catch(e){}renderChrome();if(state.profile)render(true);else renderAuth();if(modalKind==="job")renderJobModal();else if(modalKind==="crewjob")renderCrewJobModal();else if(modalKind)closeModal()},
  newJob:(a,e)=>{e.preventDefault();openJob(null)},
  openJob:a=>openJob(a.dataset.id),
  close:()=>closeModal(),
  backToJob:()=>{modalKind="job";renderJobModal()},
  filterStatus:a=>{filters.status=a.dataset.s;if(route()!=="jobs")location.hash="jobs";else render(true)},
  addRow:a=>{const k=a.dataset.arr;draft[k]=draft[k]||[];draft[k].push(k==="payments"?{date:localISO(),amount:"",mode:"Cash",note:""}:k==="expenses"?{date:draft.date||localISO(),category:"Diesel",desc:"",amount:""}:{desc:"",qty:1,unit:t("nos"),rate:""});renderJobModal()},
  delRow:a=>{draft[a.dataset.arr].splice(+a.dataset.i,1);renderJobModal()},
  reloadRates:(a,e)=>{e.preventDefault();draft.slabs=clone(S().slabs);renderJobModal();toast(t("Current slab rates applied"))},
  saveJob:a=>saveJob(a),
  delJob:a=>armDelete(a,async()=>{try{await removeDoc("jobs",draft.id);closeModal();toast(t("Job deleted"))}catch(e){}}),
  copyInvoice:()=>copyText(invoiceText(draft),t("Invoice")),
  copyUpdate:()=>copyText(updateText(draft),t("WhatsApp update")),
  openCustomer:a=>openCustomer(a.dataset.id),
  newCustomer:()=>openCustomer(null),
  jobForCustomer:()=>{const id=draft.id;closeModal();openJob(null,id)},
  saveCustomer:async a=>{const c=clone(draft);if(!(c.name||"").trim()){toast(t("Name is required"));return}const isNew=!c.id;if(isNew){c.id=uid();c.createdAt=new Date().toISOString()}c.name=c.name.trim();
    a.disabled=true;try{await save("customers",c.id,c);closeModal();toast(isNew?t("Customer added"):t("Customer saved"))}catch(e){a.disabled=false}},
  delCustomer:a=>armDelete(a,async()=>{try{await removeDoc("customers",draft.id);closeModal();toast(t("Customer deleted"))}catch(e){}}),
  openCrew:a=>openCrew(a.dataset.id),
  newCrew:()=>openCrew(null),
  saveCrew:async a=>{const m=clone(draft);if(!(m.name||"").trim()){toast(t("Name is required"));return}const isNew=!m.id;if(isNew)m.id=uid();m.name=m.name.trim();
    a.disabled=true;try{await save("crew",m.id,m);closeModal();toast(isNew?t("Added"):t("Saved"))}catch(e){a.disabled=false}},
  delCrew:a=>armDelete(a,async()=>{try{await removeDoc("crew",draft.id);closeModal();toast(t("Deleted"))}catch(e){}}),
  bizAddSlab:()=>{const l=bizDraft.slabs[bizDraft.slabs.length-1];bizDraft.slabs.push({upto:l?num(l.upto)+200:300,rate:l?num(l.rate)+50:100});bizDirty=true;render(true)},
  bizDelSlab:a=>{bizDraft.slabs.splice(+a.dataset.i,1);bizDirty=true;render(true)},
  bizSave:async a=>{const b=clone(bizDraft);b.slabs=b.slabs.filter(s=>num(s.upto)>0).map(s=>({upto:num(s.upto),rate:num(s.rate)})).sort((x,y)=>x.upto-y.upto);b.gstPct=num(b.gstPct);
    Object.keys(b.casingRates).forEach(k=>b.casingRates[k]=num(b.casingRates[k]));
    a.disabled=true;try{await save("config","settings",b);bizDirty=false;bizDraft=null;toast(t("Rates & details saved"));render(true)}catch(e){a.disabled=false}},
  exportData:()=>{const data={exportedAt:new Date().toISOString(),customers:state.customers,jobs:state.jobs,crew:state.crew,settings:state.settings};draft=null;modalKind=null;copyText(JSON.stringify(data,null,1),t("Backup"))},
  importOpen:()=>{openModal(`<div class="m-h"><h2>${t("Restore from backup")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div><div class="m-body"><p class="hint">${t("Paste a backup copied from this app. Records with the same ID are overwritten; nothing is deleted.")}</p><textarea class="copybox" id="imp"></textarea></div><div class="m-f"><span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="importRun">${t("Restore")}</button></div>`,true)},
  importRun:async a=>{let d;try{d=JSON.parse($("#imp").value)}catch(e){toast(t("That isn't a valid backup"));return}a.disabled=true;let n=0;
    try{for(const c of ["customers","crew","jobs"]){for(const [id,o] of Object.entries(d[c]||{})){if(o&&typeof o==="object"){await save(c,id,Object.assign({},o,{id}));n++}}}
      if(d.settings&&typeof d.settings==="object")await save("config","settings",d.settings);closeModal();toast(t("Restored {n} records",{n}))}catch(e){a.disabled=false;toast(t("Stopped after {n} records",{n}))}},
  goAccounts:()=>{location.hash="accounts"},
  newExpense:()=>openExpense(null),
  openExpense:a=>openExpense(a.dataset.id),
  saveExpense:async a=>{const x=clone(draft);x.amount=num(x.amount);if(!(x.amount>0)){toast(t("Amount is required"));return}if(!x.id){x.id=uid();x.createdAt=new Date().toISOString()}
    a.disabled=true;try{await save("expenses",x.id,x);closeModal();toast(t("Expense saved"))}catch(e){a.disabled=false}},
  delExpense:a=>armDelete(a,async()=>{try{await removeDoc("expenses",draft.id);closeModal();toast(t("Expense deleted"))}catch(e){}}),
  copyRem:a=>copyText(reminderStore[a.dataset.k]||"",t("Message")),
  markSent:a=>markSent(a.dataset.ref),
  waSent:a=>{openExternal(a.dataset.url);setTimeout(()=>markSent(a.dataset.ref),300)},
  openUrl:a=>openExternal(a.dataset.url),
  pdfJob:a=>pdfForDraft(a),
};
document.addEventListener("click",e=>{const a=e.target.closest("[data-act]");if(!a)return;const f=ACT[a.dataset.act];if(f){if(a.tagName==="A"&&!a.dataset.keep)e.preventDefault();f(a,e)}});

function onInput(e){
  const el=e.target;if(!el||!el.dataset)return;const v=el.type==="checkbox"?el.checked:el.value;
  if(el.id==="q-jobs"){filters.q=v;render(true);return}
  if(el.id==="f-type"){filters.type=v;render(true);return}
  if(el.id==="q-cust"){filters.cq=v;render(true);return}
  if(el.id==="f-month"){if(/^\d{4}-\d{2}$/.test(v)){filters.month=v;render(true)}return}
  if(el.id==="try-depth"){viewBusiness.tryDepth=v;renderTry();return}
  if(el.dataset.b!==undefined){bizDraft[el.dataset.b]=v;bizDirty=true;return}
  if(el.dataset.bc!==undefined){bizDraft.casingRates[el.dataset.bc]=v;bizDirty=true;return}
  if(el.dataset.bs!==undefined){bizDraft.slabs[+el.dataset.bs][el.dataset.k]=v;bizDirty=true;renderTry();return}
  if(!draft)return;
  if(el.dataset.c!==undefined){draft[el.dataset.c]=v;if(modalKind==="user"&&el.dataset.rr)renderUserModal();return}
  if(modalKind==="crewjob"&&el.dataset.f){draft[el.dataset.f]=v;return}
  if(modalKind!=="job")return;
  if(el.dataset.n!==undefined){draft._new[el.dataset.n]=v;updateSummary();return}
  if(el.dataset.crew!==undefined){const id=el.dataset.crew;draft.crew=(draft.crew||[]).filter(x=>x!==id);if(v)draft.crew.push(id);el.parentElement.classList.toggle("on",!!v);return}
  if(el.dataset.arr){draft[el.dataset.arr][+el.dataset.i][el.dataset.k]=v;updateSummary();return}
  if(el.dataset.f){
    const f=el.dataset.f;draft[f]=v;
    if(f==="casingDia"){const r=S().casingRates[v];if(r!=null)draft.casingRate=r}
    if(f==="type"&&DRILL_TYPES.has(v)&&!draft.id)draft.useSlab=true;
    if(el.dataset.rr){if(!onInput._busy){onInput._busy=true;setTimeout(()=>{onInput._busy=false;renderJobModal()},0)}}
    else updateSummary();
  }
}
document.addEventListener("input",onInput);
document.addEventListener("change",e=>{const el=e.target;if(el&&(el.tagName==="SELECT"||el.type==="checkbox"||el.type==="date"||el.type==="month"))onInput(e)});


/* ================= crew: my jobs ================= */
function crewJobRow(j){
  const c=custOf(j);const late=j.date&&j.date<localISO()&&OPEN.has(j.status);
  const d=j.date?new Date(j.date+"T00:00"):null;
  const dbx=d?`<div class="datebox${late?" late":""}"><b>${d.getDate()}</b><span>${d.toLocaleDateString(LOC(),{month:"short"})}</span></div>`:`<div class="datebox"><b>–</b><span>${t("date")}</span></div>`;
  return `<div class="item" data-act="openJob" data-id="${esc(j.id)}">${dbx}<div class="main"><div class="t">${esc(c.name)} <span class="muted" style="font-weight:500">· ${esc(t(j.type))}</span></div>
    <div class="m">${esc(jobNo(j))}${j.village||c.village?" · "+esc(j.village||c.village):""}${j.depth?" · "+esc(j.depth)+" "+t("ft"):""}</div></div><div class="r">${pill(j.status)}</div></div>`;
}
function viewMyJobs(){
  const jobs=Object.values(state.jobs);const td=localISO();
  const open=jobs.filter(j=>OPEN.has(j.status)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
  const today=open.filter(j=>j.date&&j.date<=td);const later=open.filter(j=>!j.date||j.date>td);
  const done=jobs.filter(j=>j.status==="Completed").sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,15);
  const sec=(title,list)=>`<div class="card" style="padding:6px 14px;margin-bottom:14px"><h3 style="margin:10px 0 2px">${esc(t(title))} (${list.length})</h3><div class="list">${list.length?list.map(crewJobRow).join(""):`<div class="empty" style="padding:14px">${t("Nothing here.")}</div>`}</div></div>`;
  const me=state.crew[state.profile.crewId];
  return `<div class="row"><h2>${t("My jobs")}</h2><span class="sp"></span><span class="muted">${me?esc(me.name):""}</span></div>
  ${state.profile.crewId?"":`<div class="card" style="margin-top:12px">${t("Your login is not linked to a crew or rig yet. Ask the admin to link it.")}</div>`}
  <div style="margin-top:14px">${sec("Today & pending",today)}${sec("Upcoming",later)}${sec("Recently completed",done)}</div>`;
}
function openCrewJob(id){draft=clone(state.jobs[id]);modalKind="crewjob";renderCrewJobModal()}
function renderCrewJobModal(){
  const j=draft;const c=custOf(j);const isDrill=DRILL_TYPES.has(j.type);
  const L=(l,inner,cls="")=>`<label class="f ${cls}"><span>${esc(t(l))}</span>${inner}</label>`;
  const I=(f,ty="text",ph="")=>`<input type="${ty}" ${ty==="number"?'min="0"':""} data-f="${f}" value="${esc(j[f])}"${ph?` placeholder="${esc(t(ph))}"`:""}>`;
  const ph=String(c.phone||"").replace(/\D/g,"");
  openModal(`<div class="m-h"><h2>${esc(jobNo(j))}</h2>${pill(j.status)}<span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body">
    <div class="card" style="background:#f7fafb">
      <div style="font-weight:700;font-size:16px">${esc(c.name)}</div>
      <div class="muted">${esc(t(j.type))} · ${fmtDate(j.date)}</div>
      <div style="margin-top:4px">${esc([j.village||c.village,j.address].filter(Boolean).join(", "))}</div>
      <div class="row" style="margin-top:10px">${ph?`<button class="btn sm" data-act="openUrl" data-url="tel:${esc(ph)}">📞 ${esc(c.phone)}</button>`:""}${j.location?`<button class="btn sm" data-act="openUrl" data-url="${esc(/^https?:/.test(j.location)?j.location:"https://maps.google.com/?q="+encodeURIComponent(j.location))}">📍 ${t("Open map")}</button>`:""}</div>
      ${crewNames(j)?`<div class="hint" style="margin-top:8px">${esc(t("Assigned crew & rigs"))}: ${esc(crewNames(j))}</div>`:""}
    </div>
    <div class="sec" style="margin-top:14px"><div class="fg">${L("Status",`<select data-f="status">${["Scheduled","In Progress","Completed"].concat(["Scheduled","In Progress","Completed"].includes(j.status)?[]:[j.status]).map(s=>opt(s,j.status)).join("")}</select>`)}</div></div>
    ${isDrill?`<div class="sec"><h3>${t("Drilling report")}</h3><div class="fg">
      ${L("Total depth (ft)",I("depth","number"))}${L("Water found at (ft)",I("waterAt","text","e.g. 220, 380"))}${L("Yield",I("yield","text","e.g. 2 inch / 1500 LPH"))}
      ${L("Casing diameter",`<select data-f="casingDia">${DIAS.map(d=>opt(d,j.casingDia)).join("")}</select>`)}${L("Casing length (ft)",I("casingFt","number"))}
    </div></div>`:""}
    <div class="sec"><h3>${esc(t("Motor & pump"))}</h3><div class="fg">
      ${L("Motor HP",I("motorHp","text","e.g. 1.5 HP"))}${L("Pump stages",I("stages"))}${L("Column pipe (ft)",I("pipeFt"))}${L("Cable (ft)",I("cableFt"))}
    </div></div>
    <div class="sec"><h3>${t("Work notes")}</h3><textarea data-f="report" placeholder="${esc(t("Soil/rock layers, problems found, work done…"))}">${esc(j.report)}</textarea>
      <div class="hint" style="margin-top:4px">${t("Tip: tap the 🎤 on your keyboard to speak in Tamil.")}</div></div>
  </div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button><button class="btn pri" data-act="saveCrewJob">${t("Save")}</button></div>`,true);
}

/* ================= admin: team & logins ================= */
const ROLE_LABEL={admin:"Admin",office:"Office staff",crew:"Crew / driver"};
function viewTeam(){
  const users=Object.values(state.users).filter(u=>!u.deleted).sort((a,b)=>(a.role||"").localeCompare(b.role||"")||(a.name||"").localeCompare(b.name||""));
  return `<div class="row"><h2>${esc(t("Team & logins"))}</h2><span class="sp"></span><button class="btn pri" data-act="newUser">${t("+ Add login")}</button></div>
  <div class="card" style="margin:14px 0"><div class="row"><div><div class="hint">${t("Organization code")}</div><div style="font-size:24px;font-weight:700;letter-spacing:3px">${esc(state.profile.orgId)}</div></div><span class="sp"></span>
    <div class="hint" style="max-width:520px">${t("Staff log in with this organization code, their username and password. They only see this organization's data.")}</div></div></div>
  <div class="card" style="margin-bottom:14px"><h3>${t("What each role can see")}</h3>
    <div class="hint"><b>${t("Admin")}</b> — ${t("everything: profit, expenses, rates, settings, logins.")}<br><b>${t("Office staff")}</b> — ${t("jobs, customers, bills, payments, reminders. No profit, expenses, rates or settings.")}<br><b>${t("Crew / driver")}</b> — ${t("only jobs assigned to their crew/rig; can update depth, water, casing, motor and work notes. No money.")}</div></div>
  <div class="card" style="padding:6px 14px"><div class="list">${users.map(u=>`<div class="item" data-act="openUser" data-id="${esc(u.id)}"><div class="main"><div class="t">${esc(u.name||"")} ${u.active===false?`<span class="pill st-Cancelled">${t("Disabled")}</span>`:""}</div>
    <div class="m">${esc(t(ROLE_LABEL[u.role]||u.role))} · ${u.role==="admin"&&u.mobile?esc(u.mobile):esc(u.username||"")}${u.crewId&&state.crew[u.crewId]?" · "+esc(state.crew[u.crewId].name):""}</div></div></div>`).join("")}</div></div>`;
}
function openUserModal(id){
  draft=id?Object.assign(clone(state.users[id]),{id}):{id:null,name:"",username:"",password:genPassword(),role:"office",crewId:"",active:true};
  modalKind="user";renderUserModal();
}
function renderUserModal(){
  const u=draft;const id=u.id;
  const isSelf=id&&id===state.profile.uid;
  const crewOpts=`<option value="">${t("+ Create a new crew entry with this name")}</option>`+Object.values(state.crew).map(m=>`<option value="${esc(m.id)}"${u.crewId===m.id?" selected":""}>${esc(m.name)} (${esc(t(m.role||""))})</option>`).join("");
  openModal(`<div class="m-h"><h2>${id?esc(u.name):t("Add login")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><div class="fg">
    <label class="f w2"><span>${t("Name *")}</span><input type="text" data-c="name" value="${esc(u.name)}"></label>
    ${id?`<label class="f"><span>${t("Username")}</span><input type="text" value="${esc(u.username||u.mobile||"")}" disabled></label>`:`<label class="f"><span>${t("Username *")}</span><input type="text" data-c="username" value="${esc(u.username)}" placeholder="ramesh" autocapitalize="none"></label>
    <label class="f"><span>${t("Password *")}</span><input type="text" data-c="password" value="${esc(u.password)}"></label>`}
    ${isSelf?"":`<label class="f"><span>${t("Role")}</span><select data-c="role" data-rr="1">${["office","crew","admin"].map(r=>`<option value="${r}"${u.role===r?" selected":""}>${esc(t(ROLE_LABEL[r]))}</option>`).join("")}</select></label>`}
    ${u.role==="crew"?`<label class="f w2"><span>${t("Linked crew / rig")}</span><select data-c="crewId">${crewOpts}</select></label>`:""}
    ${id&&!isSelf?`<label class="cbx" style="align-self:end;padding-bottom:8px"><input type="checkbox" data-c="active"${u.active!==false?" checked":""}> ${t("Login enabled")}</label>`:""}
  </div>
  ${id?`<p class="hint" style="margin-top:12px">${t("Forgot password? Disable this login and create a new one with a new username.")}</p>`:`<p class="hint" style="margin-top:12px">${t("After saving, share the login details with the staff member. They can change the password later from their account menu.")}</p>`}
  </div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="close">${t("Cancel")}</button>${isSelf?"":`<button class="btn pri" data-act="saveUser">${t("Save")}</button>`}</div>`,true);
}
function genPassword(){const a="abcdefghjkmnpqrstuvwxyz23456789";return Array.from({length:8},()=>a[Math.floor(Math.random()*a.length)]).join("")}
function loginShareText(u){
  return t("Login for {b} app",{b:S().bizName})+"\n"+t("Organization code")+": "+state.profile.orgId+"\n"+t("Username")+": "+u.username+"\n"+t("Password")+": "+u.password+"\n"+t("Open the app → Staff login.");
}
function showCredentials(u){
  const txt=loginShareText(u);modalKind="creds";draft=null;
  openModal(`<div class="m-h"><h2>${t("Login created")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body"><p>${t("Share these details with {n}:",{n:esc(u.name)})}</p><textarea class="copybox" style="min-height:150px" readonly id="credText">${esc(txt)}</textarea></div>
  <div class="m-f"><span class="sp"></span><button class="btn" data-act="copyCreds">${t("Copy")}</button><button class="btn pri" data-act="shareCreds">${t("Share")}</button></div>`,true);
}

/* ================= account menu ================= */
function openAccount(){
  const p=state.profile;modalKind="account";draft={};
  openModal(`<div class="m-h"><h2>${t("My account")}</h2><span class="sp"></span><button class="btn sm" data-act="close">✕</button></div>
  <div class="m-body">
    <div><b>${esc(p.name||"")}</b> · ${esc(t(ROLE_LABEL[p.role]||p.role))}</div>
    <div class="hint">${t("Organization code")}: <b>${esc(p.orgId)}</b> · ${p.role==="admin"?esc(p.mobile||""):esc(p.username||"")}</div>
    <div class="sec" style="margin-top:14px"><h3>${t("Change password")}</h3><div class="fg">
      <label class="f"><span>${t("Current password")}</span><input type="password" id="pwOld" autocomplete="current-password"></label>
      <label class="f"><span>${t("New password")}</span><input type="password" id="pwNew" autocomplete="new-password"></label>
    </div><button class="btn" style="margin-top:8px" data-act="changePw">${t("Change password")}</button></div>
    <div class="sec"><h3>${t("Delete account")}</h3><p class="hint">${p.role==="admin"?t("Deletes your login and ALL data of this organization (jobs, customers, bills). Staff logins are disabled. This cannot be undone."):t("Deletes your login. Your organization's data stays with the admin.")}</p>
      <div class="row"><input type="password" id="pwDel" placeholder="${esc(t("Current password"))}" style="max-width:220px"><button class="btn danger" data-act="deleteAccount">${t("Delete account")}</button></div></div>
  </div>
  <div class="m-f"><span class="hint">v${__APP_VERSION__}</span><span class="sp"></span><button class="btn pri" data-act="logout">${t("Log out")}</button></div>`,true);
}

/* ================= auth screens ================= */
let authMode="admin";
function authErr(e){
  const c=e&&e.code;
  return t({"bad-login":"Wrong login details. Check and try again.","exists":"This login already exists.","weak-password":"Password must be at least 6 characters.","network":"No internet connection. Please connect and try again.","too-many":"Too many attempts. Please wait a few minutes.","no-profile":"This login is not linked to any organization.","inactive":"This login has been disabled by the admin.","recent-login":"Please log out and log in again, then retry."}[c]||"Something went wrong — please try again.");
}
function renderAuth(msg){
  renderChrome();setBanner(backend&&backend.kind==="demo"?"Demo mode: data is stored only on this device.":"");
  const tab=(k,l)=>`<button class="chip${authMode===k?" on":""}" data-act="authMode" data-m="${k}">${esc(t(l))}</button>`;
  let body="";
  if(authMode==="admin")body=`<h2>${t("Admin login")}</h2><p class="hint">${t("Business owner logs in with mobile number.")}</p>
    <div class="fg" style="grid-template-columns:1fr"><label class="f"><span>${t("Mobile number")}</span><input type="tel" id="aMobile" inputmode="numeric" placeholder="98765 43210" autocomplete="username"></label>
    <label class="f"><span>${t("Password")}</span><input type="password" id="aPw" autocomplete="current-password"></label></div>
    <button class="btn pri" style="width:100%;justify-content:center;margin-top:12px" data-act="doAdminLogin">${t("Log in")}</button>
    <p class="hint" style="text-align:center;margin-top:14px">${t("New business?")} <a href="#" data-act="authMode" data-m="register">${t("Register here")}</a></p>`;
  else if(authMode==="staff")body=`<h2>${t("Staff login")}</h2><p class="hint">${t("Use the organization code, username and password given by your admin.")}</p>
    <div class="fg" style="grid-template-columns:1fr"><label class="f"><span>${t("Organization code")}</span><input type="text" id="sOrg" autocapitalize="characters" placeholder="AB12CD"></label>
    <label class="f"><span>${t("Username")}</span><input type="text" id="sUser" autocapitalize="none" autocomplete="username"></label>
    <label class="f"><span>${t("Password")}</span><input type="password" id="sPw" autocomplete="current-password"></label></div>
    <button class="btn pri" style="width:100%;justify-content:center;margin-top:12px" data-act="doStaffLogin">${t("Log in")}</button>`;
  else if(authMode==="register")body=`<h2>${t("Register your business")}</h2><p class="hint">${t("You become the admin. You can then add logins for office staff and crew.")}</p>
    <div class="fg" style="grid-template-columns:1fr"><label class="f"><span>${t("Business name")}</span><input type="text" id="rBiz" placeholder="${esc(t("e.g. Sri Murugan Borewells"))}"></label>
    <label class="f"><span>${t("Your name")}</span><input type="text" id="rName"></label>
    <label class="f"><span>${t("Mobile number")}</span><input type="tel" id="rMobile" inputmode="numeric" placeholder="98765 43210"></label>
    <label class="f"><span>${t("Password (min 6 characters)")}</span><input type="password" id="rPw" autocomplete="new-password"></label>
    <label class="f"><span>${t("Confirm password")}</span><input type="password" id="rPw2" autocomplete="new-password"></label></div>
    <label class="cbx" style="margin-top:10px"><input type="checkbox" id="rAgree"> <span>${t("I agree to the")} <a href="#" data-act="openUrl" data-url="${esc(PRIVACY_URL)}">${t("privacy policy")}</a></span></label>
    <button class="btn pri" style="width:100%;justify-content:center;margin-top:12px" data-act="doRegister">${t("Register")}</button>
    <p class="hint" style="text-align:center;margin-top:14px"><a href="#" data-act="authMode" data-m="admin">${t("Already registered? Log in")}</a></p>`;
  $("#view").innerHTML=`<div style="max-width:420px;margin:20px auto">
    <div class="chips" style="justify-content:center;margin-bottom:14px">${tab("admin","Admin")}${tab("staff","Staff")}</div>
    <div class="card">${msg?`<div class="banner" style="padding:0;margin:0 0 12px"><div>${esc(msg)}</div></div>`:""}${body}</div>
    <p class="hint" style="text-align:center;margin-top:14px"><a href="#" data-act="openUrl" data-url="${esc(PRIVACY_URL)}">${t("Privacy policy")}</a></p></div>`;
}
function showRegistered(orgId){
  modalKind="registered";draft=null;
  openModal(`<div class="m-h"><h2>${t("Registration complete 🎉")}</h2></div><div class="m-body">
    <p>${t("Your organization code is:")}</p><div style="font-size:32px;font-weight:700;letter-spacing:4px;text-align:center;margin:10px 0">${esc(orgId)}</div>
    <p class="hint">${t("Staff will need this code to log in. You can always see it in Team & logins.")}</p>
    <p class="hint">${t("Next: set your rates under Rates & business, then add logins for your staff.")}</p></div>
    <div class="m-f"><span class="sp"></span><button class="btn pri" data-act="close">${t("Start")}</button></div>`,true);
}
function renderAll(){
  renderChrome();
  if(!state.profile){renderAuth();return}
  if(!state.loaded){$("#view").innerHTML=`<div class="loading">${t("Loading…")}</div>`;return}
  render(true);
}

/* ================= extra actions ================= */
Object.assign(ACT,{
  acct:()=>openAccount(),
  authMode:a=>{authMode=a.dataset.m;renderAuth()},
  doAdminLogin:async a=>{const m=cleanMobile($("#aMobile").value),pw=$("#aPw").value;if(m.length!==10){renderAuth(t("Enter a 10-digit mobile number."));return}
    a.disabled=true;try{await backend.loginAdmin(m,pw)}catch(e){a.disabled=false;renderAuth(authErr(e));const el=$("#aMobile");if(el)el.value=m}},
  doStaffLogin:async a=>{const o=cleanOrg($("#sOrg").value),u=cleanUsername($("#sUser").value),pw=$("#sPw").value;if(!o||!u||!pw){renderAuth(t("Fill in all fields."));return}
    a.disabled=true;try{await backend.loginStaff(o,u,pw)}catch(e){a.disabled=false;renderAuth(authErr(e));const x=$("#sOrg");if(x)x.value=o;const y=$("#sUser");if(y)y.value=u}},
  doRegister:async a=>{const biz=$("#rBiz").value.trim(),name=$("#rName").value.trim(),m=cleanMobile($("#rMobile").value),pw=$("#rPw").value,pw2=$("#rPw2").value;
    const keep=()=>{const v={rBiz:biz,rName:name,rMobile:m};for(const k in v){const el=document.getElementById(k);if(el)el.value=v[k]}};
    if(!biz||!name){renderAuth(t("Fill in all fields."));keep();return}
    if(m.length!==10){renderAuth(t("Enter a 10-digit mobile number."));keep();return}
    if(pw.length<6){renderAuth(t("Password must be at least 6 characters."));keep();return}
    if(pw!==pw2){renderAuth(t("Passwords do not match."));keep();return}
    if(!$("#rAgree").checked){renderAuth(t("Please accept the privacy policy."));keep();return}
    a.disabled=true;
    try{const {orgId}=await backend.registerOrg({bizName:biz,ownerName:name,mobile:m,password:pw});pendingRegistered=orgId}
    catch(e){a.disabled=false;renderAuth(authErr(e));keep()}},
  logout:async()=>{closeModal();await backend.logout()},
  changePw:async a=>{const o=$("#pwOld").value,n=$("#pwNew").value;if(n.length<6){toast(t("Password must be at least 6 characters."));return}
    a.disabled=true;try{await backend.changePassword(o,n);toast(t("Password changed"));$("#pwOld").value="";$("#pwNew").value=""}catch(e){toast(authErr(e))}finally{a.disabled=false}},
  deleteAccount:a=>armDelete(a,async()=>{const pw=$("#pwDel").value;if(!pw){toast(t("Enter your current password."));return}
    try{await backend.deleteMyAccount(pw,isAdmin());closeModal();toast(t("Account deleted"))}catch(e){toast(authErr(e))}}),
  saveCrewJob:a=>{const j=clone(draft);j.updatedAt=new Date().toISOString();j.updatedBy=state.profile.uid;
    ["depth","casingFt"].forEach(k=>{if(j[k]!==""&&j[k]!=null)j[k]=num(j[k])});
    backend.saveJob(j);closeModal();toast(t("Job saved"))},
  newUser:()=>openUserModal(null),
  openUser:a=>openUserModal(a.dataset.id),
  saveUser:async a=>{const u=clone(draft);u.name=(u.name||"").trim();if(!u.name){toast(t("Name is required"));return}
    if(u.id){const patch={name:u.name,active:u.active!==false};if(u.role&&u.id!==state.profile.uid)patch.role=u.role;
      if(u.role==="crew"){if(!u.crewId){const cid=uid();await save("crew",cid,{id:cid,name:u.name,role:"Driller",phone:"",vehicle:"",active:true,notes:""});u.crewId=cid}patch.crewId=u.crewId}
      backend.updateStaff(u.id,patch);closeModal();toast(t("Saved"));return}
    u.username=cleanUsername(u.username);if(!u.username){toast(t("Enter a username (letters and numbers)."));return}
    if(String(u.password||"").length<6){toast(t("Password must be at least 6 characters."));return}
    a.disabled=true;
    try{
      let crewId="";
      if(u.role==="crew"){crewId=u.crewId;if(!crewId){crewId=uid();await save("crew",crewId,{id:crewId,name:u.name,role:"Driller",phone:"",vehicle:"",active:true,notes:""})}}
      await backend.createStaff({name:u.name,username:u.username,password:u.password,role:u.role,crewId});
      showCredentials(u);
    }catch(e){a.disabled=false;toast(e&&e.code==="exists"?t("This username is already used in your organization."):authErr(e))}},
  copyCreds:()=>copyText($("#credText").value,t("Login details")),
  shareCreds:async()=>{const txt=$("#credText").value;if(!(await shareText(txt,t("Login details"))))copyText(txt,t("Login details"))},
});
let pendingRegistered=null;

/* ================= boot ================= */
const PRIVACY_URL=import.meta.env.VITE_PRIVACY_URL||"./privacy.html";
function firebaseConfig(){
  const raw=import.meta.env.VITE_FIREBASE_CONFIG;if(!raw)return null;
  try{return JSON.parse(raw)}catch(e){
    // accept the JS snippet copied from Firebase console: { apiKey: "...", ... }
    try{return JSON.parse(raw.replace(/^[^{]*/,"").replace(/[^}]*$/,"").replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g,'$1"$2":'))}catch(e2){return null}}
}
async function boot(){
  renderChrome();
  if(import.meta.env.VITE_DEMO){backend=createDemoBackend()}
  else{const cfg=firebaseConfig();
    if(!cfg){$("#view").innerHTML=`<div class="card" style="max-width:520px;margin:30px auto">${t("This build is not connected to Firebase yet. Set the FIREBASE_CONFIG variable in GitHub (see SETUP.md) and rebuild.")}</div>`;return}
    backend=await createFirebaseBackend(cfg)}
  backend.onError(onBackendError);
  backend.onAuth((profile,err)=>{
    state.profile=profile;
    if(!profile){state.loaded=false;closeModal();authMode=authMode==="register"?"admin":authMode;renderAuth(err?authErr(err):"");return}
    if(location.hash&&!ROUTES_().some(r=>"#"+r[0]===location.hash))history.replaceState(null,"","#dashboard");
    startData();renderAll();
    if(pendingRegistered){const o=pendingRegistered;pendingRegistered=null;setTimeout(()=>showRegistered(o),300)}
  });
  onBackButton(()=>{if($("#modal").classList.contains("open")){closeModal();return true}if(state.profile&&route()!=="dashboard"){location.hash="dashboard";return true}return false});
}
document.addEventListener("click",e=>{if(e.target.closest("#acctBtn"))openAccount()});
boot();

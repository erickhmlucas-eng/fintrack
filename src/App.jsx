import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://rjcgvlstriiepixogqnl.supabase.co";
const SUPABASE_KEY = "sb_publishable_qmzTdrWgLlNUiihld4Q3nw_iz_ED6aS";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function dbGet(key) {
  try {
    const { data } = await supabase.from("user_data").select("value").eq("key", key).single();
    return data?.value ?? null;
  } catch(_) { return null; }
}
async function dbSet(key, value) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("user_data").upsert(
      { key, value, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
  } catch(_) {}
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MONTHS_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const DEFAULT_BANKS = [
  {id:"c6",name:"C6",color:"#2d2d2d",limit:0},
  {id:"porto",name:"Porto",color:"#1a4fcc",limit:0},
  {id:"santander",name:"Santander",color:"#e8001c",limit:0},
  {id:"nubank",name:"Nubank",color:"#8a05be",limit:0},
];

const DEFAULT_EXPENSE_CATS = [
  {id:"alimentacao",name:"Alimentação",icon:"🍔",color:"#c0392b"},
  {id:"transporte",name:"Transporte",icon:"🚌",color:"#922b21"},
  {id:"gasolina",name:"Gasolina",icon:"⛽",color:"#a93226"},
  {id:"farmacia",name:"Farmácia",icon:"💊",color:"#b03a2e"},
  {id:"compras",name:"Compras online",icon:"📦",color:"#96281b"},
  {id:"roupa",name:"Roupa / Tênis",icon:"👟",color:"#c0392b"},
  {id:"cursos",name:"Cursos online",icon:"📚",color:"#00cec9"},
  {id:"carro",name:"Carro / Seguro / IPVA",icon:"🚗",color:"#b2c6d8"},
  {id:"cabelo",name:"Corte de cabelo",icon:"✂️",color:"#a04000"},
  {id:"lazer",name:"Lazer",icon:"🎮",color:"#6c5ce7"},
  {id:"saude",name:"Saúde",icon:"🏥",color:"#00b894"},
  {id:"assinaturas",name:"Assinaturas",icon:"📺",color:"#74b9ff"},
  {id:"moradia",name:"Moradia",icon:"🏠",color:"#784212"},
  {id:"outros",name:"Outros",icon:"📌",color:"#7b241c"},
];

const INVEST_TYPES = ["Reserva de Emergência","Meta pessoal","CDB","Poupança","Tesouro Direto","Ações","Cripto","Outro","Retirada — Reserva","Retirada — Meta"];
const METHODS = ["PIX","Débito","Dinheiro","Boleto"];
const BANK_COLORS = ["#2d2d2d","#1a4fcc","#e8001c","#8a05be","#f78c00","#cc092f","#00b894","#6c5ce7","#555577"];
const CAT_COLORS = ["#c0392b","#922b21","#a93226","#6c5ce7","#00b894","#74b9ff","#f78c00","#784212","#00cec9","#8a05be","#555577"];
const CAT_ICONS = ["🍔","🚌","⛽","💊","📦","👟","📚","🚗","✂️","🎮","🏥","📺","🏠","📌","🎯","💡","🎁","🐾","✈️","🏋️","🎵","🛒"];

const fmt = v => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const today = new Date();
const monthKey = (y,m) => `fintrack:month:${y}:${m}:v10`;
const creditKey = (y,m) => `fintrack:credit:${y}:${m}:v10`;
const SETTINGS_KEY = "fintrack:settings:v10";
const DEBTS_KEY = "fintrack:debts:v10";
const EMPTY_MONTH = () => ({incomes:[],expenses:[],fixed:[],investments:[],notes:""});
const EMPTY_CREDIT = () => ({purchases:[]});
const DEFAULT_SETTINGS = {
  name:"ERICK",
  emergencyGoal:10000,emergencyBase:0,emergencyDelta:0,
  personalGoalName:"Meta X",personalGoalValue:100000,personalBase:0,personalDelta:0,
  banks:DEFAULT_BANKS,catBudgets:{},expenseCats:DEFAULT_EXPENSE_CATS,
};

const NAV = [
  {id:"dashboard",icon:"📊",label:"Início"},
  {id:"incomes",  icon:"📥",label:"Entradas"},
  {id:"expenses", icon:"📤",label:"Gastos"},
  {id:"fixed",    icon:"📋",label:"Fixas"},
  {id:"cards",    icon:"💳",label:"Cartões"},
  {id:"investments",icon:"💰",label:"Reservas"},
  {id:"debts",    icon:"🔗",label:"Dívidas"},
  {id:"annual",   icon:"📅",label:"Anual"},
  {id:"settings", icon:"⚙️",label:"Config"},
];

function isWithdrawal(e){ return e.type==="Retirada — Reserva"||e.type==="Retirada — Meta"; }
function reserveDelta(entry,sign=1){
  if(entry.type==="Reserva de Emergência") return {ed:sign*entry.value,pd:0};
  if(entry.type==="Meta pessoal")          return {ed:0,pd:sign*entry.value};
  if(entry.type==="Retirada — Reserva")    return {ed:-sign*entry.value,pd:0};
  if(entry.type==="Retirada — Meta")       return {ed:0,pd:-sign*entry.value};
  return {ed:0,pd:0};
}

function calcMonthBalance(monthData){
  if(!monthData) return 0;
  const inc=(monthData.incomes||[]).reduce((s,t)=>s+t.value,0);
  const exp=(monthData.expenses||[]).reduce((s,t)=>s+t.value,0);
  const fix=(monthData.fixed||[]).reduce((s,t)=>s+(t.paid?(t.value||0):0),0);
  const inv=(monthData.investments||[]).filter(e=>!isWithdrawal(e)).reduce((s,t)=>s+t.value,0);
  return inc-exp-fix-inv;
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function Donut({data,size=140,thick=24,label,sublabel}){
  const r=(size-thick)/2,cx=size/2,cy=size/2,circ=2*Math.PI*r;
  const total=data.reduce((s,d)=>s+d.value,0);
  let off=0;
  const segs=data.map(d=>{const dash=(total>0?d.value/total:0)*circ;const s={...d,dash,gap:circ-dash,offset:circ-off};off+=dash;return s;});
  return (
    <div style={{position:"relative",width:size,height:size,margin:"0 auto"}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        {total===0?<circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e30" strokeWidth={thick}/>
          :segs.map((s,i)=><circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thick} strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={s.offset}/>)}
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"0 10px"}}>
        {label&&<div style={{fontSize:12,fontWeight:700,color:"var(--text)",textAlign:"center",lineHeight:1.2}}>{label}</div>}
        {sublabel&&<div style={{fontSize:9,color:"var(--muted)",textAlign:"center"}}>{sublabel}</div>}
      </div>
    </div>
  );
}

function GoalBar({label,icon,current,goal,color}){
  const pct=goal>0?Math.min((current/goal)*100,100):0;
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontSize:12,fontWeight:600}}>{icon} {label}</span>
        <span style={{fontSize:10,color:"var(--muted)"}}>{fmt(current)} / {fmt(goal)}</span>
      </div>
      <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3,transition:"width .6s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
        <span style={{fontSize:10,color,fontWeight:600}}>{pct.toFixed(1)}%</span>
        <span style={{fontSize:10,color:"var(--muted)"}}>Faltam {fmt(Math.max(goal-current,0))}</span>
      </div>
    </div>
  );
}

function Toast({msg,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[onDone]);
  return <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:"var(--green)",color:"#000",fontFamily:"'Sora',sans-serif",fontSize:12,fontWeight:700,padding:"10px 20px",borderRadius:20,zIndex:2000,whiteSpace:"nowrap"}}>{msg}</div>;
}

function Modal({onClose,children,tall=false}){
  useEffect(()=>{document.body.style.overflow="hidden";return()=>{document.body.style.overflow="";};},[]);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.87)",backdropFilter:"blur(6px)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"var(--card)",border:"1px solid var(--border2)",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:520,padding:"20px 18px 36px",maxHeight:tall?"95vh":"88vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function AuthScreen(){
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [msg,setMsg]=useState("");
  async function handle(){
    setLoading(true);setError("");setMsg("");
    try{
      if(mode==="login"){const{error}=await supabase.auth.signInWithPassword({email,password});if(error)setError(error.message);}
      else if(mode==="signup"){const{error}=await supabase.auth.signUp({email,password});if(error)setError(error.message);else setMsg("Conta criada! Verifique seu e-mail.");}
      else{const{error}=await supabase.auth.resetPasswordForEmail(email);if(error)setError(error.message);else setMsg("E-mail de recuperação enviado!");}
    }catch(_){}
    setLoading(false);
  }
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:28,fontWeight:700,letterSpacing:"-1px"}}>Fin<span style={{color:"var(--accent)"}}>Track</span></div>
          <div style={{fontSize:13,color:"var(--muted)",marginTop:6}}>Controle financeiro pessoal</div>
        </div>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:20,padding:24}}>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            {[["login","Entrar"],["signup","Criar conta"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setMsg("");}} style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,background:mode===m?"var(--accent)":"var(--surface)",color:mode===m?"#fff":"var(--muted)"}}>
                {l}
              </button>
            ))}
          </div>
          <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".7px",color:"var(--muted)",marginBottom:5}}>E-mail</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",fontFamily:"'Sora',sans-serif",fontSize:14,borderRadius:10,padding:"11px 12px",outline:"none",boxSizing:"border-box"}} placeholder="seu@email.com" type="email"/>
          </div>
          {mode!=="reset"&&(
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".7px",color:"var(--muted)",marginBottom:5}}>Senha</label>
              <input value={password} onChange={e=>setPassword(e.target.value)} style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",fontFamily:"'Sora',sans-serif",fontSize:14,borderRadius:10,padding:"11px 12px",outline:"none",boxSizing:"border-box"}} placeholder="••••••••" type="password" onKeyDown={e=>e.key==="Enter"&&handle()}/>
            </div>
          )}
          {error&&<div style={{background:"rgba(192,57,43,.15)",border:"1px solid rgba(192,57,43,.3)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"var(--wine)",marginBottom:12}}>{error}</div>}
          {msg&&<div style={{background:"rgba(0,214,143,.1)",border:"1px solid rgba(0,214,143,.2)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"var(--green)",marginBottom:12}}>{msg}</div>}
          <button onClick={handle} disabled={loading} style={{width:"100%",background:"var(--accent)",color:"#fff",border:"none",fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,borderRadius:11,padding:13,cursor:"pointer",opacity:loading?.6:1}}>
            {loading?"Aguarde...":{login:"Entrar",signup:"Criar conta",reset:"Enviar e-mail"}[mode]}
          </button>
          {mode==="login"&&<button onClick={()=>{setMode("reset");setError("");setMsg("");}} style={{width:"100%",background:"none",border:"none",color:"var(--muted)",fontFamily:"'Sora',sans-serif",fontSize:12,cursor:"pointer",marginTop:12,padding:4}}>Esqueci minha senha</button>}
        </div>
      </div>
    </div>
  );
}

// ─── CARTÕES PAGE ─────────────────────────────────────────────────────────────
function CartoesPage({banks,expenseCats,vm,vy,creditData,setCreditData,monthData,setMonthData}){
  const [selectedBank,setSelectedBank]=useState(banks[0]?.name||"");
  const [showAddModal,setShowAddModal]=useState(false);
  const catMap=Object.fromEntries(expenseCats.map(c=>[c.name,c]));

  const purchases=creditData.purchases||[];
  const bank=banks.find(b=>b.name===selectedBank)||banks[0];

  // Purchases for selected bank this month
  const bankPurchases=purchases.filter(p=>p.bank===selectedBank);
  const totalUsed=bankPurchases.reduce((s,p)=>s+p.monthlyValue,0);
  const limit=bank?.limit||0;
  const available=limit>0?Math.max(limit-totalUsed,0):null;
  const pct=limit>0?Math.min((totalUsed/limit)*100,100):0;

  // Category breakdown
  const catBreak=expenseCats.map(c=>{
    const val=bankPurchases.filter(p=>p.category===c.name).reduce((s,p)=>s+p.monthlyValue,0);
    return {...c,val};
  }).filter(c=>c.val>0).sort((a,b)=>b.val-a.val);

  // Auto-invoice: purchases from prev month that haven't been invoiced yet
  const pm=vm===0?11:vm-1, py=vm===0?vy-1:vy;

  function addPurchase(purchase){
    // If installments > 1, create entries for each future month
    const newPurchases=[...purchases];
    if(purchase.installments>1){
      for(let i=0;i<purchase.installments;i++){
        const m=(vm+i)%12;
        const y=vy+Math.floor((vm+i)/12);
        newPurchases.push({
          ...purchase,
          id:uid(),
          monthYear:`${y}-${m}`,
          monthlyValue:parseFloat((purchase.totalValue/purchase.installments).toFixed(2)),
          installmentNum:i+1,
          name:`${purchase.name} (${i+1}/${purchase.installments})`,
        });
      }
      // Save future months credit data
      const grouped={};
      newPurchases.forEach(p=>{
        const key=p.monthYear||`${vy}-${vm}`;
        if(!grouped[key]) grouped[key]=[];
        grouped[key].push(p);
      });
      // Update current month
      const curKey=`${vy}-${vm}`;
      setCreditData({purchases:newPurchases.filter(p=>p.monthYear===curKey||(p.installments===1&&!p.monthYear))});
      // Save all future months
      Object.entries(grouped).forEach(([key,ps])=>{
        const [y,m]=key.split("-").map(Number);
        dbGet(creditKey(y,m)).then(existing=>{
          const ex=existing||EMPTY_CREDIT();
          dbSet(creditKey(y,m),{purchases:[...ex.purchases.filter(ep=>ep.groupId!==purchase.groupId),...ps]});
        });
      });
    } else {
      newPurchases.push({...purchase,id:uid(),monthYear:`${vy}-${vm}`,monthlyValue:purchase.totalValue,installmentNum:1});
      setCreditData({purchases:newPurchases});
    }
    setShowAddModal(false);
  }

  function deletePurchase(id){
    setCreditData({purchases:purchases.filter(p=>p.id!==id)});
  }

  // Check if there's an auto-invoice fixed for this bank from prev month
  const autoInvoiceKey=`auto_invoice_${selectedBank}_${py}_${pm}`;
  const hasAutoInvoice=(monthData.fixed||[]).some(f=>f.id===autoInvoiceKey||f.autoInvoiceKey===autoInvoiceKey);

  return (
    <div className="pg">
      <div className="st">Cartões — {MONTHS_FULL[vm]} {vy}</div>

      {/* Bank selector */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {banks.map(b=>{
          const tot=purchases.filter(p=>p.bank===b.name).reduce((s,p)=>s+p.monthlyValue,0);
          return (
            <button key={b.id} onClick={()=>setSelectedBank(b.name)}
              style={{padding:"7px 14px",borderRadius:20,border:`2px solid ${selectedBank===b.name?b.color:"var(--border)"}`,background:selectedBank===b.name?b.color+"22":"var(--surface)",color:selectedBank===b.name?b.color:"var(--muted)",fontFamily:"'Sora',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {b.name}{tot>0&&<span style={{marginLeft:5,fontSize:9,background:b.color,color:"#fff",padding:"1px 5px",borderRadius:10}}>{fmt(tot)}</span>}
            </button>
          );
        })}
      </div>

      {/* Limit card */}
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{width:12,height:12,borderRadius:"50%",background:bank?.color,display:"inline-block"}}/>
              <span style={{fontSize:14,fontWeight:700}}>{selectedBank}</span>
            </div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Próxima fatura — {MONTHS_FULL[vm]}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:20,fontWeight:700,color:"var(--wine)"}}>{fmt(totalUsed)}</div>
            {limit>0&&<div style={{fontSize:10,color:"var(--muted)"}}>de {fmt(limit)} de limite</div>}
          </div>
        </div>
        {limit>0&&<>
          <div style={{height:8,background:"var(--border)",borderRadius:4,overflow:"hidden",marginBottom:6}}>
            <div style={{height:"100%",width:`${pct}%`,borderRadius:4,transition:"width .4s",background:pct>90?"var(--wine)":pct>70?"var(--gold)":bank?.color}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
            <span style={{color:pct>90?"var(--wine)":pct>70?"var(--gold)":"var(--muted)"}}>{pct.toFixed(0)}% usado</span>
            <span style={{color:"var(--green)",fontWeight:600}}>{fmt(available)} disponível</span>
          </div>
        </>}
      </div>

      {/* Add purchase button */}
      <button onClick={()=>setShowAddModal(true)}
        style={{background:"var(--accent)",border:"none",color:"#fff",fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,borderRadius:11,padding:"12px",cursor:"pointer",width:"100%"}}>
        + Lançar compra no crédito
      </button>

      {/* Category breakdown */}
      {catBreak.length>0&&(
        <div className="card">
          <div className="st" style={{marginBottom:10}}>Por categoria</div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
            <Donut size={130} thick={22} data={catBreak.map(c=>({color:c.color,value:c.val}))} label={fmt(totalUsed)} sublabel={selectedBank}/>
          </div>
          {catBreak.map(c=>(
            <div key={c.name} style={{marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:11,fontWeight:500}}>{c.icon} {c.name}</span>
                <span style={{fontSize:11,fontWeight:600,color:"var(--wine)"}}>{fmt(c.val)}</span>
              </div>
              <div style={{height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${totalUsed>0?(c.val/totalUsed)*100:0}%`,background:c.color,borderRadius:3}}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Purchases list */}
      {bankPurchases.length>0&&(
        <div>
          <div className="st" style={{marginBottom:8}}>Lançamentos ({bankPurchases.length})</div>
          <div className="txlist">
            {bankPurchases.map(p=>{
              const cat=catMap[p.category]||{icon:"📌",color:"#888"};
              const d=p.date?p.date.slice(5).split("-").reverse().join("/"):"";
              return (
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:11}}>
                  <div style={{width:32,height:32,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,background:cat.color+"33"}}>{cat.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                    <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{d} · {p.category}{p.installments>1&&` · parcela ${p.installmentNum}/${p.installments}`}</div>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--wine)",flexShrink:0}}>-{fmt(p.monthlyValue)}</div>
                  <button onClick={()=>deletePurchase(p.id)} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:13,padding:"5px 4px",flexShrink:0}}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bankPurchases.length===0&&<div className="empty">Nenhum lançamento de crédito em {MONTHS_FULL[vm]}.<br/>Toque em <strong style={{color:"var(--accent)"}}>+ Lançar compra</strong> para adicionar.</div>}

      {showAddModal&&(
        <Modal onClose={()=>setShowAddModal(false)} tall>
          <CreditPurchaseForm banks={banks} expenseCats={expenseCats} selectedBank={selectedBank} vm={vm} vy={vy} onSave={addPurchase} onClose={()=>setShowAddModal(false)}/>
        </Modal>
      )}
    </div>
  );
}

function CreditPurchaseForm({banks,expenseCats,selectedBank,vm,vy,onSave,onClose}){
  const dd=`${vy}-${String(vm+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [form,setForm]=useState({name:"",category:expenseCats[0]?.name||"Outros",bank:selectedBank,totalValue:"",installments:"1",date:dd});
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const tv=parseFloat(String(form.totalValue||"0").replace(",","."))||0;
  const inst=parseInt(form.installments||"1")||1;
  const monthly=inst>0?tv/inst:0;
  function save(){
    if(!form.name||!tv) return;
    onSave({...form,totalValue:tv,installments:inst,groupId:uid()});
  }
  return (
    <>
      <div className="mhdr"><div className="mtitle">💳 Nova compra no crédito</div><button className="mclose" onClick={onClose}>✕</button></div>
      <div className="fg"><label className="fl">Descrição</label><input className="fi" placeholder="Ex: Tênis Nike, iFood, Netflix…" value={form.name} onChange={e=>upd("name",e.target.value)} autoFocus/></div>
      <div className="fg"><label className="fl">Categoria</label>
        <div className="catgrid">{expenseCats.map(c=>(
          <button key={c.id||c.name} className={`catopt${form.category===c.name?" selected":""}`} style={form.category===c.name?{borderColor:c.color,background:c.color+"33",color:"#fff"}:{}} onClick={()=>upd("category",c.name)}>{c.icon} {c.name}</button>
        ))}</div>
      </div>
      <div className="fg"><label className="fl">Cartão</label>
        <select className="fi" value={form.bank} onChange={e=>upd("bank",e.target.value)}>
          {banks.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
      </div>
      <div className="frow">
        <div className="fg"><label className="fl">Valor total (R$)</label><input className="fi" type="number" inputMode="decimal" placeholder="0,00" value={form.totalValue} onChange={e=>upd("totalValue",e.target.value)}/></div>
        <div className="fg"><label className="fl">Parcelas</label><input className="fi" type="number" inputMode="numeric" min="1" max="48" value={form.installments} onChange={e=>upd("installments",e.target.value)}/></div>
      </div>
      {inst>1&&monthly>0&&<div style={{background:"rgba(155,140,255,.1)",border:"1px solid rgba(155,140,255,.25)",borderRadius:9,padding:"8px 11px",marginBottom:10,fontSize:12,color:"var(--accent)",fontWeight:600}}>{inst}x de {fmt(monthly)} · Fatura de {MONTHS_FULL[vm]} até {MONTHS_FULL[(vm+inst-1)%12]} {vy+Math.floor((vm+inst-1)/12)}</div>}
      <div className="fg"><label className="fl">Data da compra</label><input className="fi" type="date" value={form.date} onChange={e=>upd("date",e.target.value)}/></div>
      <button className="savebtn" onClick={save} disabled={!form.name||!tv}>Adicionar {inst>1?`(${inst}x de ${fmt(monthly)})`:`(${fmt(tv)})`}</button>
    </>
  );
}

// ─── BULK PANEL ───────────────────────────────────────────────────────────────
function BulkPanel({type,banks,expenseCats,vy,vm,onConfirm,onClose}){
  const [text,setText]=useState("");
  const [preview,setPreview]=useState([]);
  const [processed,setProcessed]=useState(false);
  const labels={income:"Entradas",expense:"Gastos",fixed:"Despesas Fixas",investment:"Reservas"};
  const examples={
    income:"Salário 5000 05/04\nFreela Cliente X 1200 10/04",
    expense:"iFood 45.90 alimentação pix 01/04\nMercado 200 alimentação débito 02/04",
    fixed:"Parcela carro 850\nSeguro celular 49.90",
    investment:"Reserva de Emergência 500 01/04\nCDB 200 05/04",
  };
  function parseLine(line){
    const valMatch=line.match(/\b(\d{1,6}[.,]\d{2}|\d{1,6})\b/);
    if(!valMatch) return null;
    const value=parseFloat(valMatch[1].replace(",","."));
    if(!value||value<=0) return null;
    const dateMatch=line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    let date=`${vy}-${String(vm+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    if(dateMatch){const d=String(dateMatch[1]).padStart(2,"0"),m=String(dateMatch[2]).padStart(2,"0");const y=dateMatch[3]?(dateMatch[3].length===2?"20"+dateMatch[3]:dateMatch[3]):vy;date=`${y}-${m}-${d}`;}
    let rem=line.replace(valMatch[0]," ").replace(dateMatch?dateMatch[0]:""," ").replace(/\s+/g," ").trim();
    if(type==="income") return {id:uid(),name:rem||"Entrada",value,date};
    if(type==="fixed")  return {id:uid(),name:rem||"Despesa fixa",value,paid:false};
    if(type==="expense"){
      let category=expenseCats[expenseCats.length-1]?.name||"Outros",method="PIX",bank=banks[0]?.name||"";
      for(const cat of expenseCats){const key=cat.name.toLowerCase().split(/[\/\s,]/)[0];if(key.length>3&&rem.toLowerCase().includes(key)){category=cat.name;rem=rem.replace(new RegExp(key,"gi"),"").replace(/\s+/g," ").trim();break;}}
      for(const b of banks){if(rem.toLowerCase().includes(b.name.toLowerCase())){bank=b.name;rem=rem.replace(new RegExp(b.name,"gi"),"").replace(/\s+/g," ").trim();break;}}
      const mm={pix:"PIX",débito:"Débito",debito:"Débito",dinheiro:"Dinheiro",boleto:"Boleto"};
      for(const [k,v] of Object.entries(mm)){if(rem.toLowerCase().includes(k)){method=v;rem=rem.replace(new RegExp(k,"gi"),"").replace(/\s+/g," ").trim();break;}}
      return {id:uid(),category,description:rem||category,value,date,bank,method,essential:false};
    }
    if(type==="investment"){
      let invType="Outro";
      for(const t of INVEST_TYPES){if(rem.toLowerCase().includes(t.toLowerCase().split(/[\s—]/)[0])){invType=t;break;}}
      return {id:uid(),name:rem||"Investimento",type:invType,value,date};
    }
    return null;
  }
  function process(){setPreview(text.split("\n").map(l=>l.trim()).filter(Boolean).map(parseLine).filter(Boolean));setProcessed(true);}
  const catMap=Object.fromEntries(expenseCats.map(c=>[c.name,c]));
  return (
    <>
      <div className="mhdr"><div className="mtitle">📋 Colar em lote — {labels[type]}</div><button className="mclose" onClick={onClose}>✕</button></div>
      {!processed?(
        <>
          <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:9,padding:10,marginBottom:10,fontSize:10,color:"var(--muted)",lineHeight:1.8,fontFamily:"monospace"}}>{examples[type]}</div>
          <textarea style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",fontFamily:"'Sora',sans-serif",fontSize:13,borderRadius:10,padding:11,resize:"vertical",minHeight:130,outline:"none"}} placeholder={`Cole aqui...\n\nEx:\n${examples[type]}`} value={text} onChange={e=>setText(e.target.value)} autoFocus/>
          <button className="savebtn" style={{marginTop:10}} onClick={process} disabled={!text.trim()}>Processar →</button>
        </>
      ):(
        <>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>{preview.length} lançamento(s) identificado(s):</div>
          {preview.length===0?<div style={{textAlign:"center",color:"var(--wine)",padding:"20px 0",fontSize:13}}>Nenhum reconhecido.</div>
            :<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
              {preview.map((p,i)=>{
                const cat=type==="expense"?(catMap[p.category]||{icon:"📌"}):null;
                return (
                  <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"9px 11px",display:"flex",alignItems:"center",gap:9}}>
                    {cat&&<span style={{fontSize:16}}>{cat.icon}</span>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||p.description||p.type}</div>
                      <div style={{fontSize:9,color:"var(--muted)",marginTop:1}}>{p.date&&p.date.slice(5).split("-").reverse().join("/")}{p.category&&` · ${p.category}`}{p.bank&&` · ${p.bank}`}</div>
                    </div>
                    <div style={{fontWeight:700,fontSize:13,flexShrink:0,color:type==="income"?"var(--green)":type==="investment"?"var(--gold)":"var(--wine)"}}>{fmt(p.value)}</div>
                  </div>
                );
              })}
            </div>
          }
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <button onClick={()=>setProcessed(false)} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:600,borderRadius:10,padding:12,cursor:"pointer"}}>← Corrigir</button>
            <button className="savebtn" style={{margin:0}} onClick={()=>onConfirm(preview)} disabled={preview.length===0}>Confirmar {preview.length}</button>
          </div>
        </>
      )}
    </>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FinTrack(){
  const [session,setSession]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return ()=>subscription.unsubscribe();
  },[]);
  if(authLoading) return <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted)",fontFamily:"'Sora',sans-serif"}}><style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;700&display=swap');:root{--bg:#07070f;--muted:#6060a0;}`}</style>Carregando...</div>;
  if(!session) return <><style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}:root{--bg:#07070f;--surface:#0d0d1a;--card:#111120;--border:#1a1a2e;--border2:#22223a;--text:#eeeeff;--muted:#6060a0;--green:#00d68f;--wine:#c0392b;--accent:#9b8cff;--gold:#ffd166;--blue:#4d9fff;}html,body{background:var(--bg);color:var(--text);font-family:'Sora',sans-serif;}`}</style><AuthScreen/></>;
  return <AppInner session={session}/>;
}

function AppInner({session}){
  const [page,setPage]=useState("dashboard");
  const [vm,setVm]=useState(today.getMonth());
  const [vy,setVy]=useState(today.getFullYear());
  const [data,setData]=useState(EMPTY_MONTH());
  const [creditData,setCreditData]=useState(EMPTY_CREDIT());
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [debts,setDebts]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [modal,setModal]=useState(null);
  const [yearCache,setYearCache]=useState({});
  const [toast,setToast]=useState(null);
  const [prevBalance,setPrevBalance]=useState(0);
  const [syncing,setSyncing]=useState(false);
  const [loading,setLoading]=useState(false);
  const saveTimer=useRef(null);
  const creditSaveTimer=useRef(null);

  // Load settings & debts once
  useEffect(()=>{
    (async()=>{
      const s=await dbGet(SETTINGS_KEY);
      if(s) setSettings(p=>({...DEFAULT_SETTINGS,...s,banks:s.banks||DEFAULT_BANKS,catBudgets:s.catBudgets||{},expenseCats:s.expenseCats||DEFAULT_EXPENSE_CATS}));
      const d=await dbGet(DEBTS_KEY);
      if(d) setDebts(d);
      setLoaded(true);
    })();
  },[]);

  // Load month data — RESET IMMEDIATELY on month change
  useEffect(()=>{
    if(!loaded) return;
    setData(EMPTY_MONTH());
    setCreditData(EMPTY_CREDIT());
    setLoading(true);
    setPrevBalance(0);
    (async()=>{
      // Load current month
      const r=await dbGet(monthKey(vy,vm));
      if(r) setData(r);
      else setData(EMPTY_MONTH());

      // Load credit data for this month
      const cr=await dbGet(creditKey(vy,vm));
      if(cr) setCreditData(cr);
      else {
        // Check if prev month had credit purchases — generate auto-invoice fixed
        const pm=vm===0?11:vm-1, py=vm===0?vy-1:vy;
        const prevCredit=await dbGet(creditKey(py,pm));
        if(prevCredit?.purchases?.length>0){
          // Group by bank
          const byBank={};
          prevCredit.purchases.forEach(p=>{
            if(!byBank[p.bank]) byBank[p.bank]={bank:p.bank,total:0,items:[]};
            byBank[p.bank].total+=p.monthlyValue;
            byBank[p.bank].items.push(p);
          });
          // Create auto fixed invoices
          const autoFixed=Object.values(byBank).map(({bank,total})=>({
            id:`auto_invoice_${bank}_${py}_${pm}`,
            name:`Fatura ${bank} — ${MONTHS_FULL[pm]}/${py}`,
            value:parseFloat(total.toFixed(2)),
            paid:false,
            isAutoInvoice:true,
            autoInvoiceKey:`auto_invoice_${bank}_${py}_${pm}`,
          }));
          setData(d=>({...d,fixed:[...autoFixed,...(d.fixed||[]).filter(f=>!f.isAutoInvoice)]}));
        }
        setCreditData(EMPTY_CREDIT());
      }

      // ── FIX: Calculate prev balance correctly ──
      const pm2=vm===0?11:vm-1, py2=vm===0?vy-1:vy;
      const pr=await dbGet(monthKey(py2,pm2));
      if(pr){
        const inc=(pr.incomes||[]).reduce((s,t)=>s+t.value,0);
        const exp=(pr.expenses||[]).reduce((s,t)=>s+t.value,0);
        // Only count paid fixed items for balance calculation
        const fix=(pr.fixed||[]).reduce((s,t)=>t.paid?(s+(t.value||0)):s,0);
        const inv=(pr.investments||[]).filter(e=>!isWithdrawal(e)).reduce((s,t)=>s+t.value,0);
        const bal=inc-exp-fix-inv;
        setPrevBalance(Math.max(bal,0));
      }
      setLoading(false);
    })();
  },[vm,vy,loaded]);

  // Year cache
  const loadYearCache=useCallback(async()=>{
    const cache={};
    for(let m=0;m<12;m++){const r=await dbGet(monthKey(vy,m));cache[m]=r||EMPTY_MONTH();}
    setYearCache(cache);
  },[vy]);

  // Debounced save — month data
  useEffect(()=>{
    if(!loaded||loading) return;
    clearTimeout(saveTimer.current);
    setSyncing(true);
    saveTimer.current=setTimeout(()=>{
      dbSet(monthKey(vy,vm),data).then(()=>loadYearCache()).finally(()=>setSyncing(false));
    },800);
    return ()=>clearTimeout(saveTimer.current);
  },[data,vm,vy,loaded,loading,loadYearCache]);

  // Debounced save — credit data
  useEffect(()=>{
    if(!loaded||loading) return;
    clearTimeout(creditSaveTimer.current);
    creditSaveTimer.current=setTimeout(()=>{
      dbSet(creditKey(vy,vm),creditData);
    },800);
    return ()=>clearTimeout(creditSaveTimer.current);
  },[creditData,vm,vy,loaded,loading]);

  useEffect(()=>{ if(loaded) dbSet(SETTINGS_KEY,settings); },[settings,loaded]);
  useEffect(()=>{ if(loaded) dbSet(DEBTS_KEY,debts); },[debts,loaded]);

  const expenseCats=settings.expenseCats||DEFAULT_EXPENSE_CATS;
  const catMap=Object.fromEntries(expenseCats.map(c=>[c.name,c]));
  const banks=settings.banks||DEFAULT_BANKS;

  const rawIncome=data.incomes.reduce((s,t)=>s+t.value,0);
  const totalIncome=rawIncome+prevBalance;
  const totalExpense=data.expenses.reduce((s,t)=>s+t.value,0);
  // Fixed: only paid items count toward spending
  const totalFixedPaid=data.fixed.filter(f=>f.paid).reduce((s,t)=>s+(t.value||0),0);
  const totalFixedAll=data.fixed.reduce((s,t)=>s+(t.value||0),0);
  const totalInvest=data.investments.filter(e=>!isWithdrawal(e)).reduce((s,t)=>s+t.value,0);
  const totalOut=totalExpense+totalFixedPaid+totalInvest;
  const balance=totalIncome-totalOut;

  const emergencyTotal=(settings.emergencyBase||0)+(settings.emergencyDelta||0);
  const personalTotal=(settings.personalBase||0)+(settings.personalDelta||0);

  // Credit by bank from creditData
  const bankCredit=banks.map(b=>({
    ...b,
    spent:(creditData.purchases||[]).filter(p=>p.bank===b.name).reduce((s,p)=>s+p.monthlyValue,0)
  }));

  const catData=expenseCats.map(c=>({
    ...c,
    value:data.expenses.filter(e=>e.category===c.name).reduce((s,e)=>s+e.value,0),
    budget:settings.catBudgets?.[c.name]||0
  })).filter(c=>c.value>0||c.budget>0).sort((a,b)=>b.value-a.value);
  const maxCat=Math.max(...catData.map(c=>Math.max(c.value,c.budget)),1);

  // Debt installments
  const debtInst=debts.filter(d=>!d.closed).flatMap(d=>{
    const idx=vy*12+vm-(d.startYear*12+d.startMonth);
    if(idx<0||idx>=d.installments) return [];
    const key=`${vy}-${vm}`;
    return [{id:`debt_${d.id}_${idx}`,name:`${d.name} (${idx+1}/${d.installments})`,value:d.monthlyValue,paid:d.paidMonths?.includes(key)||false,isDebt:true,debtId:d.id,debtMonthKey:key}];
  });
  const allFixed=[...data.fixed,...debtInst];
  const pendingFixed=allFixed.filter(f=>!f.paid);
  const paidFixed=allFixed.filter(f=>f.paid);
  const unpaidFixed=pendingFixed.length;

  const annualRows=MONTHS.map((_,i)=>{
    const d=yearCache[i]||EMPTY_MONTH();
    const inc=(d.incomes||[]).reduce((s,t)=>s+t.value,0);
    const exp=(d.expenses||[]).reduce((s,t)=>s+t.value,0);
    const fix=(d.fixed||[]).filter(f=>f.paid).reduce((s,t)=>s+(t.value||0),0);
    const inv=(d.investments||[]).filter(e=>!isWithdrawal(e)).reduce((s,t)=>s+t.value,0);
    return {i,inc,exp,fix,inv,out:exp+fix+inv,bal:inc-exp-fix-inv};
  });
  const annualInc=annualRows.reduce((s,r)=>s+r.inc,0);
  const annualOut=annualRows.reduce((s,r)=>s+r.out,0);
  const chartMax=Math.max(...annualRows.flatMap(r=>[r.inc,r.out]),1);

  const alerts=[];
  if(!loading&&rawIncome===0) alerts.push({type:"warn",msg:`Sem entradas em ${MONTHS_FULL[vm]}`});
  if(!loading&&balance<0&&rawIncome>0) alerts.push({type:"danger",msg:`Saldo negativo: ${fmt(Math.abs(balance))}`});
  if(!loading&&balance>0&&rawIncome>0) alerts.push({type:"ok",msg:`Você guardou ${((balance/totalIncome)*100).toFixed(0)}% da renda 👏`});
  if(!loading&&prevBalance>0) alerts.push({type:"ok",msg:`Saldo de ${MONTHS_FULL[vm===0?11:vm-1]}: +${fmt(prevBalance)}`});
  if(!loading&&unpaidFixed>0) alerts.push({type:"warn",msg:`${unpaidFixed} fixa(s)/fatura(s) pendente(s)`});
  bankCredit.forEach(b=>{if(b.limit>0&&b.spent>0){const p=(b.spent/b.limit)*100;if(p>=80)alerts.push({type:p>=100?"danger":"warn",msg:`${b.name}: ${p.toFixed(0)}% do limite`});}});

  function prevMonth(){if(vm===0){setVm(11);setVy(y=>y-1);}else setVm(m=>m-1);}
  function nextMonth(){if(vm===11){setVm(0);setVy(y=>y+1);}else setVm(m=>m+1);}

  function saveEntry(st,entry,oldEntry=null){
    if(st==="investments"){
      const od=oldEntry?reserveDelta(oldEntry,-1):{ed:0,pd:0};
      const nd=reserveDelta(entry,1);
      const ed=od.ed+nd.ed,pd=od.pd+nd.pd;
      if(ed!==0||pd!==0) setSettings(s=>({...s,emergencyDelta:(s.emergencyDelta||0)+ed,personalDelta:(s.personalDelta||0)+pd}));
    }
    setData(d=>{
      const key=st;
      if(!d[key]) return d;
      const list=[...(d[key]||[])];
      const idx=list.findIndex(i=>i.id===entry.id);
      if(idx>=0) list[idx]=entry; else list.unshift(entry);
      let newData={...d,[key]:list};
      if(st==="investments"&&isWithdrawal(entry)&&!oldEntry){
        const autoIncome={id:uid(),name:`Retirada — ${entry.type.includes("Reserva")?"Reserva de Emergência":"Meta pessoal"}`,value:entry.value,date:entry.date,autoFromWithdrawal:true,linkedInvestmentId:entry.id};
        newData={...newData,incomes:[autoIncome,...newData.incomes]};
      }
      if(st==="investments"&&isWithdrawal(entry)&&oldEntry){
        newData={...newData,incomes:newData.incomes.map(inc=>inc.linkedInvestmentId===entry.id?{...inc,value:entry.value,date:entry.date}:inc)};
      }
      return newData;
    });
    setModal(null);
  }

  function saveBulk(st,entries){
    if(!entries.length) return;
    if(st==="investments"){
      let ed=0,pd=0;entries.forEach(e=>{const d=reserveDelta(e,1);ed+=d.ed;pd+=d.pd;});
      if(ed!==0||pd!==0) setSettings(s=>({...s,emergencyDelta:(s.emergencyDelta||0)+ed,personalDelta:(s.personalDelta||0)+pd}));
    }
    setData(d=>{
      if(!d[st]) return d;
      let newData={...d,[st]:[...entries,...(d[st]||[])]};
      if(st==="investments"){
        const autoIncomes=entries.filter(e=>isWithdrawal(e)).map(e=>({id:uid(),name:`Retirada — ${e.type.includes("Reserva")?"Reserva de Emergência":"Meta pessoal"}`,value:e.value,date:e.date,autoFromWithdrawal:true,linkedInvestmentId:e.id}));
        if(autoIncomes.length) newData={...newData,incomes:[...autoIncomes,...newData.incomes]};
      }
      return newData;
    });
    setToast(`✅ ${entries.length} lançamento(s) adicionado(s)`);
  }

  function deleteEntry(st,id){
    if(st==="investments"){
      const e=data.investments.find(i=>i.id===id);
      if(e){
        const{ed,pd}=reserveDelta(e,-1);
        if(ed!==0||pd!==0) setSettings(s=>({...s,emergencyDelta:(s.emergencyDelta||0)+ed,personalDelta:(s.personalDelta||0)+pd}));
        if(isWithdrawal(e)){setData(d=>({...d,investments:d.investments.filter(i=>i.id!==id),incomes:d.incomes.filter(i=>i.linkedInvestmentId!==id)}));return;}
      }
    }
    if(data[st]) setData(d=>({...d,[st]:(d[st]||[]).filter(i=>i.id!==id)}));
  }

  function toggleFixed(id){setData(d=>({...d,fixed:(d.fixed||[]).map(f=>f.id===id?{...f,paid:!f.paid}:f)}));}
  function toggleDebtPaid(debtId,mk){setDebts(ds=>ds.map(d=>{if(d.id!==debtId)return d;const paid=d.paidMonths||[];const wasPaid=paid.includes(mk);return{...d,paidMonths:wasPaid?paid.filter(k=>k!==mk):[...paid,mk],paidCount:wasPaid?(d.paidCount||0)-1:(d.paidCount||0)+1};}));}

  const openModal=useCallback((type,entry)=>setModal({type,entry}),[]);
  const closeModal=useCallback(()=>setModal(null),[]);
  const fabType={incomes:"income",expenses:"expense",fixed:"fixed",investments:"investment"}[page];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{--bg:#07070f;--surface:#0d0d1a;--card:#111120;--border:#1a1a2e;--border2:#22223a;--text:#eeeeff;--muted:#6060a0;--green:#00d68f;--wine:#c0392b;--accent:#9b8cff;--gold:#ffd166;--blue:#4d9fff;}
        html,body{background:var(--bg);color:var(--text);font-family:'Sora',sans-serif;-webkit-font-smoothing:antialiased;}
        .app{min-height:100vh;padding-bottom:70px;max-width:640px;margin:0 auto;}
        .topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 9px;position:sticky;top:0;z-index:90;background:var(--bg);border-bottom:1px solid var(--border);}
        .logo{font-size:16px;font-weight:700;letter-spacing:-.5px;}.logo em{color:var(--accent);font-style:normal;}
        .greeting{font-size:10px;color:var(--muted);margin-left:6px;}
        .mnav{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:6px 10px;}
        .mnav button{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0 3px;}
        .mlbl{font-size:11px;font-weight:600;min-width:108px;text-align:center;white-space:nowrap;}
        .pg{padding:12px 13px 6px;display:flex;flex-direction:column;gap:11px;}
        .st{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);}
        .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:13px;}
        .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;}
        .mc{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:10px;position:relative;overflow:hidden;}
        .mc::after{content:'';position:absolute;inset:0;opacity:.05;pointer-events:none;}
        .mc.g::after{background:var(--green);}.mc.w::after{background:var(--wine);}.mc.p::after{background:var(--accent);}.mc.b::after{background:var(--blue);}.mc.gold::after{background:var(--gold);}.mc.gr::after{background:#aaa;}
        .ml{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;}
        .mv{font-size:13px;font-weight:700;letter-spacing:-.3px;}
        .mv.g{color:var(--green);}.mv.w{color:var(--wine);}.mv.p{color:var(--accent);}.mv.b{color:var(--blue);}.mv.gold{color:var(--gold);}.mv.gr{color:#aaa;}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
        .txlist{display:flex;flex-direction:column;gap:6px;}
        .txi{display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:11px;cursor:pointer;user-select:none;}
        .txi:active{border-color:var(--border2);}
        .txicon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
        .txinfo{flex:1;min-width:0;}.txd{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .txm{font-size:9px;color:var(--muted);margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;}
        .txa{font-size:12px;font-weight:700;flex-shrink:0;}
        .tdel{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:5px 4px;flex-shrink:0;}
        .badge{display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:20px;}
        .chip{display:inline-flex;align-items:center;font-size:8px;font-weight:700;padding:1px 5px;border-radius:20px;}
        .checkrow{display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:11px;cursor:pointer;user-select:none;}
        .checkrow:active{border-color:var(--border2);}
        .checkbox{width:18px;height:18px;border-radius:5px;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
        .checkbox.on{background:var(--green);border-color:var(--green);}
        .fab{position:fixed;bottom:76px;right:16px;width:50px;height:50px;border-radius:16px;background:var(--accent);border:none;color:#fff;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(155,140,255,.4);z-index:80;}
        .fab:active{transform:scale(.92);}
        .bnav{position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--border);display:flex;justify-content:space-around;align-items:center;height:62px;z-index:80;overflow-x:auto;}
        .nb{background:none;border:none;color:var(--muted);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:'Sora',sans-serif;font-size:7px;font-weight:600;letter-spacing:.2px;text-transform:uppercase;padding:5px 2px;min-width:32px;flex-shrink:0;transition:color .12s;}
        .nb.active{color:var(--accent);}.nbi{font-size:15px;line-height:1;}
        .mhdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
        .mtitle{font-size:14px;font-weight:700;}
        .mclose{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:2px 6px;}
        .fl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:5px;display:block;}
        .fi{width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:'Sora',sans-serif;font-size:14px;border-radius:10px;padding:11px 12px;outline:none;transition:border-color .15s;-webkit-appearance:none;}
        .fi:focus{border-color:var(--accent);}.fg{margin-bottom:10px;}
        .frow{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
        .catgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;}
        .catopt{border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:'Sora',sans-serif;font-size:9px;font-weight:500;border-radius:8px;padding:7px 4px;cursor:pointer;text-align:center;line-height:1.3;transition:all .12s;}
        .savebtn{width:100%;background:var(--accent);color:#fff;border:none;font-family:'Sora',sans-serif;font-size:14px;font-weight:700;border-radius:11px;padding:13px;cursor:pointer;margin-top:5px;}
        .savebtn:active{opacity:.85;}.savebtn:disabled{opacity:.4;cursor:not-allowed;}
        select.fi{appearance:none;-webkit-appearance:none;}
        .divider{height:1px;background:var(--border);margin:13px 0;}
        .notesarea{width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:'Sora',sans-serif;font-size:13px;border-radius:10px;padding:10px;resize:vertical;min-height:70px;outline:none;}
        .notesarea:focus{border-color:var(--accent);}
        .empty{text-align:center;color:var(--muted);font-size:12px;padding:28px 0;line-height:1.7;}
        .alert{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;font-size:11px;font-weight:500;}
        .alert.ok{background:rgba(0,214,143,.1);border:1px solid rgba(0,214,143,.2);color:var(--green);}
        .alert.warn{background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.2);color:#ffd166;}
        .alert.danger{background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.3);color:var(--wine);}
        .bulkbtn{background:var(--surface);border:1px solid var(--border);color:var(--muted);font-family:'Sora',sans-serif;font-size:11px;font-weight:600;border-radius:9px;padding:7px 12px;cursor:pointer;}
        .bulkbtn:active{border-color:var(--accent);color:var(--accent);}
        .chart{display:flex;align-items:flex-end;gap:4px;}
        .cgrp{display:flex;align-items:flex-end;gap:2px;flex:1;}
        .cbar{flex:1;border-radius:3px 3px 0 0;min-height:2px;transition:height .5s ease;}
        .clbl{font-size:7px;text-align:center;margin-top:3px;}
        .atable{width:100%;border-collapse:collapse;font-size:11px;}
        .atable th{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:6px 5px;text-align:right;}
        .atable th:first-child{text-align:left;}
        .atable td{padding:6px 5px;text-align:right;border-top:1px solid var(--border);}
        .atable td:first-child{text-align:left;font-weight:600;font-size:10px;}
        .atable tr.cur td{background:rgba(155,140,255,.07);}
        .atable tfoot td{border-top:2px solid var(--border2);font-weight:700;}
        .section-sep{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);padding:8px 0 5px;display:flex;align-items:center;gap:8px;}
        .section-sep::after{content:'';flex:1;height:1px;background:var(--border);}
        .loading-overlay{display:flex;align-items:center;justify-content:center;padding:40px;color:var(--muted);font-size:13px;}
      `}</style>

      <div className="app">
        <div className="topbar">
          <div className="logo">Fin<em>Track</em><span className="greeting">Olá, {settings.name}!{syncing&&" ☁️"}</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div className="mnav">
              <button onClick={prevMonth}>‹</button>
              <span className="mlbl">{MONTHS_FULL[vm]} {vy}</span>
              <button onClick={nextMonth}>›</button>
            </div>
            <button onClick={()=>supabase.auth.signOut()} style={{background:"none",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"'Sora',sans-serif",fontSize:10,borderRadius:8,padding:"5px 8px",cursor:"pointer"}}>Sair</button>
          </div>
        </div>

        {loading&&<div className="loading-overlay">Carregando {MONTHS_FULL[vm]}...</div>}

        {!loading&&page==="dashboard"&&(
          <div className="pg">
            {alerts.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6}}>{alerts.map((a,i)=><div key={i} className={`alert ${a.type}`}><span>{a.type==="ok"?"✅":a.type==="warn"?"⚠️":"🚨"}</span>{a.msg}</div>)}</div>}
            <div>
              <div className="st" style={{marginBottom:8}}>Resumo de {MONTHS_FULL[vm]}</div>
              <div className="metrics">
                {[
                  {l:"Entradas",v:fmt(rawIncome),c:"g"},
                  {l:"Gastos",v:fmt(totalExpense),c:"w"},
                  {l:"Fixas",v:fmt(totalFixedAll),c:"w"},
                  {l:"Investido",v:fmt(totalInvest),c:"gold"},
                  {l:"Saldo ant.",v:fmt(prevBalance),c:"gr"},
                  {l:"Saldo",v:fmt(balance),c:"p"},
                ].map(m=>(
                  <div key={m.l} className={`mc ${m.c}`}><div className="ml">{m.l}</div><div className={`mv ${m.c}`}>{m.v}</div></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="st" style={{marginBottom:8}}>Evolução — {vy}</div>
              <div style={{display:"flex",gap:10,marginBottom:6}}>
                {[["var(--green)","Entradas"],["var(--wine)","Saídas"]].map(([c,l])=>(
                  <span key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"var(--muted)"}}><span style={{width:10,height:10,borderRadius:2,background:c,display:"inline-block"}}/>{l}</span>
                ))}
              </div>
              <div className="chart" style={{height:70}}>
                {annualRows.map((r,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div className="cgrp">
                      <div className="cbar" style={{background:r.i===vm?"var(--green)":"rgba(0,214,143,.28)",height:`${Math.max((r.inc/chartMax)*70,r.inc>0?2:0)}px`}}/>
                      <div className="cbar" style={{background:r.i===vm?"var(--wine)":"rgba(192,57,43,.35)",height:`${Math.max((r.out/chartMax)*70,r.out>0?2:0)}px`}}/>
                    </div>
                    <div className="clbl" style={{color:r.i===vm?"var(--accent)":"var(--muted)",fontWeight:r.i===vm?700:400}}>{MONTHS[i]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="row2">
              <div className="card" style={{textAlign:"center"}}>
                <div className="st" style={{marginBottom:8}}>Saldo</div>
                <Donut size={130} thick={23} data={[{color:"var(--green)",value:totalIncome},{color:"var(--wine)",value:totalOut}]} label={fmt(balance)} sublabel={balance>=0?"positivo":"negativo"}/>
                <div style={{fontSize:9,color:"var(--muted)",marginTop:6}}>{totalIncome>0?((balance/totalIncome)*100).toFixed(1):0}% da renda</div>
              </div>
              <div className="card">
                <div className="st" style={{marginBottom:8}}>Crédito por banco</div>
                <Donut size={120} thick={21} data={bankCredit.filter(b=>b.spent>0).map(b=>({color:b.color,value:b.spent}))} label={fmt(bankCredit.reduce((s,b)=>s+b.spent,0))} sublabel="próx. fatura"/>
                <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
                  {bankCredit.filter(b=>b.spent>0).map(b=>{
                    const pct=b.limit>0?Math.min((b.spent/b.limit)*100,100):0;
                    return (<div key={b.id}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                        <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:7,height:7,borderRadius:"50%",background:b.color,display:"inline-block"}}/>{b.name}</span>
                        <span style={{color:pct>90?"var(--wine)":pct>70?"var(--gold)":"var(--muted)"}}>{fmt(b.spent)}{b.limit?` / ${fmt(b.limit)}`:""}</span>
                      </div>
                      {b.limit>0&&<div style={{height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,borderRadius:2,background:pct>90?"var(--wine)":pct>70?"var(--gold)":b.color}}/></div>}
                    </div>);
                  })}
                  {bankCredit.every(b=>!b.spent)&&<div style={{fontSize:9,color:"var(--muted)",textAlign:"center"}}>Sem compras no crédito este mês</div>}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="st" style={{marginBottom:10}}>Metas & Reservas</div>
              <GoalBar label="Reserva de Emergência" icon="🛡️" current={emergencyTotal} goal={settings.emergencyGoal} color="var(--green)"/>
              <GoalBar label={settings.personalGoalName} icon="🎯" current={personalTotal} goal={settings.personalGoalValue} color="var(--accent)"/>
            </div>
            {catData.length>0&&(
              <div className="card">
                <div className="st" style={{marginBottom:10}}>Gastos por categoria (débito/pix)</div>
                {catData.map(c=>{
                  const hasBudget=c.budget>0,pct=hasBudget?Math.min((c.value/c.budget)*100,100):0;
                  const over=hasBudget&&c.value>c.budget,warn=hasBudget&&pct>=80&&!over;
                  return (<div key={c.name} style={{marginBottom:9}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:500}}>{c.icon} {c.name}</span>
                      <span style={{fontSize:10,display:"flex",gap:5,alignItems:"center"}}>
                        {over&&<span style={{color:"var(--wine)",fontSize:9,fontWeight:700}}>⚠ estourou</span>}
                        {warn&&<span style={{color:"var(--gold)",fontSize:9,fontWeight:700}}>⚡ quase</span>}
                        <span style={{color:"var(--muted)"}}>{fmt(c.value)}{hasBudget?` / ${fmt(c.budget)}`:""}</span>
                      </span>
                    </div>
                    <div style={{height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:3,transition:"width .6s",width:`${hasBudget?pct:(c.value/maxCat)*100}%`,background:over?"var(--wine)":warn?"var(--gold)":c.color}}/>
                    </div>
                  </div>);
                })}
              </div>
            )}
            <div className="card">
              <div className="st" style={{marginBottom:8}}>Observações</div>
              <textarea className="notesarea" placeholder="Ajustes, onde passou do esperado, decisões pro próximo mês…" value={data.notes||""} onChange={e=>setData(d=>({...d,notes:e.target.value}))}/>
            </div>
          </div>
        )}

        {!loading&&page==="incomes"&&(
          <div className="pg">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="st">Entradas — {MONTHS_FULL[vm]}</div>
              <div style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{fmt(rawIncome)}</div>
            </div>
            {prevBalance>0&&<div style={{background:"rgba(0,214,143,.08)",border:"1px solid rgba(0,214,143,.2)",borderRadius:10,padding:"9px 12px",fontSize:11,color:"var(--green)",fontWeight:500}}>✅ Saldo anterior: +{fmt(prevBalance)}</div>}
            <button className="bulkbtn" onClick={()=>openModal("bulk_income")}>📋 Colar em lote</button>
            {(data.incomes||[]).length===0?<div className="empty">Nenhuma entrada ainda.<br/>Toque no <strong style={{color:"var(--accent)"}}>+</strong> ou cole em lote.</div>
              :<div className="txlist">{(data.incomes||[]).map(e=>(
                <div key={e.id} className="txi" onClick={()=>!e.autoFromWithdrawal&&openModal("income",e)}>
                  <div className="txicon" style={{background:e.autoFromWithdrawal?"rgba(155,140,255,.15)":"#00d68f22"}}>{e.autoFromWithdrawal?"🔄":"💰"}</div>
                  <div className="txinfo">
                    <div className="txd">{e.name}</div>
                    <div className="txm">{e.date?.slice(5).split("-").reverse().join("/")} {e.autoFromWithdrawal&&<span style={{color:"var(--accent)",fontSize:8,fontWeight:700}}>auto</span>}</div>
                  </div>
                  <div className="txa" style={{color:"var(--green)"}}>+{fmt(e.value)}</div>
                  {!e.autoFromWithdrawal&&<button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("incomes",e.id);}}>✕</button>}
                </div>
              ))}</div>}
          </div>
        )}

        {!loading&&page==="expenses"&&(
          <div className="pg">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="st">Gastos — Débito/PIX — {MONTHS_FULL[vm]}</div>
              <div style={{fontSize:13,fontWeight:700,color:"var(--wine)"}}>{fmt(totalExpense)}</div>
            </div>
            <div style={{background:"rgba(155,140,255,.08)",border:"1px solid rgba(155,140,255,.2)",borderRadius:10,padding:"9px 12px",fontSize:11,color:"var(--accent)"}}>
              💳 Gastos no crédito → registre em <strong>Cartões</strong>
            </div>
            <button className="bulkbtn" onClick={()=>openModal("bulk_expense")}>📋 Colar em lote</button>
            {(data.expenses||[]).length===0?<div className="empty">Nenhum gasto ainda.<br/>Toque no <strong style={{color:"var(--accent)"}}>+</strong> ou cole em lote.</div>
              :<div className="txlist">{(data.expenses||[]).map(e=>{
                const cat=catMap[e.category]||{icon:"📌",color:"#888"};
                const bk=banks.find(b=>b.name===e.bank);
                const d=e.date?e.date.slice(5).split("-").reverse().join("/"):"";
                return (
                  <div key={e.id} className="txi" onClick={()=>openModal("expense",e)}>
                    <div className="txicon" style={{background:cat.color+"33"}}>{cat.icon}</div>
                    <div className="txinfo">
                      <div className="txd">{e.description||e.category}</div>
                      <div className="txm"><span>{d}</span>{bk&&<span className="chip" style={{background:bk.color+"33",color:bk.color}}>{bk.name}</span>}<span>{e.method}</span></div>
                    </div>
                    <div className="txa" style={{color:"var(--wine)"}}>-{fmt(e.value)}</div>
                    <button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("expenses",e.id);}}>✕</button>
                  </div>
                );
              })}</div>}
          </div>
        )}

        {!loading&&page==="fixed"&&(
          <div className="pg">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="st">Despesas Fixas & Faturas</div>
              <div style={{fontSize:13,fontWeight:700,color:"var(--wine)"}}>{fmt(totalFixedAll)}</div>
            </div>
            <button className="bulkbtn" onClick={()=>openModal("bulk_fixed")}>📋 Colar em lote</button>
            {allFixed.length===0?<div className="empty">Nenhuma despesa fixa.<br/>Toque no <strong style={{color:"var(--accent)"}}>+</strong> ou cole em lote.</div>:<>
              {pendingFixed.length>0&&<>
                <div className="section-sep">A pagar ({pendingFixed.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {pendingFixed.map(e=>(
                    <div key={e.id} className="checkrow" onClick={()=>e.isDebt?toggleDebtPaid(e.debtId,e.debtMonthKey):toggleFixed(e.id)}>
                      <div className="checkbox"/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500}}>{e.name}
                          {e.isDebt&&<span style={{marginLeft:6,fontSize:9,color:"var(--accent)",fontWeight:700}}>parcela</span>}
                          {e.isAutoInvoice&&<span style={{marginLeft:6,fontSize:9,color:"var(--gold)",fontWeight:700}}>fatura auto</span>}
                        </div>
                      </div>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--wine)"}}>{fmt(e.value)}</div>
                      {!e.isDebt&&!e.isAutoInvoice&&<><button className="tdel" onClick={ev=>{ev.stopPropagation();openModal("fixed",e);}}>✏️</button><button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("fixed",e.id);}}>✕</button></>}
                      {e.isAutoInvoice&&<button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("fixed",e.id);}}>✕</button>}
                    </div>
                  ))}
                </div>
              </>}
              {paidFixed.length>0&&<>
                <div className="section-sep">Pagas ({paidFixed.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {paidFixed.map(e=>(
                    <div key={e.id} className="checkrow" onClick={()=>e.isDebt?toggleDebtPaid(e.debtId,e.debtMonthKey):toggleFixed(e.id)}>
                      <div className="checkbox on"><span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span></div>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,textDecoration:"line-through",color:"var(--muted)"}}>{e.name}</div></div>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{fmt(e.value)}</div>
                      {!e.isDebt&&!e.isAutoInvoice&&<><button className="tdel" onClick={ev=>{ev.stopPropagation();openModal("fixed",e);}}>✏️</button><button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("fixed",e.id);}}>✕</button></>}
                    </div>
                  ))}
                </div>
              </>}
            </>}
          </div>
        )}

        {!loading&&page==="cards"&&(
          <CartoesPage banks={banks} expenseCats={expenseCats} vm={vm} vy={vy} creditData={creditData} setCreditData={setCreditData} monthData={data} setMonthData={setData}/>
        )}

        {!loading&&page==="investments"&&(
          <div className="pg">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="st">Reservas & Investimentos</div>
              <div style={{fontSize:13,fontWeight:700,color:"var(--gold)"}}>{fmt(totalInvest)}</div>
            </div>
            <button className="bulkbtn" onClick={()=>openModal("bulk_investment")}>📋 Colar em lote</button>
            <div className="card">
              <GoalBar label="Reserva de Emergência" icon="🛡️" current={emergencyTotal} goal={settings.emergencyGoal} color="var(--green)"/>
              <GoalBar label={settings.personalGoalName} icon="🎯" current={personalTotal} goal={settings.personalGoalValue} color="var(--accent)"/>
            </div>
            {(data.investments||[]).length===0?<div className="empty">Nenhum lançamento.<br/>Toque no <strong style={{color:"var(--accent)"}}>+</strong> ou cole em lote.</div>
              :<div className="txlist">{(data.investments||[]).map(e=>{
                const isW=isWithdrawal(e);
                return (
                  <div key={e.id} className="txi" onClick={()=>openModal("investment",e)}>
                    <div className="txicon" style={{background:isW?"var(--wine)22":"var(--gold)22"}}>{isW?"📤":"💰"}</div>
                    <div className="txinfo">
                      <div className="txd">{e.name||e.type}</div>
                      <div className="txm">{e.date?.slice(5).split("-").reverse().join("/")} · {e.type}{isW&&<span style={{color:"var(--green)",fontSize:8,fontWeight:700}}>→ entrada auto</span>}</div>
                    </div>
                    <div className="txa" style={{color:isW?"var(--wine)":"var(--gold)"}}>{isW?"-":"+"}{fmt(e.value)}</div>
                    <button className="tdel" onClick={ev=>{ev.stopPropagation();deleteEntry("investments",e.id);}}>✕</button>
                  </div>
                );
              })}</div>}
          </div>
        )}

        {!loading&&page==="debts"&&<DebtsPage debts={debts} setDebts={setDebts} vm={vm} vy={vy}/>}

        {!loading&&page==="annual"&&(
          <div className="pg">
            <div className="st">Visão Anual — {vy}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
              {[{l:"Entradas",v:fmt(annualInc),c:"g"},{l:"Saídas",v:fmt(annualOut),c:"w"},{l:"Saldo",v:fmt(annualInc-annualOut),c:"p"}].map(m=>(
                <div key={m.l} className={`mc ${m.c}`}><div className="ml">{m.l}</div><div className={`mv ${m.c}`}>{m.v}</div></div>
              ))}
            </div>
            <div className="card">
              <div className="st" style={{marginBottom:8}}>Entradas vs Saídas</div>
              <div className="chart" style={{height:90}}>
                {annualRows.map((r,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div className="cgrp">
                      <div className="cbar" style={{background:r.i===vm?"var(--green)":"rgba(0,214,143,.3)",height:`${Math.max((r.inc/chartMax)*90,r.inc>0?2:0)}px`}}/>
                      <div className="cbar" style={{background:r.i===vm?"var(--wine)":"rgba(192,57,43,.35)",height:`${Math.max((r.out/chartMax)*90,r.out>0?2:0)}px`}}/>
                    </div>
                    <div className="clbl" style={{color:r.i===vm?"var(--accent)":"var(--muted)",fontWeight:r.i===vm?700:400}}>{MONTHS[i]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{overflowX:"auto"}}>
              <table className="atable">
                <thead><tr><th>Mês</th><th>Entrada</th><th>Gastos</th><th>Fixas</th><th>Invest.</th><th>Saldo</th></tr></thead>
                <tbody>{annualRows.map(r=>(
                  <tr key={r.i} className={r.i===vm?"cur":""}>
                    <td>{MONTHS[r.i]}</td>
                    <td style={{color:"var(--green)"}}>{r.inc>0?fmt(r.inc):"—"}</td>
                    <td style={{color:"var(--wine)"}}>{r.exp>0?fmt(r.exp):"—"}</td>
                    <td style={{color:"var(--blue)"}}>{r.fix>0?fmt(r.fix):"—"}</td>
                    <td style={{color:"var(--gold)"}}>{r.inv>0?fmt(r.inv):"—"}</td>
                    <td style={{color:r.bal>=0?(r.inc>0?"var(--green)":"var(--muted)"):"var(--wine)"}}>{r.inc>0||r.out>0?fmt(r.bal):"—"}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr>
                  <td>Total</td><td style={{color:"var(--green)"}}>{fmt(annualInc)}</td>
                  <td style={{color:"var(--wine)"}}>{fmt(annualRows.reduce((s,r)=>s+r.exp,0))}</td>
                  <td style={{color:"var(--blue)"}}>{fmt(annualRows.reduce((s,r)=>s+r.fix,0))}</td>
                  <td style={{color:"var(--gold)"}}>{fmt(annualRows.reduce((s,r)=>s+r.inv,0))}</td>
                  <td style={{color:annualInc>=annualOut?"var(--green)":"var(--wine)"}}>{fmt(annualInc-annualOut)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}

        {!loading&&page==="settings"&&<SettingsPage settings={settings} setSettings={setSettings} data={data} setData={setData} userEmail={session?.user?.email} expenseCats={expenseCats}/>}

        <div className="bnav">
          {NAV.map(n=>(
            <button key={n.id} className={`nb${page===n.id?" active":""}`} onClick={()=>setPage(n.id)}>
              <span className="nbi">{n.icon}</span>{n.label}
            </button>
          ))}
        </div>
      </div>

      {fabType&&<button className="fab" onClick={()=>openModal(fabType)}>+</button>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}

      {modal&&(
        <Modal onClose={closeModal} tall={modal.type?.startsWith("bulk")||modal.type==="expense"}>
          {modal.type==="bulk_income"&&<BulkPanel type="income" banks={banks} expenseCats={expenseCats} vy={vy} vm={vm} onClose={closeModal} onConfirm={i=>{saveBulk("incomes",i);closeModal();}}/>}
          {modal.type==="bulk_expense"&&<BulkPanel type="expense" banks={banks} expenseCats={expenseCats} vy={vy} vm={vm} onClose={closeModal} onConfirm={i=>{saveBulk("expenses",i);closeModal();}}/>}
          {modal.type==="bulk_fixed"&&<BulkPanel type="fixed" banks={banks} expenseCats={expenseCats} vy={vy} vm={vm} onClose={closeModal} onConfirm={i=>{saveBulk("fixed",i);closeModal();}}/>}
          {modal.type==="bulk_investment"&&<BulkPanel type="investment" banks={banks} expenseCats={expenseCats} vy={vy} vm={vm} onClose={closeModal} onConfirm={i=>{saveBulk("investments",i);closeModal();}}/>}
          {["income","expense","fixed","investment"].includes(modal.type)&&(
            <EntryModal type={modal.type} entry={modal.entry} banks={banks} expenseCats={expenseCats} onClose={closeModal} onSave={saveEntry} vm={vm} vy={vy}/>
          )}
        </Modal>
      )}
    </>
  );
}

// ─── DEBTS ────────────────────────────────────────────────────────────────────
function DebtsPage({debts,setDebts,vm,vy}){
  const [showForm,setShowForm]=useState(false);
  const active=debts.filter(d=>!d.closed),closed=debts.filter(d=>d.closed);
  return (
    <div className="pg">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">Dívidas & Parcelamentos</div>
        <button onClick={()=>setShowForm(s=>!s)} style={{background:"var(--accent)",border:"none",color:"#fff",fontFamily:"'Sora',sans-serif",fontSize:11,fontWeight:700,borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>{showForm?"Cancelar":"+ Nova"}</button>
      </div>
      {showForm&&<DebtForm onSave={d=>{setDebts(ds=>[...ds,d]);setShowForm(false);}} vm={vm} vy={vy}/>}
      {active.length===0&&!showForm&&<div className="empty">Nenhuma dívida ativa.<br/>Toque em <strong style={{color:"var(--accent)"}}>+ Nova</strong> para adicionar.</div>}
      {active.map(d=>{
        const pct=Math.min(((d.paidCount||0)/d.installments)*100,100);
        const remaining=d.totalValue-(d.paidCount||0)*d.monthlyValue;
        const curAbs=vy*12+vm,startAbs=d.startYear*12+d.startMonth;
        const dueThisMonth=curAbs>=startAbs&&curAbs<startAbs+d.installments;
        const key=`${vy}-${vm}`;
        const paidThisMonth=d.paidMonths?.includes(key)||false;
        return (
          <div key={d.id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div><div style={{fontSize:13,fontWeight:700}}>{d.name}</div><div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>{d.installments}x de {fmt(d.monthlyValue)} · Total: {fmt(d.totalValue)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:"var(--wine)"}}>{fmt(Math.max(remaining,0))}</div><div style={{fontSize:9,color:"var(--muted)"}}>restando</div></div>
            </div>
            <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",width:`${pct}%`,background:"var(--green)",borderRadius:3}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--muted)",marginBottom:10}}>
              <span>{d.paidCount||0}/{d.installments} pagas ({pct.toFixed(0)}%)</span>
              {dueThisMonth&&<span style={{color:paidThisMonth?"var(--green)":"var(--gold)",fontWeight:600}}>{paidThisMonth?"✓ Paga este mês":"⚡ Vence este mês"}</span>}
            </div>
            {dueThisMonth&&(
              <button onClick={()=>setDebts(ds=>ds.map(x=>{
                if(x.id!==d.id) return x;
                const paid=x.paidMonths||[];
                const wasPaid=paid.includes(key);
                return{...x,paidMonths:wasPaid?paid.filter(k=>k!==key):[...paid,key],paidCount:wasPaid?(x.paidCount||0)-1:(x.paidCount||0)+1};
              }))}
                style={{width:"100%",background:paidThisMonth?"rgba(0,214,143,.1)":"var(--surface)",border:`1px solid ${paidThisMonth?"var(--green)":"var(--border)"}`,color:paidThisMonth?"var(--green)":"var(--muted)",fontFamily:"'Sora',sans-serif",fontSize:12,fontWeight:600,borderRadius:9,padding:"8px 0",cursor:"pointer",marginBottom:8}}>
                {paidThisMonth?`✓ Parcela de ${MONTHS_FULL[vm]} paga`:`Marcar parcela de ${MONTHS_FULL[vm]} como paga`}
              </button>
            )}
            <div style={{display:"flex",gap:7}}>
              <button onClick={()=>setDebts(ds=>ds.map(x=>x.id===d.id?{...x,closed:true}:x))} style={{flex:1,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--green)",fontFamily:"'Sora',sans-serif",fontSize:11,fontWeight:600,borderRadius:8,padding:"6px 0",cursor:"pointer"}}>✓ Quitar tudo</button>
              <button onClick={()=>setDebts(ds=>ds.filter(x=>x.id!==d.id))} style={{background:"var(--surface)",border:"1px solid var(--wine)",color:"var(--wine)",fontFamily:"'Sora',sans-serif",fontSize:11,fontWeight:600,borderRadius:8,padding:"6px 12px",cursor:"pointer"}}>Apagar</button>
            </div>
          </div>
        );
      })}
      {closed.length>0&&<>{closed.map(d=>(
        <div key={d.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:11,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:12,fontWeight:600,color:"var(--muted)",textDecoration:"line-through"}}>{d.name}</div><div style={{fontSize:10,color:"var(--muted)"}}>{d.installments}x de {fmt(d.monthlyValue)}</div></div>
          <button onClick={()=>setDebts(ds=>ds.filter(x=>x.id!==d.id))} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:14}}>✕</button>
        </div>
      ))}</>}
    </div>
  );
}

function DebtForm({onSave,vm,vy}){
  const [f,setF]=useState({name:"",totalValue:"",installments:"",startMonth:String(vm),startYear:String(vy)});
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const tv=parseFloat(String(f.totalValue).replace(",","."))||0;
  const inst=parseInt(f.installments)||0;
  const monthly=inst>0?tv/inst:0;
  return (
    <div className="card">
      <div className="fg"><label className="fl">Nome da dívida</label><input className="fi" placeholder="Ex: Carro, Funileiro…" value={f.name} onChange={e=>upd("name",e.target.value)}/></div>
      <div className="frow">
        <div className="fg"><label className="fl">Valor total (R$)</label><input className="fi" type="number" inputMode="decimal" value={f.totalValue} onChange={e=>upd("totalValue",e.target.value)}/></div>
        <div className="fg"><label className="fl">Nº de parcelas</label><input className="fi" type="number" inputMode="numeric" value={f.installments} onChange={e=>upd("installments",e.target.value)}/></div>
      </div>
      {monthly>0&&<div style={{background:"rgba(155,140,255,.1)",border:"1px solid rgba(155,140,255,.25)",borderRadius:9,padding:"8px 11px",marginBottom:10,fontSize:12,color:"var(--accent)",fontWeight:600}}>Parcela mensal: {fmt(monthly)}</div>}
      <div className="frow">
        <div className="fg"><label className="fl">Mês início</label><select className="fi" value={f.startMonth} onChange={e=>upd("startMonth",e.target.value)}>{MONTHS_FULL.map((m,i)=><option key={i} value={i}>{m}</option>)}</select></div>
        <div className="fg"><label className="fl">Ano</label><input className="fi" type="number" value={f.startYear} onChange={e=>upd("startYear",e.target.value)}/></div>
      </div>
      <button className="savebtn" onClick={()=>{if(!f.name||!tv||!inst)return;onSave({id:uid(),name:f.name,totalValue:tv,installments:inst,monthlyValue:parseFloat(monthly.toFixed(2)),startMonth:parseInt(f.startMonth),startYear:parseInt(f.startYear),paidMonths:[],paidCount:0,closed:false});}} disabled={!f.name||!tv||!inst}>Adicionar dívida</button>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function SettingsPage({settings,setSettings,data,setData,userEmail,expenseCats}){
  const banks=settings.banks||DEFAULT_BANKS;
  const [newCat,setNewCat]=useState({name:"",icon:"📌",color:"#7b241c"});
  const [showNewCat,setShowNewCat]=useState(false);
  function addCat(){if(!newCat.name.trim())return;setSettings(s=>({...s,expenseCats:[...(s.expenseCats||DEFAULT_EXPENSE_CATS),{id:uid(),...newCat}]}));setNewCat({name:"",icon:"📌",color:"#7b241c"});setShowNewCat(false);}
  function deleteCat(id){setSettings(s=>({...s,expenseCats:(s.expenseCats||DEFAULT_EXPENSE_CATS).filter(c=>c.id!==id)}));}
  return (
    <div className="pg">
      <div className="st">Conta</div>
      <div className="card">
        <div style={{fontSize:12,color:"var(--muted)"}}>Logado como</div>
        <div style={{fontSize:13,fontWeight:600,marginTop:4}}>{userEmail}</div>
        <button onClick={()=>supabase.auth.signOut()} style={{marginTop:12,background:"var(--surface)",border:"1px solid var(--wine)",color:"var(--wine)",fontFamily:"'Sora',sans-serif",fontSize:12,fontWeight:600,borderRadius:9,padding:"8px 16px",cursor:"pointer"}}>Sair da conta</button>
      </div>
      <div className="divider"/>
      <div className="st">Personalização</div>
      <div className="card"><div className="fg"><label className="fl">Como quer ser chamado</label><input className="fi" value={settings.name} onChange={e=>setSettings(s=>({...s,name:e.target.value}))}/></div></div>
      <div className="divider"/>
      <div className="st">Reserva de Emergência 🛡️</div>
      <div className="card">
        <div className="frow">
          <div className="fg"><label className="fl">Meta (R$)</label><input className="fi" type="number" value={settings.emergencyGoal} onChange={e=>setSettings(s=>({...s,emergencyGoal:parseFloat(e.target.value)||0}))}/></div>
          <div className="fg"><label className="fl">Saldo inicial (R$)</label><input className="fi" type="number" value={settings.emergencyBase||0} onChange={e=>setSettings(s=>({...s,emergencyBase:parseFloat(e.target.value)||0}))}/></div>
        </div>
        <div style={{fontSize:10,color:"var(--muted)"}}>Saldo inicial = o que você já tinha antes de usar o app.</div>
      </div>
      <div className="st">Meta Pessoal 🎯</div>
      <div className="card">
        <div className="fg"><label className="fl">Nome da meta</label><input className="fi" value={settings.personalGoalName} onChange={e=>setSettings(s=>({...s,personalGoalName:e.target.value}))}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor da meta (R$)</label><input className="fi" type="number" value={settings.personalGoalValue} onChange={e=>setSettings(s=>({...s,personalGoalValue:parseFloat(e.target.value)||0}))}/></div>
          <div className="fg"><label className="fl">Saldo inicial (R$)</label><input className="fi" type="number" value={settings.personalBase||0} onChange={e=>setSettings(s=>({...s,personalBase:parseFloat(e.target.value)||0}))}/></div>
        </div>
      </div>
      <div className="divider"/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">Cartões & Bancos 💳</div>
        <button onClick={()=>setSettings(s=>({...s,banks:[...s.banks,{id:uid(),name:"Novo banco",color:"#555577",limit:0}]}))} style={{background:"var(--accent)",border:"none",color:"#fff",fontFamily:"'Sora',sans-serif",fontSize:11,fontWeight:700,borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>+ Adicionar</button>
      </div>
      <div className="card">
        {banks.map(b=>(
          <div key={b.id} style={{marginBottom:16,paddingBottom:16,borderBottom:"1px solid var(--border)"}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
              {BANK_COLORS.map(c=>(
                <button key={c} onClick={()=>setSettings(s=>({...s,banks:s.banks.map(x=>x.id===b.id?{...x,color:c}:x)}))} style={{width:17,height:17,borderRadius:"50%",background:c,border:"none",cursor:"pointer",outline:b.color===c?"2px solid #fff":"none",outlineOffset:1}}/>
              ))}
              <button onClick={()=>setSettings(s=>({...s,banks:s.banks.filter(x=>x.id!==b.id)}))} style={{background:"none",border:"1px solid var(--wine)",color:"var(--wine)",fontFamily:"'Sora',sans-serif",fontSize:10,borderRadius:6,padding:"3px 8px",cursor:"pointer",marginLeft:"auto"}}>Apagar</button>
            </div>
            <div className="frow">
              <div className="fg" style={{margin:0}}><label className="fl">Nome</label><input className="fi" value={b.name} onChange={e=>setSettings(s=>({...s,banks:s.banks.map(x=>x.id===b.id?{...x,name:e.target.value}:x)}))}/></div>
              <div className="fg" style={{margin:0}}><label className="fl">Limite (R$)</label><input className="fi" type="number" placeholder="0 = sem limite" value={b.limit||""} onChange={e=>setSettings(s=>({...s,banks:s.banks.map(x=>x.id===b.id?{...x,limit:parseFloat(e.target.value)||0}:x)}))}/></div>
            </div>
          </div>
        ))}
      </div>
      <div className="divider"/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">Categorias de Gasto</div>
        <button onClick={()=>setShowNewCat(s=>!s)} style={{background:"var(--accent)",border:"none",color:"#fff",fontFamily:"'Sora',sans-serif",fontSize:11,fontWeight:700,borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>{showNewCat?"Cancelar":"+ Nova"}</button>
      </div>
      {showNewCat&&(
        <div className="card">
          <div className="frow">
            <div className="fg"><label className="fl">Nome</label><input className="fi" placeholder="Ex: Pet, Academia…" value={newCat.name} onChange={e=>setNewCat(c=>({...c,name:e.target.value}))}/></div>
            <div className="fg"><label className="fl">Ícone</label><select className="fi" value={newCat.icon} onChange={e=>setNewCat(c=>({...c,icon:e.target.value}))}>{CAT_ICONS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
          </div>
          <div className="fg"><label className="fl">Cor</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {CAT_COLORS.map(c=><button key={c} onClick={()=>setNewCat(nc=>({...nc,color:c}))} style={{width:20,height:20,borderRadius:"50%",background:c,border:"none",cursor:"pointer",outline:newCat.color===c?"2px solid #fff":"none",outlineOffset:1}}/>)}
            </div>
          </div>
          <button className="savebtn" onClick={addCat} disabled={!newCat.name.trim()}>Adicionar categoria</button>
        </div>
      )}
      <div className="card">
        {expenseCats.map(c=>(
          <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontSize:18}}>{c.icon}</span>
            <div style={{flex:1,fontSize:12,fontWeight:500}}>{c.name}</div>
            <span style={{width:12,height:12,borderRadius:"50%",background:c.color,display:"inline-block"}}/>
            <button onClick={()=>deleteCat(c.id)} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:14}}>✕</button>
          </div>
        ))}
      </div>
      <div className="divider"/>
      <div className="st">Orçamento por categoria 🎯</div>
      <div className="card">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {expenseCats.map(c=>(
            <div key={c.id} className="fg" style={{margin:0}}><label className="fl">{c.icon} {c.name}</label>
              <input className="fi" type="number" placeholder="sem limite" value={settings.catBudgets?.[c.name]||""} onChange={e=>setSettings(s=>({...s,catBudgets:{...s.catBudgets,[c.name]:parseFloat(e.target.value)||0}}))}/></div>
          ))}
        </div>
      </div>
      <div className="divider"/>
      <div className="st">Observações do mês</div>
      <div className="card"><textarea className="notesarea" placeholder="Ajustes feitos, decisões pro próximo mês…" value={data.notes||""} onChange={e=>setData(d=>({...d,notes:e.target.value}))}/></div>
    </div>
  );
}

// ─── ENTRY MODAL ──────────────────────────────────────────────────────────────
function EntryModal({type,entry,banks,expenseCats,onClose,onSave,vm,vy}){
  const isEdit=!!entry;
  const dd=`${vy}-${String(vm+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [form,setForm]=useState(()=>{
    if(isEdit) return{...entry};
    if(type==="income")     return{id:uid(),name:"",value:"",date:dd};
    if(type==="expense")    return{id:uid(),category:expenseCats[0]?.name||"Outros",date:dd,description:"",value:"",bank:banks[0]?.name||"",method:"PIX",essential:false};
    if(type==="fixed")      return{id:uid(),name:"",value:"",paid:false};
    if(type==="investment") return{id:uid(),name:"",type:"Reserva de Emergência",value:"",date:dd};
    return{};
  });
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  function save(){
    const stMap={income:"incomes",expense:"expenses",fixed:"fixed",investment:"investments"};
    const st=stMap[type];
    const p={...form,value:parseFloat(String(form.value||"0").replace(",","."))||0};
    onSave(st,p,isEdit?entry:null);
  }
  const titles={income:"Entrada",expense:"Gasto (Débito/PIX)",fixed:"Despesa Fixa",investment:"Reserva / Investimento"};
  return (
    <>
      <div className="mhdr"><div className="mtitle">{isEdit?"Editar":"Nova"} — {titles[type]}</div><button className="mclose" onClick={onClose}>✕</button></div>
      {type==="income"&&<>
        <div className="fg"><label className="fl">Nome / fonte</label><input className="fi" placeholder="Ex: Salário, Freela…" value={form.name} onChange={e=>upd("name",e.target.value)}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" type="number" inputMode="decimal" placeholder="0,00" value={form.value} onChange={e=>upd("value",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={form.date} onChange={e=>upd("date",e.target.value)}/></div>
        </div>
      </>}
      {type==="expense"&&<>
        <div style={{background:"rgba(155,140,255,.08)",border:"1px solid rgba(155,140,255,.2)",borderRadius:9,padding:"8px 11px",marginBottom:10,fontSize:11,color:"var(--accent)"}}>
          💳 Compra no crédito? Registre em Cartões
        </div>
        <div className="fg"><label className="fl">Categoria</label>
          <div className="catgrid">{expenseCats.map(c=>(
            <button key={c.id||c.name} className={`catopt${form.category===c.name?" selected":""}`} style={form.category===c.name?{borderColor:c.color,background:c.color+"33",color:"#fff"}:{}} onClick={()=>upd("category",c.name)}>{c.icon} {c.name}</button>
          ))}</div>
        </div>
        <div className="fg"><label className="fl">Descrição</label><input className="fi" placeholder="Ex: Mercado, Uber, Farmácia…" value={form.description} onChange={e=>upd("description",e.target.value)}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" type="number" inputMode="decimal" placeholder="0,00" value={form.value} onChange={e=>upd("value",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={form.date} onChange={e=>upd("date",e.target.value)}/></div>
        </div>
        <div className="frow">
          <div className="fg"><label className="fl">Banco</label><select className="fi" value={form.bank} onChange={e=>upd("bank",e.target.value)}>{banks.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}</select></div>
          <div className="fg"><label className="fl">Método</label><select className="fi" value={form.method} onChange={e=>upd("method",e.target.value)}>{METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
        </div>
      </>}
      {type==="fixed"&&<>
        <div className="fg"><label className="fl">Nome</label><input className="fi" placeholder="Ex: Parcela carro, Seguro…" value={form.name} onChange={e=>upd("name",e.target.value)}/></div>
        <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" type="number" inputMode="decimal" placeholder="0,00" value={form.value} onChange={e=>upd("value",e.target.value)}/></div>
        <div className="fg"><label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13}}><input type="checkbox" checked={!!form.paid} onChange={e=>upd("paid",e.target.checked)} style={{width:16,height:16,accentColor:"var(--green)"}}/>Já paga</label></div>
      </>}
      {type==="investment"&&<>
        <div className="fg"><label className="fl">Tipo</label><select className="fi" value={form.type} onChange={e=>upd("type",e.target.value)}>{INVEST_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
        <div className="fg"><label className="fl">Nome / descrição</label><input className="fi" placeholder="Ex: CDB Nubank, Aporte reserva…" value={form.name} onChange={e=>upd("name",e.target.value)}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" type="number" inputMode="decimal" placeholder="0,00" value={form.value} onChange={e=>upd("value",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={form.date} onChange={e=>upd("date",e.target.value)}/></div>
        </div>
      </>}
      <button className="savebtn" onClick={save}>{isEdit?"Salvar alterações":"Adicionar"}</button>
    </>
  );
}

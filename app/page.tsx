"use client";

import { useCallback, useEffect, useState } from "react";

type Service = "Food" | "Grocery" | "Vegetables" | "Mart" | "Bike Taxi" | "Parcel";
type Product = { id:string; service:Service; vendor:string; name:string; description:string; price:number; stock:number; rating:number; eta:string };
type Order = { id:string; reference:string; service:Service; vendor:string; vendor_id:string; customer:string; customer_id:string; partner:string|null; partner_id:string|null; status:string; total:number; details:Record<string,unknown>; created_at:string; updated_at:string };
type Offer = { id:string;vendor_id:string;vendor:string;title:string;code:string;discount_percent:number;min_order:number;active:number;created_at:string;updated_at:string };
type PlatformUser = { id:string;email:string;name:string;role:string;status:string;created_at?:string };
type Snapshot = { actor:PlatformUser; products:Product[]; orders:Order[]; offers:Offer[]; services:{service:Service;enabled:number}[]; pricing:{service:Service;base_fare:number;per_km:number;platform_fee:number}[]; settings:Record<string,string>; users:PlatformUser[]; auditLogs:Record<string,unknown>[] };
type ApiResult = { success:boolean; data?:Snapshot; error?:{code?:string;message:string}; message?:string|null };
type ErrorState = { code:string; message:string };

const adminNav:string[] = ["Dashboard","Live Orders","Live Operations","Orders","Rides","Parcels","Vendors","Delivery Partners","Customers","Catalog","Finance","Support","Reports","Settings"];
const commerce:Service[] = ["Food","Grocery","Vegetables","Mart"];
const money = (value:number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const label = (value:string) => value.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,(x)=>x.toUpperCase());
const terminalStatuses=["DELIVERED","COMPLETED","CANCELLED_BY_ADMIN","VENDOR_REJECTED"];

function detail(order:Order,key:string,fallback="—"){const value=order.details[key];return typeof value==="string"||typeof value==="number"?String(value):fallback;}
function orderSummary(order:Order){const items=Array.isArray(order.details.items)?order.details.items as {name?:string;qty?:number}[]:[];if(items.length)return items.map((x)=>`${x.qty||1}× ${x.name||"Item"}`).join(", ");return order.service==="Parcel"?detail(order,"packageType","Parcel"): `${detail(order,"distance","4.2")} km trip`;}

function Brand(){ return <div className="brand"><b>g</b><span>goocart</span></div>; }
function Status({value}:{value:string}){ return <span className={`status status-${value.toLowerCase()}`}>● {label(value)}</span>; }
function Empty({title,copy}:{title:string;copy:string}){ return <div className="empty-state"><i>g</i><h3>{title}</h3><p>{copy}</p></div>; }

function useGoocart(){
  const [state,setState] = useState<Snapshot|null>(null); const [busy,setBusy] = useState(false); const [toast,setToast] = useState(""); const [error,setError] = useState<ErrorState|null>(null);
  const load = useCallback(async(silent=false)=>{ try{ if(!silent)setBusy(true); const res=await fetch("/api/goocart",{cache:"no-store"}); const json=await res.json() as ApiResult; if(!json.success||!json.data){setError({code:json.error?.code||"UNKNOWN",message:json.error?.message||"Unable to load Goocart"});return;} setState(json.data);setError(null); }catch(e){setError({code:"NETWORK_ERROR",message:e instanceof Error?e.message:"Unable to load Goocart"});}finally{if(!silent)setBusy(false);}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(true),5000);return()=>{clearTimeout(initial);clearInterval(timer);};},[load]);
  const act=useCallback(async(body:Record<string,unknown>)=>{try{setBusy(true);const res=await fetch("/api/goocart",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const json=await res.json() as ApiResult;if(!json.success||!json.data)throw new Error(json.error?.message||"Action failed");setState(json.data);setToast(json.message||"Updated");setTimeout(()=>setToast(""),2800);return true;}catch(e){setToast(e instanceof Error?e.message:"Action failed");setTimeout(()=>setToast(""),3500);return false;}finally{setBusy(false);}},[]);
  return {state,busy,toast,error,act,retry:load};
}

async function logout(){await fetch("/api/auth/logout",{method:"POST"});window.location.reload();}

type AuthMode = "password" | "otp";
function AuthGate({onAuthenticated}:{onAuthenticated:()=>void}){
  const [mode,setMode]=useState<AuthMode>("password"); const [isSignup,setIsSignup]=useState(false); const [step,setStep]=useState<"form"|"code">("form");
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [identifier,setIdentifier]=useState(""); const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const switchMode=(next:AuthMode)=>{setMode(next);setStep("form");setError("");};

  const submitPassword=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{const res=await fetch(isSignup?"/api/auth/signup":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(isSignup?{email,password,name}:{email,password})});const json=await res.json() as ApiResult;if(!json.success)throw new Error(json.error?.message||"Something went wrong");onAuthenticated();}
    catch(e){setError(e instanceof Error?e.message:"Something went wrong");}finally{setBusy(false);}};

  const requestCode=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{const res=await fetch("/api/auth/otp/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier,purpose:isSignup?"SIGNUP":"LOGIN"})});const json=await res.json() as ApiResult;if(!json.success)throw new Error(json.error?.message||"Could not send code");setStep("code");}
    catch(e){setError(e instanceof Error?e.message:"Could not send code");}finally{setBusy(false);}};

  const verifyCode=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{const res=await fetch("/api/auth/otp/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier,code,name,purpose:isSignup?"SIGNUP":"LOGIN"})});const json=await res.json() as ApiResult;if(!json.success)throw new Error(json.error?.message||"That code is incorrect or has expired");onAuthenticated();}
    catch(e){setError(e instanceof Error?e.message:"That code is incorrect or has expired");}finally{setBusy(false);}};

  return <main className="auth-gate">
    <Brand/>
    <h1>{isSignup?"Create your account":"Sign in to Goocart Admin"}</h1>
    <p className="auth-subtitle">The operations console for the Goocart platform. Customer, vendor and delivery partner accounts use the Goocart mobile apps instead.</p>
    <div className="auth-tabs"><button className={mode==="password"?"active":""} onClick={()=>switchMode("password")}>Email &amp; password</button><button className={mode==="otp"?"active":""} onClick={()=>switchMode("otp")}>Email or phone code</button></div>
    {mode==="password"&&<form className="auth-form" onSubmit={(e)=>void submitPassword(e)}>
      {isSignup&&<label>Full name<input required minLength={2} value={name} onChange={(e)=>setName(e.target.value)}/></label>}
      <label>Email<input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)}/></label>
      <label>Password<input required minLength={8} type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label>
      {error&&<p className="auth-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Please wait...":isSignup?"Create account":"Sign in"}</button>
    </form>}
    {mode==="otp"&&step==="form"&&<form className="auth-form" onSubmit={(e)=>void requestCode(e)}>
      {isSignup&&<label>Full name<input required minLength={2} value={name} onChange={(e)=>setName(e.target.value)}/></label>}
      <label>Email or phone<input required value={identifier} onChange={(e)=>setIdentifier(e.target.value)}/></label>
      {error&&<p className="auth-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Sending...":"Send code"}</button>
    </form>}
    {mode==="otp"&&step==="code"&&<form className="auth-form" onSubmit={(e)=>void verifyCode(e)}>
      <p>Enter the 6-digit code sent to {identifier}.</p>
      <label>Code<input required pattern="[0-9]{6}" inputMode="numeric" value={code} onChange={(e)=>setCode(e.target.value)}/></label>
      {error&&<p className="auth-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Verifying...":"Verify & continue"}</button>
      <button type="button" className="auth-switch" onClick={()=>setStep("form")}>Use a different email or phone</button>
    </form>}
    <button className="auth-switch" onClick={()=>{setIsSignup(!isSignup);setError("");}}>{isSignup?"Already have an account? Sign in":"New to Goocart? Create an account"}</button>
  </main>;
}

function Shell({page,setPage,children,state}:{page:string;setPage:(x:string)=>void;children:React.ReactNode;state:Snapshot}){return <div className="workspace"><aside><Brand/><small>ADMIN PORTAL</small><nav>{adminNav.map((x)=><button className={page===x?"active":""} onClick={()=>setPage(x)} key={x}><i>{x[0]}</i>{x}</button>)}</nav><div className="profile"><b>{state.actor.name.slice(0,2).toUpperCase()}</b><span>{state.actor.name}<small>{label(state.actor.role)}</small></span></div></aside><main><header><span><small>JANGAREDDIGUDEM • LIVE</small><h1>{page}</h1></span><div><button className="signout-link" onClick={()=>void logout()}>Sign out</button></div></header>{children}</main></div>}
function Kpis({items}:{items:[string,string,string][]}){return <section className="kpis">{items.map((x)=><article key={x[1]}><small>{x[1]}</small><strong>{x[0]}</strong><em>{x[2]}</em></article>)}</section>}
function OrdersTable({orders,act,busy}:{orders:Order[];act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){return <div className="ops-table"><div className="ops-row ops-head"><span>REFERENCE</span><span>DETAILS</span><span>STATUS</span><span>VALUE</span><span>ACTION</span></div>{orders.map((o)=><div className="ops-row" key={o.id}><b>{o.reference}</b><span>{o.vendor}<small>{o.service} • {orderSummary(o)}</small></span><Status value={o.status}/><strong>{money(o.total)}</strong><OrderAction order={o} act={act} busy={busy}/></div>)}{!orders.length&&<Empty title="No matching work" copy="New activity will appear here automatically."/>}</div>}
function OrderAction({order,act,busy}:{order:Order;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){if(terminalStatuses.includes(order.status))return null;return <div className="row-actions"><button className="danger" disabled={busy} onClick={()=>void act({action:"order.transition",id:order.id,to:"CANCELLED_BY_ADMIN"})}>Cancel</button></div>}

function Admin({state,act,busy}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){const [page,setPage]=useState("Dashboard");const orders=state.orders;const gmv=orders.reduce((s,x)=>s+x.total,0);const active=orders.filter((x)=>!terminalStatuses.includes(x.status));const rides=orders.filter((x)=>x.service==="Bike Taxi");const parcels=orders.filter((x)=>x.service==="Parcel");return <Shell page={page} setPage={setPage} state={state}>{page==="Dashboard"&&<><div className="overview"><span><small>Command center</small><h2>Operations at a glance.</h2></span><b>LIVE DATA</b></div><Kpis items={[[money(gmv),"Total GMV","All services"],[String(orders.length),"Total orders & jobs","Live"],[String(active.length),"Active operations","Now"],[String(state.services.filter((x)=>x.enabled).length),"Enabled services","of 6"]]}/><section className="panel"><div><span><h2>Live operations</h2><small>Customer, vendor and partner activity</small></span></div><OrdersTable orders={active.slice(0,7)} act={act} busy={busy}/></section></>}{page==="Live Orders"&&<AdminLiveOrders/>}{["Live Operations","Orders"].includes(page)&&<WorkspacePage eyebrow="REALTIME OPERATIONS" title={page} copy="Monitor status and intervene when necessary."><OrdersTable orders={page==="Orders"?orders:active} act={act} busy={busy}/></WorkspacePage>}{page==="Rides"&&<WorkspacePage eyebrow="RIDE ENGINE" title="Bike taxi" copy="Ride requests, driver assignments and completions."><OrdersTable orders={rides} act={act} busy={busy}/></WorkspacePage>}{page==="Parcels"&&<WorkspacePage eyebrow="PARCEL ENGINE" title="Parcel operations" copy="Pickup, transit and delivery verification."><OrdersTable orders={parcels} act={act} busy={busy}/></WorkspacePage>}{page==="Catalog"&&<AdminCatalog state={state} act={act} busy={busy}/>} {page==="Settings"&&<AdminSettings state={state} act={act}/>} {page==="Finance"&&<StatsPage title="Platform finance" stats={[["Gross merchandise value",money(gmv)],["Platform revenue",money(gmv*.18)],["Vendor payable",money(gmv*.82)]]}/>} {page==="Vendors"&&<AdminVendors/>} {page==="Delivery Partners"&&<AdminPartners/>} {page==="Customers"&&<AdminCustomers/>} {page==="Support"&&<Directory title="Support tickets" rows={[["#TKT-1042","Order delayed","Open"],["#TKT-1039","Payment issue","In progress"],["#TKT-1034","Missing item","Resolved"]]}/>} {page==="Reports"&&<StatsPage title="Performance reports" stats={commerce.map((x)=>[x,`${orders.filter((o)=>o.service===x).length} orders`])}/>}</Shell>}
function AdminCatalog({state,act,busy}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){return <WorkspacePage eyebrow="CATALOG & INVENTORY" title="All products" copy="Live price, stock and service availability."><div className="inventory-list">{state.products.map((p)=><article key={p.id}><i>{p.name[0]}</i><span><small>{p.service} • {p.vendor}</small><h3>{p.name}</h3><p>{money(p.price)} • ★ {p.rating}</p></span><b className={p.stock<15?"low-stock":""}>{p.stock} stock</b><div className="qty"><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:-1})}>−</button><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:5})}>+5</button></div></article>)}</div></WorkspacePage>}
function AdminSettings({state,act}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>}){return <WorkspacePage eyebrow="SERVICE AREA" title="Jangareddigudem" copy="Enable services independently for this operating area."><div className="setting-list">{state.services.map((s)=><article key={s.service}><i>{s.service[0]}</i><span><b>{s.service}</b><small>{s.enabled?"Available to customers":"Temporarily unavailable"}</small></span><button className={s.enabled?"toggle on":"toggle"} onClick={()=>void act({action:"service.toggle",service:s.service,enabled:!s.enabled})}><i/></button></article>)}</div></WorkspacePage>}

type AdminRestaurant = { id:string; name:string; area:string; isOpen:boolean; status:string; manualOrderAcceptance:boolean; owner:{id:string;name:string;email:string}|null };
type AdminVendorUser = { id:string; name:string; email:string; role:string; status:string };
type AdminVendorTeamMember = { id:string; name:string; email:string; phone:string|null; role:string; status:string; staffTitle:string|null; isPrimaryOwner:boolean; permissions:string[] };
async function adminApi<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`/api/v1/admin${path}`,{...init,headers:{"content-type":"application/json",...init?.headers}});const json=await res.json() as {success:boolean;data?:T;error?:{message:string}};if(!json.success||!json.data)throw new Error(json.error?.message||"Request failed");return json.data;}

const VENDOR_PERMISSIONS = ["CAN_VIEW_ORDERS","CAN_ACCEPT_ORDER","CAN_REJECT_ORDER","CAN_UPDATE_ORDER_STATUS","CAN_MARK_READY","CAN_MANAGE_PRODUCTS","CAN_MANAGE_STOCK","CAN_MANAGE_PRICES","CAN_MANAGE_OFFERS","CAN_VIEW_REPORTS","CAN_MANAGE_VENDOR_USERS"];

function AdminVendors(){
  const [restaurants,setRestaurants]=useState<AdminRestaurant[]|null>(null);
  const [vendors,setVendors]=useState<AdminVendorUser[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [showCreate,setShowCreate]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const load=useCallback(async()=>{try{const [r,v]=await Promise.all([adminApi<{restaurants:AdminRestaurant[]}>("/restaurants"),adminApi<{vendors:AdminVendorUser[]}>("/vendors")]);setRestaurants(r.restaurants);setVendors(v.vendors);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load vendors");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const assign=async(restaurantId:string,userId:string)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/owner`,{method:"PATCH",body:JSON.stringify({userId:userId||null})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not assign owner");}finally{setBusy(false);}};
  const toggleManual=async(r:AdminRestaurant)=>{setBusy(true);try{await adminApi(`/restaurants/${r.id}/manual-acceptance`,{method:"PATCH",body:JSON.stringify({manualOrderAcceptance:!r.manualOrderAcceptance})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this vendor's setting");}finally{setBusy(false);}};

  return <WorkspacePage eyebrow="VENDOR ACCOUNTS" title="Restaurants & owners" copy="Create vendors, link owners, control order acceptance, and manage each vendor's Vendor App team.">
    {error&&<p className="auth-error">{error}</p>}
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Vendor"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreateVendorForm onCreated={()=>{setShowCreate(false);void load();}}/>}
    {restaurants===null?<Empty title="Loading…" copy="Fetching restaurants and vendor accounts."/>:!restaurants.length?<Empty title="No restaurants yet" copy="Create one above, or seed the catalog to see restaurants here."/>:
    <div className="directory">{restaurants.map((r)=><article key={r.id} className="vendor-row">
      <div className="vendor-row-head">
        <i>{r.name[0]}</i>
        <span><b>{r.name}</b><small>{r.area} • {r.isOpen?"Open":"Closed"} • {r.status}{r.owner?` • Owned by ${r.owner.name}`:" • Unassigned"}</small></span>
        <button className="toggle-labelled" onClick={()=>void toggleManual(r)} disabled={busy} title="Require Vendor Order Acceptance">
          <span className={r.manualOrderAcceptance?"toggle on":"toggle"}><i/></span>
          <small>{r.manualOrderAcceptance?"Manual accept ON":"Auto-accept ON"}</small>
        </button>
      </div>
      <div className="vendor-row-actions">
        <select disabled={busy} value={r.owner?.id||""} onChange={(e)=>void assign(r.id,e.target.value)} aria-label={`Assign owner for ${r.name}`}>
          <option value="">Unassigned</option>
          {vendors.map((v)=><option key={v.id} value={v.id}>{v.name} ({v.email})</option>)}
        </select>
        <button className="secondary" onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?"Hide team":"Manage team"}</button>
      </div>
      {expanded===r.id&&<VendorTeamPanel restaurantId={r.id}/>}
    </article>)}</div>}
  </WorkspacePage>;
}

function PrimaryActionButton({label,onClick}:{label:string;onClick:()=>void}){return <button className="primary" style={{width:"max-content",marginBottom:14}} onClick={onClick}>{label}</button>;}

function CreateVendorForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({name:"",area:"",latitude:"",longitude:"",businessType:"",manualOrderAcceptance:true});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi("/restaurants",{method:"POST",body:JSON.stringify({name:form.name,area:form.area,latitude:Number(form.latitude),longitude:Number(form.longitude),businessType:form.businessType||null,manualOrderAcceptance:form.manualOrderAcceptance})});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create vendor");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Business name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Area<input required value={form.area} onChange={(e)=>setForm({...form,area:e.target.value})}/></label>
    <label>Latitude<input required type="number" step="any" value={form.latitude} onChange={(e)=>setForm({...form,latitude:e.target.value})}/></label>
    <label>Longitude<input required type="number" step="any" value={form.longitude} onChange={(e)=>setForm({...form,longitude:e.target.value})}/></label>
    <label>Business type<input value={form.businessType} onChange={(e)=>setForm({...form,businessType:e.target.value})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.manualOrderAcceptance} onChange={(e)=>setForm({...form,manualOrderAcceptance:e.target.checked})}/>Require vendor order acceptance</label>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create vendor"}</button>
  </form>;
}

function VendorTeamPanel({restaurantId}:{restaurantId:string}){
  const [team,setTeam]=useState<AdminVendorTeamMember[]|null>(null);
  const [showAdd,setShowAdd]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{users:AdminVendorTeamMember[]}>(`/restaurants/${restaurantId}/users`);setTeam(r.users);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load the vendor's team");}},[restaurantId]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const setStatus=async(userId:string,status:string)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/users/${userId}`,{method:"PATCH",body:JSON.stringify({status})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this user");}finally{setBusy(false);}};
  const togglePermission=async(member:AdminVendorTeamMember,permission:string)=>{
    if(member.isPrimaryOwner)return; // owner always has every permission, nothing to toggle
    const next=member.permissions.includes(permission)?member.permissions.filter((p)=>p!==permission):[...member.permissions,permission];
    setBusy(true);
    try{await adminApi(`/restaurants/${restaurantId}/users/${member.id}`,{method:"PATCH",body:JSON.stringify({permissions:next})});await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not update permissions");}finally{setBusy(false);}
  };
  const resetAccess=async(userId:string)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/users/${userId}/reset-access`,{method:"POST"});}catch(e){setError(e instanceof Error?e.message:"Could not reset access");}finally{setBusy(false);}};
  const remove=async(userId:string)=>{if(!confirm("Remove this vendor user?"))return;setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/users/${userId}`,{method:"DELETE"});await load();}catch(e){setError(e instanceof Error?e.message:"Could not remove this user");}finally{setBusy(false);}};

  return <div className="team-panel">
    {error&&<p className="auth-error">{error}</p>}
    {team===null?<p className="muted-note">Loading team…</p>:!team.length?<p className="muted-note">No vendor users yet.</p>:
      <div className="team-list">{team.map((m)=><div key={m.id} className="team-member">
        <div className="team-member-head">
          <b>{m.name}</b><small>{m.email}{m.staffTitle?` • ${m.staffTitle}`:""} • {label(m.role)}{m.isPrimaryOwner?" • Owner":""}</small>
          <span className={`status status-${m.status.toLowerCase()}`}>● {label(m.status)}</span>
        </div>
        <div className="permission-grid">
          {VENDOR_PERMISSIONS.map((p)=><label key={p} className="checkbox-label small">
            <input type="checkbox" disabled={busy||m.isPrimaryOwner} checked={m.isPrimaryOwner||m.permissions.includes(p)} onChange={()=>void togglePermission(m,p)}/>
            {label(p.replace("CAN_",""))}
          </label>)}
        </div>
        <div className="team-member-actions">
          {m.status==="ACTIVE"?<button className="secondary" disabled={busy} onClick={()=>void setStatus(m.id,"SUSPENDED")}>Suspend</button>:<button className="secondary" disabled={busy} onClick={()=>void setStatus(m.id,"ACTIVE")}>Activate</button>}
          <button className="secondary" disabled={busy} onClick={()=>void resetAccess(m.id)}>Reset login access</button>
          {!m.isPrimaryOwner&&<button className="secondary danger-text" disabled={busy} onClick={()=>void remove(m.id)}>Remove</button>}
        </div>
      </div>)}</div>}
    <PrimaryActionButton label={showAdd?"Cancel":"+ Add Vendor User"} onClick={()=>setShowAdd(!showAdd)}/>
    {showAdd&&<AddVendorUserForm restaurantId={restaurantId} onCreated={()=>{setShowAdd(false);void load();}}/>}
  </div>;
}

function AddVendorUserForm({restaurantId,onCreated}:{restaurantId:string;onCreated:()=>void}){
  const [form,setForm]=useState({name:"",email:"",phone:"",role:"VENDOR_STAFF",staffTitle:""});
  const [permissions,setPermissions]=useState<string[]>(["CAN_VIEW_ORDERS"]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const togglePerm=(p:string)=>setPermissions(permissions.includes(p)?permissions.filter((x)=>x!==p):[...permissions,p]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi(`/restaurants/${restaurantId}/users`,{method:"POST",body:JSON.stringify({name:form.name,email:form.email,phone:form.phone||undefined,role:form.role,staffTitle:form.staffTitle||null,permissions})});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create this vendor user");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Full name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Email<input required type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
    <label>Phone (optional)<input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
    <label>Title (e.g. Kitchen Staff)<input value={form.staffTitle} onChange={(e)=>setForm({...form,staffTitle:e.target.value})}/></label>
    <label>Role
      <select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}>
        <option value="VENDOR_OWNER">Owner</option>
        <option value="VENDOR_MANAGER">Manager</option>
        <option value="VENDOR_STAFF">Staff</option>
      </select>
    </label>
    <div className="permission-grid">{VENDOR_PERMISSIONS.map((p)=><label key={p} className="checkbox-label small"><input type="checkbox" checked={permissions.includes(p)} onChange={()=>togglePerm(p)}/>{label(p.replace("CAN_",""))}</label>)}</div>
    <p className="muted-note">{"They'll sign into the Vendor App with an OTP sent to this email or phone — no password to hand over."}</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create vendor user"}</button>
  </form>;
}

type AdminCustomerRow = { id:string; name:string; email:string; phone:string|null; status:string; joinedAt:string; orders:number; completedOrders:number; cancelledOrders:number; totalSpend:number; lastOrderAt:string|null };

function AdminCustomers(){
  const [customers,setCustomers]=useState<AdminCustomerRow[]|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{customers:AdminCustomerRow[]}>("/customers");setCustomers(r.customers);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load customers");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const setStatus=async(id:string,status:string)=>{setBusy(true);try{await adminApi(`/customers/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this customer");}finally{setBusy(false);}};

  return <WorkspacePage eyebrow="CUSTOMER ACCOUNTS" title="Customers" copy="Every registered customer, their order history and account status.">
    {error&&<p className="auth-error">{error}</p>}
    {customers===null?<Empty title="Loading…" copy="Fetching customers."/>:!customers.length?<Empty title="No customers yet" copy="Customers appear here once they sign up in the app."/>:
    <div className="directory">{customers.map((c)=><article key={c.id}>
      <i>{c.name[0]||"?"}</i>
      <span><b>{c.name}</b><small>{c.email}{c.phone?` • ${c.phone}`:""} • {c.orders} orders ({c.completedOrders} completed, {c.cancelledOrders} cancelled) • {money(c.totalSpend)} lifetime</small></span>
      <span className={`status status-${c.status.toLowerCase()}`}>● {label(c.status)}</span>
      {c.status==="ACTIVE"?<button className="secondary" disabled={busy} onClick={()=>void setStatus(c.id,"SUSPENDED")}>Suspend</button>:<button className="secondary" disabled={busy} onClick={()=>void setStatus(c.id,"ACTIVE")}>Activate</button>}
    </article>)}</div>}
  </WorkspacePage>;
}

type AdminPartnerRow = { id:string; name:string; email:string; phone:string|null; vehicleType:string|null; vehicleNumber:string|null; status:string; partnerApprovalStatus:string; partnerOnline:boolean; partnerBusy:boolean };

function AdminPartners(){
  const [partners,setPartners]=useState<AdminPartnerRow[]|null>(null);
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{partners:AdminPartnerRow[]}>("/partners");setPartners(r.partners);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load delivery partners");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);const t=setInterval(()=>void load(),8000);return()=>{clearTimeout(initial);clearInterval(t);};},[load]);
  const setApproval=async(id:string,approvalStatus:string)=>{setBusy(true);try{await adminApi(`/partners/${id}/approval`,{method:"PATCH",body:JSON.stringify({approvalStatus})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update approval");}finally{setBusy(false);}};
  const setStatus=async(id:string,status:string)=>{setBusy(true);try{await adminApi(`/partners/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update status");}finally{setBusy(false);}};

  return <WorkspacePage eyebrow="DELIVERY FLEET" title="Delivery partners" copy="Approve new partners, and control who can go online and receive deliveries.">
    {error&&<p className="auth-error">{error}</p>}
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Delivery Partner"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreatePartnerForm onCreated={()=>{setShowCreate(false);void load();}}/>}
    {partners===null?<Empty title="Loading…" copy="Fetching delivery partners."/>:!partners.length?<Empty title="No delivery partners yet" copy="Create one above to get started."/>:
    <div className="directory">{partners.map((p)=><article key={p.id}>
      <i>{p.name[0]||"?"}</i>
      <span><b>{p.name}</b><small>{p.email}{p.phone?` • ${p.phone}`:""}{p.vehicleType?` • ${p.vehicleType} ${p.vehicleNumber||""}`:""}</small></span>
      <span className={`status status-${p.partnerOnline?"online":"suspended"}`}>● {p.partnerBusy?"On a delivery":p.partnerOnline?"Online":"Offline"}</span>
      {p.partnerApprovalStatus==="PENDING"?<><button className="secondary" disabled={busy} onClick={()=>void setApproval(p.id,"APPROVED")}>Approve</button><button className="secondary danger-text" disabled={busy} onClick={()=>void setApproval(p.id,"REJECTED")}>Reject</button></>
        :p.status==="ACTIVE"?<button className="secondary" disabled={busy} onClick={()=>void setStatus(p.id,"SUSPENDED")}>Suspend</button>:<button className="secondary" disabled={busy} onClick={()=>void setStatus(p.id,"ACTIVE")}>Activate</button>}
    </article>)}</div>}
  </WorkspacePage>;
}

function CreatePartnerForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({name:"",email:"",phone:"",vehicleType:"Bike",vehicleNumber:"",licenceNumber:""});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{await adminApi("/partners",{method:"POST",body:JSON.stringify(form)});onCreated();}
    catch(e){setError(e instanceof Error?e.message:"Could not create this delivery partner");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Full name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Email<input required type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
    <label>Phone<input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
    <label>Vehicle type<input value={form.vehicleType} onChange={(e)=>setForm({...form,vehicleType:e.target.value})}/></label>
    <label>Vehicle number<input value={form.vehicleNumber} onChange={(e)=>setForm({...form,vehicleNumber:e.target.value})}/></label>
    <label>Licence number<input value={form.licenceNumber} onChange={(e)=>setForm({...form,licenceNumber:e.target.value})}/></label>
    <p className="muted-note">{"They'll sign into the Delivery Partner App with an OTP, and can go online once approved here."}</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create delivery partner"}</button>
  </form>;
}

type AdminLiveOrder = { id:string; orderNumber:string; customerName:string; restaurantName:string; status:string; total:number; paymentStatus:string; deliveryOfferStatus:string; partner:{id:string;name:string|null;latitude:number|null;longitude:number|null;locationUpdatedAt:string|null}|null; createdAt:string; estimatedDeliveryMinutes:number };

function AdminLiveOrders(){
  const [orders,setOrders]=useState<AdminLiveOrder[]|null>(null);
  const [error,setError]=useState("");
  const [expanded,setExpanded]=useState<string|null>(null);
  const load=useCallback(async()=>{try{const r=await adminApi<{orders:AdminLiveOrder[]}>("/orders/live");setOrders(r.orders);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load live orders");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);const t=setInterval(()=>void load(),4000);return()=>{clearTimeout(initial);clearInterval(t);};},[load]);

  return <WorkspacePage eyebrow="REALTIME OPERATIONS" title="Live Orders" copy="Every order still in flight, updating automatically every few seconds.">
    {error&&<p className="auth-error">{error}</p>}
    {orders===null?<Empty title="Loading…" copy="Fetching live orders."/>:!orders.length?<Empty title="Nothing in flight" copy="Every order is either delivered or cancelled right now."/>:
    <div className="ops-table">
      <div className="ops-row ops-head"><span>ORDER</span><span>DETAILS</span><span>STATUS</span><span>VALUE</span><span>DELIVERY</span></div>
      {orders.map((o)=><div key={o.id}>
        <div className="ops-row" style={{cursor:"pointer"}} role="button" tabIndex={0} onClick={()=>setExpanded(expanded===o.id?null:o.id)} onKeyDown={(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setExpanded(expanded===o.id?null:o.id);}}}>
          <b>{o.orderNumber}</b>
          <span>{o.customerName}<small>{o.restaurantName}</small></span>
          <Status value={o.status}/>
          <strong>{money(o.total)}</strong>
          <span>{o.partner?o.partner.name:o.deliveryOfferStatus==="OFFERING"?"Finding partner…":"—"}</span>
        </div>
        {expanded===o.id&&<AdminOrderDetail orderId={o.id}/>}
      </div>)}
    </div>}
  </WorkspacePage>;
}

type AdminOrderEvent = { event:string; actorType:string; at:string; metadata:unknown };
function AdminOrderDetail({orderId}:{orderId:string}){
  const [detail,setDetail]=useState<{order:unknown;events:AdminOrderEvent[];tracking:{latitude:number;longitude:number;updatedAt:string;partnerPhone:string|null}|null}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{let cancelled=false;adminApi<typeof detail>(`/orders/${orderId}/detail`).then((d)=>{if(!cancelled)setDetail(d);}).catch((e)=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not load this order");});return()=>{cancelled=true;};},[orderId]);
  const reassign=async()=>{setBusy(true);try{await adminApi(`/orders/${orderId}/reassign-partner`,{method:"POST"});}catch(e){setError(e instanceof Error?e.message:"Could not reassign");}finally{setBusy(false);}};
  const cancelOrder=async()=>{if(!confirm("Cancel this order?"))return;setBusy(true);try{await fetch(`/api/v1/orders/${orderId}/cancel`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"Admin override"})});}catch(e){setError(e instanceof Error?e.message:"Could not cancel");}finally{setBusy(false);}};

  if(error)return <div className="order-detail"><p className="auth-error">{error}</p></div>;
  if(!detail)return <div className="order-detail"><p className="muted-note">Loading order detail…</p></div>;
  return <div className="order-detail">
    <div className="order-detail-grid">
      <div>
        <h4>Timeline</h4>
        <ul className="event-list">{detail.events.map((e,i)=><li key={i}><b>{label(e.event)}</b><small>{e.actorType} • {new Date(e.at).toLocaleTimeString()}</small></li>)}</ul>
      </div>
      <div>
        <h4>Live tracking</h4>
        {detail.tracking?<p className="muted-note">Lat {detail.tracking.latitude.toFixed(4)}, Lng {detail.tracking.longitude.toFixed(4)}<br/>Updated {new Date(detail.tracking.updatedAt).toLocaleTimeString()}{detail.tracking.partnerPhone?<><br/>Phone: {detail.tracking.partnerPhone}</>:null}</p>:<p className="muted-note">No delivery partner GPS yet.</p>}
        <div className="team-member-actions">
          <button className="secondary" disabled={busy} onClick={()=>void reassign()}>Reassign delivery partner</button>
          <button className="secondary danger-text" disabled={busy} onClick={()=>void cancelOrder()}>Cancel order</button>
        </div>
      </div>
    </div>
  </div>;
}

function WorkspacePage({eyebrow,title,copy,children}:{eyebrow:string;title:string;copy:string;children:React.ReactNode}){return <section className="workspace-page"><div className="page-head"><small>{eyebrow}</small><h1>{title}</h1><p>{copy}</p></div>{children}</section>}
function StatsPage({title,stats}:{title:string;stats:string[][]}){return <WorkspacePage eyebrow="LIVE SUMMARY" title={title} copy="Calculated from current platform activity."><div className="stat-list">{stats.map((x)=><article key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong></article>)}</div></WorkspacePage>}
function Directory({title,rows}:{title:string;rows:string[][]}){return <WorkspacePage eyebrow="DIRECTORY" title={title} copy="Operational records available to this admin role."><div className="directory">{rows.map((x)=><article key={x[0]}><i>{x[0][0]}</i><span><b>{x[0]}</b><small>{x[1]}</small></span><Status value={x[2].toUpperCase().replaceAll(" ","_")}/></article>)}</div></WorkspacePage>}

// This app is the Admin console only. Customer, vendor and delivery partner
// accounts are turned away here with guidance to the right mobile app —
// their web equivalents don't exist anymore.
function roleGuidance(role:string):string{
  if(role==="CUSTOMER")return "This account is a customer account. Use the Goocart customer app to browse and order.";
  if(role==="DELIVERY_PARTNER")return "This account is a delivery partner account. Use the Goocart Partner app to manage deliveries.";
  if(role==="VENDOR_OWNER"||role==="VENDOR_MANAGER")return "This account is a vendor account. Use the Goocart Vendor app to manage your restaurant.";
  return "This account isn't set up for the Goocart Admin console.";
}

export default function Home(){const {state,busy,toast,error,act,retry}=useGoocart();if(error?.code==="AUTH_REQUIRED")return <AuthGate onAuthenticated={()=>void retry()}/>;if(error)return <main className="fatal"><Brand/><h1>Goocart couldn’t start</h1><p>{error.message}</p><button onClick={()=>void retry()}>Try again</button></main>;if(!state)return <main className="loading"><Brand/><div className="loader"/><p>Starting Goocart...</p></main>;const content=state.actor.role.includes("ADMIN")?<Admin state={state} act={act} busy={busy}/>:<main className="fatal"><Brand/><h1>This is the Admin console</h1><p>{roleGuidance(state.actor.role)}</p><button onClick={()=>void logout()}>Sign out</button></main>;return <div>{busy&&<div className="syncing">Syncing…</div>}{toast&&<div className="toast">{toast}</div>}{content}</div>}

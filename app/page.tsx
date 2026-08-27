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

const adminNav:string[] = ["Dashboard","Live Operations","Orders","Rides","Parcels","Vendors","Delivery Partners","Customers","Catalog","Finance","Support","Reports","Settings"];
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

function Admin({state,act,busy}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){const [page,setPage]=useState("Dashboard");const orders=state.orders;const gmv=orders.reduce((s,x)=>s+x.total,0);const active=orders.filter((x)=>!terminalStatuses.includes(x.status));const rides=orders.filter((x)=>x.service==="Bike Taxi");const parcels=orders.filter((x)=>x.service==="Parcel");return <Shell page={page} setPage={setPage} state={state}>{page==="Dashboard"&&<><div className="overview"><span><small>Command center</small><h2>Operations at a glance.</h2></span><b>LIVE DATA</b></div><Kpis items={[[money(gmv),"Total GMV","All services"],[String(orders.length),"Total orders & jobs","Live"],[String(active.length),"Active operations","Now"],[String(state.services.filter((x)=>x.enabled).length),"Enabled services","of 6"]]}/><section className="panel"><div><span><h2>Live operations</h2><small>Customer, vendor and partner activity</small></span></div><OrdersTable orders={active.slice(0,7)} act={act} busy={busy}/></section></>}{["Live Operations","Orders"].includes(page)&&<WorkspacePage eyebrow="REALTIME OPERATIONS" title={page} copy="Monitor status and intervene when necessary."><OrdersTable orders={page==="Orders"?orders:active} act={act} busy={busy}/></WorkspacePage>}{page==="Rides"&&<WorkspacePage eyebrow="RIDE ENGINE" title="Bike taxi" copy="Ride requests, driver assignments and completions."><OrdersTable orders={rides} act={act} busy={busy}/></WorkspacePage>}{page==="Parcels"&&<WorkspacePage eyebrow="PARCEL ENGINE" title="Parcel operations" copy="Pickup, transit and delivery verification."><OrdersTable orders={parcels} act={act} busy={busy}/></WorkspacePage>}{page==="Catalog"&&<AdminCatalog state={state} act={act} busy={busy}/>} {page==="Settings"&&<AdminSettings state={state} act={act}/>} {page==="Finance"&&<StatsPage title="Platform finance" stats={[["Gross merchandise value",money(gmv)],["Platform revenue",money(gmv*.18)],["Vendor payable",money(gmv*.82)]]}/>} {page==="Vendors"&&<AdminVendors/>} {page==="Delivery Partners"&&<Directory title="Delivery partners" rows={[["Ravi Kumar","Bike • All services",state.settings.partner_online==="true"?"Online":"Offline"],["Anil K","EV Scooter • Commerce","Offline"],["Suresh B","Bike • Rides & Parcel","Online"]]}/>} {page==="Customers"&&<Directory title="Customers" rows={[["Bhargav Reddy",`${orders.length} activities`,money(gmv)],["Kavya S","4 activities","₹1,840"],["Ramesh K","2 activities","₹760"]]}/>} {page==="Support"&&<Directory title="Support tickets" rows={[["#TKT-1042","Order delayed","Open"],["#TKT-1039","Payment issue","In progress"],["#TKT-1034","Missing item","Resolved"]]}/>} {page==="Reports"&&<StatsPage title="Performance reports" stats={commerce.map((x)=>[x,`${orders.filter((o)=>o.service===x).length} orders`])}/>}</Shell>}
function AdminCatalog({state,act,busy}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){return <WorkspacePage eyebrow="CATALOG & INVENTORY" title="All products" copy="Live price, stock and service availability."><div className="inventory-list">{state.products.map((p)=><article key={p.id}><i>{p.name[0]}</i><span><small>{p.service} • {p.vendor}</small><h3>{p.name}</h3><p>{money(p.price)} • ★ {p.rating}</p></span><b className={p.stock<15?"low-stock":""}>{p.stock} stock</b><div className="qty"><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:-1})}>−</button><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:5})}>+5</button></div></article>)}</div></WorkspacePage>}
function AdminSettings({state,act}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>}){return <WorkspacePage eyebrow="SERVICE AREA" title="Jangareddigudem" copy="Enable services independently for this operating area."><div className="setting-list">{state.services.map((s)=><article key={s.service}><i>{s.service[0]}</i><span><b>{s.service}</b><small>{s.enabled?"Available to customers":"Temporarily unavailable"}</small></span><button className={s.enabled?"toggle on":"toggle"} onClick={()=>void act({action:"service.toggle",service:s.service,enabled:!s.enabled})}><i/></button></article>)}</div></WorkspacePage>}

type AdminRestaurant = { id:string; name:string; area:string; isOpen:boolean; owner:{id:string;name:string;email:string}|null };
type AdminVendorUser = { id:string; name:string; email:string; role:string; status:string };
async function adminApi<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`/api/v1/admin${path}`,{...init,headers:{"content-type":"application/json",...init?.headers}});const json=await res.json() as {success:boolean;data?:T;error?:{message:string}};if(!json.success||!json.data)throw new Error(json.error?.message||"Request failed");return json.data;}
function AdminVendors(){
  const [restaurants,setRestaurants]=useState<AdminRestaurant[]|null>(null);
  const [vendors,setVendors]=useState<AdminVendorUser[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const [r,v]=await Promise.all([adminApi<{restaurants:AdminRestaurant[]}>("/restaurants"),adminApi<{vendors:AdminVendorUser[]}>("/vendors")]);setRestaurants(r.restaurants);setVendors(v.vendors);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load vendors");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const assign=async(restaurantId:string,userId:string)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/owner`,{method:"PATCH",body:JSON.stringify({userId:userId||null})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not assign owner");}finally{setBusy(false);}};
  return <WorkspacePage eyebrow="VENDOR ACCOUNTS" title="Restaurants & owners" copy="Link a vendor account to a restaurant so its menu shows up in the Vendor app.">
    {error&&<p className="auth-error">{error}</p>}
    {restaurants===null?<Empty title="Loading…" copy="Fetching restaurants and vendor accounts."/>:!restaurants.length?<Empty title="No restaurants yet" copy="Seed the catalog to see restaurants here."/>:
    <div className="directory">{restaurants.map((r)=><article key={r.id}><i>{r.name[0]}</i><span><b>{r.name}</b><small>{r.area} • {r.isOpen?"Open":"Closed"}{r.owner?` • Owned by ${r.owner.name}`:" • Unassigned"}</small></span>
      <select disabled={busy} value={r.owner?.id||""} onChange={(e)=>void assign(r.id,e.target.value)} aria-label={`Assign owner for ${r.name}`}>
        <option value="">Unassigned</option>
        {vendors.map((v)=><option key={v.id} value={v.id}>{v.name} ({v.email})</option>)}
      </select>
    </article>)}</div>}
  </WorkspacePage>;
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

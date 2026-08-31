"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

type Service = "Food" | "Grocery" | "Vegetables" | "Mart" | "Bike Taxi" | "Parcel";
type Product = { id:string; service:Service; vendor:string; name:string; description:string; image_url:string|null; price:number; stock:number; rating:number; eta:string };
type Order = { id:string; reference:string; service:Service; vendor:string; vendor_id:string; customer:string; customer_id:string; partner:string|null; partner_id:string|null; status:string; total:number; details:Record<string,unknown>; created_at:string; updated_at:string };
type Offer = { id:string;vendor_id:string;vendor:string;title:string;code:string;discount_percent:number;min_order:number;active:number;created_at:string;updated_at:string };
type PlatformUser = { id:string;email:string;name:string;role:string;status:string;created_at?:string };
type Snapshot = { actor:PlatformUser; products:Product[]; orders:Order[]; offers:Offer[]; services:{service:Service;enabled:number}[]; pricing:{service:Service;base_fare:number;per_km:number;platform_fee:number}[]; settings:Record<string,string>; users:PlatformUser[]; auditLogs:Record<string,unknown>[] };
type ApiResult = { success:boolean; data?:Snapshot; error?:{code?:string;message:string}; message?:string|null };
type ErrorState = { code:string; message:string };

const adminNav:string[] = ["Dashboard","Live Orders","Live Operations","Orders","Rides","Parcels","Vendors","Delivery Partners","Customers","Catalog","Discounts & Pricing","Automation","Finance","Support","Reports","Settings"];
const commerce:Service[] = ["Food","Grocery","Vegetables","Mart"];
const allServices:Service[] = ["Food","Grocery","Vegetables","Mart","Bike Taxi","Parcel"];
const money = (value:number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const label = (value:string) => value.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,(x)=>x.toUpperCase());
const terminalStatuses=["DELIVERED","COMPLETED","CANCELLED_BY_ADMIN","VENDOR_REJECTED"];

function detail(order:Order,key:string,fallback="—"){const value=order.details[key];return typeof value==="string"||typeof value==="number"?String(value):fallback;}
function orderSummary(order:Order){const items=Array.isArray(order.details.items)?order.details.items as {name?:string;qty?:number}[]:[];if(items.length)return items.map((x)=>`${x.qty||1}× ${x.name||"Item"}`).join(", ");return order.service==="Parcel"?detail(order,"packageType","Parcel"): `${detail(order,"distance","4.2")} km trip`;}

function Brand(){ return <div className="brand"><Image src="/goocart-logo.png" alt="Goocart" width={960} height={161} priority style={{height:26,width:"auto"}}/></div>; }
function Status({value}:{value:string}){ return <span className={`status status-${value.toLowerCase()}`}>● {label(value)}</span>; }
function Empty({title,copy}:{title:string;copy:string}){ return <div className="empty-state"><i>g</i><h3>{title}</h3><p>{copy}</p></div>; }

function EyeIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>;}
function EyeOffIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a20.28 20.28 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;}

function PasswordField({label:fieldLabel,value,onChange,minLength=8}:{label:string;value:string;onChange:(value:string)=>void;minLength?:number}){
  const [visible,setVisible]=useState(false);
  return <label>{fieldLabel}<div className="password-field">
    <input required minLength={minLength} type={visible?"text":"password"} value={value} onChange={(e)=>onChange(e.target.value)}/>
    <button type="button" className="password-toggle" onClick={()=>setVisible(!visible)} aria-label={visible?"Hide password":"Show password"}>{visible?<EyeOffIcon/>:<EyeIcon/>}</button>
  </div></label>;
}

// Downscales + JPEG-compresses an uploaded image in the browser before it
// ever leaves the device, so a phone photo doesn't blow past the server's
// request body limit — images are stored as base64 directly in MongoDB
// (no external image host wired up), so keeping them small matters.
function compressImageFile(file: File, maxDimension = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not read this image."));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Image compression is not supported in this browser."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function ImageUploadField({label:fieldLabel,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const pick=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    e.target.value="";
    if(!file)return;
    setBusy(true);setError("");
    try{onChange(await compressImageFile(file));}
    catch(err){setError(err instanceof Error?err.message:"Could not process this image.");}
    finally{setBusy(false);}
  };
  return <label>{fieldLabel}<div className="image-upload-field">
    {value?<img src={value} alt="" className="image-upload-preview"/>:<div className="image-upload-preview image-upload-empty">No image</div>}
    <div className="image-upload-controls">
      <input type="file" accept="image/*" onChange={(e)=>void pick(e)} disabled={busy}/>
      {value&&<button type="button" className="secondary" onClick={()=>onChange("")}>Remove</button>}
    </div>
  </div>{busy&&<small className="muted-note">Processing image…</small>}{error&&<p className="auth-error">{error}</p>}</label>;
}

function useGoocart(){
  const [state,setState] = useState<Snapshot|null>(null); const [busy,setBusy] = useState(false); const [toast,setToast] = useState(""); const [error,setError] = useState<ErrorState|null>(null);
  const load = useCallback(async(silent=false)=>{ try{ if(!silent)setBusy(true); const res=await fetch("/api/goocart",{cache:"no-store"}); const json=await res.json() as ApiResult; if(!json.success||!json.data){setError({code:json.error?.code||"UNKNOWN",message:json.error?.message||"Unable to load Goocart"});return;} setState(json.data);setError(null); }catch(e){setError({code:"NETWORK_ERROR",message:e instanceof Error?e.message:"Unable to load Goocart"});}finally{if(!silent)setBusy(false);}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);const timer=setInterval(()=>void load(true),5000);return()=>{clearTimeout(initial);clearInterval(timer);};},[load]);
  const act=useCallback(async(body:Record<string,unknown>)=>{try{setBusy(true);const res=await fetch("/api/goocart",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const json=await res.json() as ApiResult;if(!json.success||!json.data)throw new Error(json.error?.message||"Action failed");setState(json.data);setToast(json.message||"Updated");setTimeout(()=>setToast(""),2800);return true;}catch(e){setToast(e instanceof Error?e.message:"Action failed");setTimeout(()=>setToast(""),3500);return false;}finally{setBusy(false);}},[]);
  return {state,busy,toast,error,act,retry:load};
}

async function logout(){await fetch("/api/auth/logout",{method:"POST"});window.location.reload();}

function AuthGate({onAuthenticated}:{onAuthenticated:()=>void}){
  const [isSignup,setIsSignup]=useState(false);
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");

  const submitPassword=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{const res=await fetch(isSignup?"/api/auth/signup":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(isSignup?{email,password,name}:{email,password})});const json=await res.json() as ApiResult;if(!json.success)throw new Error(json.error?.message||"Something went wrong");onAuthenticated();}
    catch(e){setError(e instanceof Error?e.message:"Something went wrong");}finally{setBusy(false);}};

  return <main className="auth-gate">
    <Brand/>
    <h1>{isSignup?"Create your account":"Sign in to Goocart Admin"}</h1>
    <p className="auth-subtitle">The operations console for the Goocart platform. Customer, vendor and delivery partner accounts use the Goocart mobile apps instead.</p>
    <form className="auth-form" onSubmit={(e)=>void submitPassword(e)}>
      {isSignup&&<label>Full name<input required minLength={2} value={name} onChange={(e)=>setName(e.target.value)}/></label>}
      <label>Email<input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)}/></label>
      <PasswordField label="Password" value={password} onChange={setPassword}/>
      {error&&<p className="auth-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Please wait...":isSignup?"Create account":"Sign in"}</button>
    </form>
    <button className="auth-switch" onClick={()=>{setIsSignup(!isSignup);setError("");}}>{isSignup?"Already have an account? Sign in":"New to Goocart? Create an account"}</button>
  </main>;
}

function Shell({page,setPage,children,state}:{page:string;setPage:(x:string)=>void;children:React.ReactNode;state:Snapshot}){return <div className="workspace"><aside><Brand/><small>ADMIN PORTAL</small><nav>{adminNav.map((x)=><button className={page===x?"active":""} onClick={()=>setPage(x)} key={x}><i>{x[0]}</i>{x}</button>)}</nav><div className="profile"><b>{state.actor.name.slice(0,2).toUpperCase()}</b><span>{state.actor.name}<small>{label(state.actor.role)}</small></span></div></aside><main><header><span><small>JANGAREDDIGUDEM • LIVE</small><h1>{page}</h1></span><div><button className="signout-link" onClick={()=>void logout()}>Sign out</button></div></header>{children}</main></div>}
function Kpis({items}:{items:[string,string,string][]}){return <section className="kpis">{items.map((x)=><article key={x[1]}><small>{x[1]}</small><strong>{x[0]}</strong><em>{x[2]}</em></article>)}</section>}
function OrdersTable({orders,act,busy}:{orders:Order[];act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){return <div className="ops-table"><div className="ops-row ops-head"><span>REFERENCE</span><span>DETAILS</span><span>STATUS</span><span>VALUE</span><span>ACTION</span></div>{orders.map((o)=><div className="ops-row" key={o.id}><b>{o.reference}</b><span>{o.vendor}<small>{o.service} • {orderSummary(o)}</small></span><Status value={o.status}/><strong>{money(o.total)}</strong><OrderAction order={o} act={act} busy={busy}/></div>)}{!orders.length&&<Empty title="No matching work" copy="New activity will appear here automatically."/>}</div>}
function OrderAction({order,act,busy}:{order:Order;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){if(terminalStatuses.includes(order.status))return null;return <div className="row-actions"><button className="danger" disabled={busy} onClick={()=>void act({action:"order.transition",id:order.id,to:"CANCELLED_BY_ADMIN"})}>Cancel</button></div>}

function Admin({state,act,busy,retry}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean;retry:()=>Promise<void>}){const [page,setPage]=useState("Dashboard");const orders=state.orders;const gmv=orders.reduce((s,x)=>s+x.total,0);const active=orders.filter((x)=>!terminalStatuses.includes(x.status));const rides=orders.filter((x)=>x.service==="Bike Taxi");const parcels=orders.filter((x)=>x.service==="Parcel");return <Shell page={page} setPage={setPage} state={state}>{page==="Dashboard"&&<><div className="overview"><span><small>Command center</small><h2>Operations at a glance.</h2></span><b>LIVE DATA</b></div><Kpis items={[[money(gmv),"Total GMV","All services"],[String(orders.length),"Total orders & jobs","Live"],[String(active.length),"Active operations","Now"],[String(state.services.filter((x)=>x.enabled).length),"Enabled services","of 6"]]}/><section className="panel"><div><span><h2>Live operations</h2><small>Customer, vendor and partner activity</small></span></div><OrdersTable orders={active.slice(0,7)} act={act} busy={busy}/></section></>}{page==="Live Orders"&&<AdminLiveOrders/>}{["Live Operations","Orders"].includes(page)&&<WorkspacePage eyebrow="REALTIME OPERATIONS" title={page} copy="Monitor status and intervene when necessary."><OrdersTable orders={page==="Orders"?orders:active} act={act} busy={busy}/></WorkspacePage>}{page==="Rides"&&<WorkspacePage eyebrow="RIDE ENGINE" title="Bike taxi" copy="Ride requests, driver assignments and completions."><OrdersTable orders={rides} act={act} busy={busy}/></WorkspacePage>}{page==="Parcels"&&<WorkspacePage eyebrow="PARCEL ENGINE" title="Parcel operations" copy="Pickup, transit and delivery verification."><OrdersTable orders={parcels} act={act} busy={busy}/></WorkspacePage>}{page==="Catalog"&&<AdminCatalog state={state} act={act} busy={busy} retry={retry}/>} {page==="Discounts & Pricing"&&<AdminDiscounts/>} {page==="Automation"&&<AdminAutomation/>} {page==="Settings"&&<AdminSettings state={state} act={act}/>} {page==="Finance"&&<AdminFinance/>} {page==="Vendors"&&<AdminVendors/>} {page==="Delivery Partners"&&<AdminPartners/>} {page==="Customers"&&<AdminCustomers/>} {page==="Support"&&<AdminSupport/>} {page==="Reports"&&<StatsPage title="Performance reports" stats={allServices.map((x)=>{const rows=orders.filter((o)=>o.service===x);return [x,`${rows.length} orders • ${money(rows.reduce((s,o)=>s+o.total,0))}`];})}/>}</Shell>}
function AdminCatalog({state,act,busy,retry}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>;busy:boolean;retry:()=>Promise<void>}){
  const [showCreate,setShowCreate]=useState(false);
  const [error,setError]=useState("");
  const remove=async(id:string)=>{if(!confirm("Delete this product?"))return;try{await adminApi(`/products/${id}`,{method:"DELETE"});await retry();}catch(e){setError(e instanceof Error?e.message:"Could not delete this product");}};
  return <WorkspacePage eyebrow="CATALOG & INVENTORY" title="All products" copy="Grocery, Vegetables and Mart items — create new ones, adjust stock, or remove them.">
    {error&&<p className="auth-error">{error}</p>}
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Product"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreateProductForm onCreated={()=>{setShowCreate(false);void retry();}}/>}
    <div className="inventory-list">{state.products.map((p)=><article key={p.id}>{p.image_url?<img src={p.image_url} alt="" className="vendor-thumb"/>:<i>{p.name[0]}</i>}<span><small>{p.service} • {p.vendor}</small><h3>{p.name}</h3><p>{money(p.price)} • ★ {p.rating}</p></span><b className={p.stock<15?"low-stock":""}>{p.stock} stock</b><div className="qty"><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:-1})}>−</button><button disabled={busy} onClick={()=>void act({action:"stock.adjust",id:p.id,amount:5})}>+5</button></div><button className="secondary danger-text" onClick={()=>void remove(p.id)}>Delete</button></article>)}</div>
  </WorkspacePage>;
}

function CreateProductForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({service:"Grocery",name:"",description:"",imageUrl:"",price:"",stock:"0"});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi("/products",{method:"POST",body:JSON.stringify({service:form.service,name:form.name,description:form.description,imageUrl:form.imageUrl,price:Number(form.price),stock:Number(form.stock)})});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create this product");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Service
      <select value={form.service} onChange={(e)=>setForm({...form,service:e.target.value})}>
        <option value="Grocery">Grocery</option>
        <option value="Vegetables">Vegetables</option>
        <option value="Mart">Mart</option>
      </select>
    </label>
    <ImageUploadField label="Product photo" value={form.imageUrl} onChange={(imageUrl)=>setForm({...form,imageUrl})}/>
    <label>Product name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Description (optional)<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
    <label>Price (₹)<input required type="number" min="1" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})}/></label>
    <label>Stock<input type="number" min="0" value={form.stock} onChange={(e)=>setForm({...form,stock:e.target.value})}/></label>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create product"}</button>
  </form>;
}
function AdminSettings({state,act}:{state:Snapshot;act:(x:Record<string,unknown>)=>Promise<boolean>}){return <WorkspacePage eyebrow="SERVICE AREA" title="Jangareddigudem" copy="Enable services independently for this operating area."><div className="setting-list">{state.services.map((s)=><article key={s.service}><i>{s.service[0]}</i><span><b>{s.service}</b><small>{s.enabled?"Available to customers":"Temporarily unavailable"}</small></span><button className={s.enabled?"toggle on":"toggle"} onClick={()=>void act({action:"service.toggle",service:s.service,enabled:!s.enabled})}><i/></button></article>)}</div></WorkspacePage>}

type AdminAutomationSettings = {
  featureFlags:Record<string,boolean>;
  dispatch:{ offerTimeoutSeconds:number; initialRadiusKm:number; maxRadiusKm:number; radiusStepKm:number; maxOfferAttempts:number; averageCitySpeedKmph:number; targetArrivalBufferMinutes:number; weights:Record<string,number> };
  vendor:{ smartAutoAcceptEnabled:boolean; defaultMaxSimultaneousOrders:number; defaultAveragePreparationMinutes:number; defaultMaximumQueue:number };
};

const AUTOMATION_FLAGS:{key:string;label:string;copy:string}[] = [
  {key:"smart_dispatch",label:"Smart delivery dispatch",copy:"Scores partners by distance, ETA, availability, reliability and workload."},
  {key:"vendor_auto_accept",label:"Vendor auto accept",copy:"Lets eligible restaurants accept orders automatically when they are open and not overloaded."},
  {key:"smart_coupons",label:"Smart coupons",copy:"Reserved switch for behavior-based offers and recovery discounts."},
  {key:"order_recovery",label:"Order recovery",copy:"Reserved switch for abandoned cart and failed order recovery."},
  {key:"loyalty",label:"Loyalty & wallet",copy:"Reserved switch for future wallet, coins and membership flows."},
  {key:"fraud_detection",label:"Risk checks",copy:"Reserved switch for duplicate/fraud pattern detection."}
];

function AdminAutomation(){
  const [settings,setSettings]=useState<AdminAutomationSettings|null>(null);
  const [form,setForm]=useState<AdminAutomationSettings|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{settings:AdminAutomationSettings}>("/automation/settings");setSettings(r.settings);setForm(r.settings);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load automation settings");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const setFlag=(key:string,value:boolean)=>{if(!form)return;setForm({...form,featureFlags:{...form.featureFlags,[key]:value}});};
  const setDispatch=(key:keyof AdminAutomationSettings["dispatch"],value:number)=>{if(!form)return;setForm({...form,dispatch:{...form.dispatch,[key]:value}});};
  const setVendor=(key:keyof AdminAutomationSettings["vendor"],value:number|boolean)=>{if(!form)return;setForm({...form,vendor:{...form.vendor,[key]:value}});};
  const save=async()=>{if(!form)return;setBusy(true);setError("");setSaved("");try{const r=await adminApi<{settings:AdminAutomationSettings}>("/automation/settings",{method:"PATCH",body:JSON.stringify(form)});setSettings(r.settings);setForm(r.settings);setSaved("Automation settings saved. New orders will use this flow.");setTimeout(()=>setSaved(""),3000);}catch(e){setError(e instanceof Error?e.message:"Could not save automation settings");}finally{setBusy(false);}};
  if(!form)return <WorkspacePage eyebrow="AUTOMATION CONTROL" title="Automation" copy="Loading smart dispatch and vendor automation settings.">{error?<p className="auth-error">{error}</p>:<Empty title="Loading…" copy="Fetching automation rules."/>}</WorkspacePage>;
  const activeFlags=Object.values(form.featureFlags).filter(Boolean).length;
  return <WorkspacePage eyebrow="AUTOMATION CONTROL" title="Smart operations" copy="Control which automatic flows are live. These settings affect fresh orders without redeploying the app.">
    {error&&<p className="auth-error">{error}</p>}
    {saved&&<p className="success-note">{saved}</p>}
    <Kpis items={[[String(activeFlags),"Active automation flags","Platform"],[`${form.dispatch.initialRadiusKm}-${form.dispatch.maxRadiusKm} km`,"Dispatch search radius","Auto expands"],[`${form.dispatch.offerTimeoutSeconds}s`,"Partner offer timer","Before retry"],[String(form.vendor.defaultMaxSimultaneousOrders),"Default vendor capacity","Orders"]]}/>
    <section className="panel">
      <div><span><h2>Live switches</h2><small>Turn major automatic flows on or off from admin.</small></span></div>
      <div className="setting-list">{AUTOMATION_FLAGS.map((flag)=><article key={flag.key}><i>{flag.label[0]}</i><span><b>{flag.label}</b><small>{flag.copy}</small></span><button className={form.featureFlags[flag.key]?"toggle on":"toggle"} onClick={()=>setFlag(flag.key,!form.featureFlags[flag.key])}><i/></button></article>)}</div>
    </section>
    <section className="panel">
      <div><span><h2>Smart delivery dispatch</h2><small>Partner matching now scores real readiness, distance and workload.</small></span></div>
      <form className="auth-form inline-form">
        <label>Offer timeout (seconds)<input type="number" min="10" max="180" value={form.dispatch.offerTimeoutSeconds} onChange={(e)=>setDispatch("offerTimeoutSeconds",Number(e.target.value))}/></label>
        <label>Initial radius (km)<input type="number" min="0.5" step="0.5" value={form.dispatch.initialRadiusKm} onChange={(e)=>setDispatch("initialRadiusKm",Number(e.target.value))}/></label>
        <label>Maximum radius (km)<input type="number" min="1" step="0.5" value={form.dispatch.maxRadiusKm} onChange={(e)=>setDispatch("maxRadiusKm",Number(e.target.value))}/></label>
        <label>Radius step (km)<input type="number" min="0.5" step="0.5" value={form.dispatch.radiusStepKm} onChange={(e)=>setDispatch("radiusStepKm",Number(e.target.value))}/></label>
        <label>Maximum offer attempts<input type="number" min="1" max="10" value={form.dispatch.maxOfferAttempts} onChange={(e)=>setDispatch("maxOfferAttempts",Number(e.target.value))}/></label>
        <label>City speed estimate (km/h)<input type="number" min="5" max="80" value={form.dispatch.averageCitySpeedKmph} onChange={(e)=>setDispatch("averageCitySpeedKmph",Number(e.target.value))}/></label>
        <label>Arrival buffer (minutes)<input type="number" min="0" max="30" value={form.dispatch.targetArrivalBufferMinutes} onChange={(e)=>setDispatch("targetArrivalBufferMinutes",Number(e.target.value))}/></label>
      </form>
    </section>
    <section className="panel">
      <div><span><h2>Vendor smart auto accept</h2><small>Restaurants can auto-accept only while open, active and below capacity.</small></span></div>
      <form className="auth-form inline-form">
        <label className="checkbox-label"><input type="checkbox" checked={form.vendor.smartAutoAcceptEnabled} onChange={(e)=>setVendor("smartAutoAcceptEnabled",e.target.checked)}/>Enable smart vendor auto-accept globally</label>
        <label>Default max live orders<input type="number" min="1" max="200" value={form.vendor.defaultMaxSimultaneousOrders} onChange={(e)=>setVendor("defaultMaxSimultaneousOrders",Number(e.target.value))}/></label>
        <label>Default preparation minutes<input type="number" min="1" max="240" value={form.vendor.defaultAveragePreparationMinutes} onChange={(e)=>setVendor("defaultAveragePreparationMinutes",Number(e.target.value))}/></label>
        <label>Default queue limit<input type="number" min="1" max="500" value={form.vendor.defaultMaximumQueue} onChange={(e)=>setVendor("defaultMaximumQueue",Number(e.target.value))}/></label>
      </form>
    </section>
    <button className="primary" disabled={busy||JSON.stringify(settings)===JSON.stringify(form)} onClick={()=>void save()}>{busy?"Saving…":"Save automation"}</button>
  </WorkspacePage>;
}

type AdminRestaurant = { id:string; name:string; imageUrl:string|null; area:string; address:string; latitude:number; longitude:number; isOpen:boolean; status:string; rating:number; ratingCount:number; commissionPercent:number|null; effectiveCommissionPercent:number; totalOrders:number; totalOrderValue:number; commissionPayout:number; manualOrderAcceptance:boolean; autoAcceptanceMode:"MANUAL"|"AUTOMATIC"|"SMART_AUTOMATIC"; temporaryBusyMode:boolean; maxSimultaneousOrders:number; averagePreparationMinutes:number; maximumQueue:number; owner:{id:string;name:string;email:string;username:string|null}|null; offers:{id:string;title:string;description:string|null}[] };
type AdminVendorUser = { id:string; name:string; email:string; username?:string|null; role:string; status:string };
type AdminVendorTeamMember = { id:string; name:string; email:string; phone:string|null; role:string; status:string; staffTitle:string|null; isPrimaryOwner:boolean; permissions:string[] };
async function adminApi<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`/api/v1/admin${path}`,{...init,headers:{"content-type":"application/json",...init?.headers}});const json=await res.json() as {success:boolean;data?:T;error?:{message:string}};if(!json.success||!json.data)throw new Error(json.error?.message||"Request failed");return json.data;}

const VENDOR_PERMISSIONS = ["CAN_VIEW_ORDERS","CAN_ACCEPT_ORDER","CAN_REJECT_ORDER","CAN_UPDATE_ORDER_STATUS","CAN_MARK_READY","CAN_MANAGE_PRODUCTS","CAN_MANAGE_STOCK","CAN_MANAGE_PRICES","CAN_MANAGE_OFFERS","CAN_VIEW_REPORTS","CAN_MANAGE_VENDOR_USERS"];

function AdminVendors(){
  const [restaurants,setRestaurants]=useState<AdminRestaurant[]|null>(null);
  const [vendors,setVendors]=useState<AdminVendorUser[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [showCreate,setShowCreate]=useState(false);
  const [editing,setEditing]=useState<string|null>(null);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [expandedOffers,setExpandedOffers]=useState<string|null>(null);
  const [expandedAutomation,setExpandedAutomation]=useState<string|null>(null);
  const [menuFor,setMenuFor]=useState<AdminRestaurant|null>(null);
  const load=useCallback(async()=>{try{const [r,v]=await Promise.all([adminApi<{restaurants:AdminRestaurant[]}>("/restaurants"),adminApi<{vendors:AdminVendorUser[]}>("/vendors")]);setRestaurants(r.restaurants);setVendors(v.vendors);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load vendors");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const assign=async(restaurantId:string,userId:string)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/owner`,{method:"PATCH",body:JSON.stringify({userId:userId||null})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not assign owner");}finally{setBusy(false);}};
  const toggleManual=async(r:AdminRestaurant)=>{setBusy(true);try{await adminApi(`/restaurants/${r.id}/manual-acceptance`,{method:"PATCH",body:JSON.stringify({manualOrderAcceptance:!r.manualOrderAcceptance})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this vendor's setting");}finally{setBusy(false);}};
  const remove=async(r:AdminRestaurant)=>{if(!confirm(`Delete "${r.name}"? Vendors with order history are disabled instead of permanently deleted.`))return;setBusy(true);try{const res=await adminApi<{deleted:boolean;disabled?:boolean}>(`/restaurants/${r.id}`,{method:"DELETE"});await load();if(res.disabled)alert(`"${r.name}" has order history, so it was disabled instead of deleted.`);}catch(e){setError(e instanceof Error?e.message:"Could not delete this vendor");}finally{setBusy(false);}};

  if(menuFor)return <VendorMenuGrid restaurant={menuFor} onBack={()=>setMenuFor(null)}/>;

  return <WorkspacePage eyebrow="VENDOR ACCOUNTS" title="Restaurants & owners" copy="Create vendors, link owners, control order acceptance, and manage each vendor's Vendor App team.">
    {error&&<p className="auth-error">{error}</p>}
    <FlowSteps steps={[
      ["1","Create vendor","Add restaurant details, a photo and the owner login credentials."],
      ["2","Set automation","Choose manual, auto, or smart auto-accept with kitchen capacity."],
      ["3","Add menu & offers","Create live dishes with photos and prices, and percentage offers."],
      ["4","Manage team","Add managers or staff and give only the permissions they need."],
    ]}/>
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Vendor"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreateVendorForm onCreated={()=>{setShowCreate(false);void load();}}/>}
    {restaurants===null?<Empty title="Loading…" copy="Fetching restaurants and vendor accounts."/>:!restaurants.length?<Empty title="No restaurants yet" copy="Create one above, or seed the catalog to see restaurants here."/>:
    <div className="directory">{restaurants.map((r)=><article key={r.id} className="vendor-row">
      <div className="vendor-row-head">
        {r.imageUrl?<img src={r.imageUrl} alt="" className="vendor-thumb"/>:<i>{r.name[0]}</i>}
        <span><b>{r.name}</b><small>Vendor ID {r.id}{r.owner?.username?` • @${r.owner.username}`:""} • {r.area} • {r.isOpen?"Open":"Closed"} • {r.status} • {label(r.autoAcceptanceMode)}{r.temporaryBusyMode?" • Busy mode":""}{r.owner?` • Owned by ${r.owner.name}`:" • Unassigned"}</small></span>
        <button className="toggle-labelled" onClick={()=>void toggleManual(r)} disabled={busy} title="Require Vendor Order Acceptance">
          <span className={r.manualOrderAcceptance?"toggle on":"toggle"}><i/></span>
          <small>{r.manualOrderAcceptance?"Manual accept ON":"Auto-accept ON"}</small>
        </button>
      </div>
      <div className="vendor-stats">
        <span><b>{r.totalOrders}</b><small>Successful orders</small></span>
        <span><b>{money(r.totalOrderValue)}</b><small>Order value</small></span>
        <span><b>{money(r.commissionPayout)}</b><small>Commission ({r.effectiveCommissionPercent}%)</small></span>
        <span><b>★ {(r.rating||0).toFixed(1)}</b><small>{r.ratingCount} ratings</small></span>
      </div>
      <div className="vendor-row-actions">
        <select disabled={busy} value={r.owner?.id||""} onChange={(e)=>void assign(r.id,e.target.value)} aria-label={`Assign owner for ${r.name}`}>
          <option value="">Unassigned</option>
          {vendors.map((v)=><option key={v.id} value={v.id}>{v.name} ({v.email})</option>)}
        </select>
        <button className="secondary" onClick={()=>setEditing(editing===r.id?null:r.id)}>{editing===r.id?"Cancel edit":"Edit vendor"}</button>
        <button className="secondary" onClick={()=>setMenuFor(r)}>Menu</button>
        <button className="secondary" onClick={()=>setExpandedOffers(expandedOffers===r.id?null:r.id)}>{expandedOffers===r.id?"Hide offers":"Offers (%)"}</button>
        <button className="secondary" onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?"Hide team":"Team"}</button>
        <button className="secondary" onClick={()=>setExpandedAutomation(expandedAutomation===r.id?null:r.id)}>{expandedAutomation===r.id?"Hide automation":"Automation"}</button>
        <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(r)}>Delete</button>
      </div>
      {editing===r.id&&<EditVendorForm restaurant={r} onSaved={()=>{setEditing(null);void load();}}/>}
      {expanded===r.id&&<VendorTeamPanel restaurantId={r.id}/>}
      {expandedAutomation===r.id&&<RestaurantAutomationPanel restaurant={r} onChange={load}/>}
      {expandedOffers===r.id&&<VendorPercentOffersPanel restaurantId={r.id}/>}
    </article>)}</div>}
  </WorkspacePage>;
}

function PrimaryActionButton({label,onClick}:{label:string;onClick:()=>void}){return <button className="primary" style={{width:"max-content",marginBottom:14}} onClick={onClick}>{label}</button>;}

function FlowSteps({steps}:{steps:[string,string,string][]}){return <div className="flow-steps">{steps.map((step)=><article key={step[0]}><i>{step[0]}</i><span><b>{step[1]}</b><small>{step[2]}</small></span></article>)}</div>;}

function CreateVendorForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({name:"",imageUrl:"",area:"",address:"",businessType:"",commissionPercent:"",ownerName:"",ownerUsername:"",ownerEmail:"",ownerPhone:"",initialPassword:"",manualOrderAcceptance:true});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [created,setCreated]=useState<{name:string;vendorId:string;username:string;email:string;password:string}|null>(null);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      const res=await adminApi<{restaurant:{id:string}}>("/restaurants",{method:"POST",body:JSON.stringify({name:form.name,imageUrl:form.imageUrl||null,area:form.area,address:form.address,businessType:form.businessType||null,commissionPercent:form.commissionPercent===""?null:Number(form.commissionPercent),ownerName:form.ownerName,ownerUsername:form.ownerUsername||undefined,ownerEmail:form.ownerEmail,ownerPhone:form.ownerPhone||undefined,initialPassword:form.initialPassword,manualOrderAcceptance:form.manualOrderAcceptance})});
      setCreated({name:form.name,vendorId:res.restaurant.id,username:form.ownerUsername,email:form.ownerEmail,password:form.initialPassword});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create vendor");}finally{setBusy(false);}
  };
  if(created)return <div className="auth-form inline-form">
    <p><b>{created.name}</b> was created.</p>
    <p className="muted-note">Vendor ID: <b>{created.vendorId}</b>{created.username?<> • Username: <b>{created.username}</b></>:null}<br/>Login email: <b>{created.email}</b> • Temporary password: <b>{created.password}</b><br/>A welcome email with these credentials was sent to the vendor (delivery depends on email being configured on this server).</p>
  </div>;
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <ImageUploadField label="Shop / restaurant photo" value={form.imageUrl} onChange={(imageUrl)=>setForm({...form,imageUrl})}/>
    <label>Business (shop / restaurant) name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Address<input required value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></label>
    <label>Area<input required value={form.area} onChange={(e)=>setForm({...form,area:e.target.value})}/></label>
    <label>Business type<input value={form.businessType} onChange={(e)=>setForm({...form,businessType:e.target.value})}/></label>
    <label>Commission rate (%)<input type="number" min="0" max="100" step="0.1" placeholder="Platform default" value={form.commissionPercent} onChange={(e)=>setForm({...form,commissionPercent:e.target.value})}/></label>
    <label>Owner full name<input required value={form.ownerName} onChange={(e)=>setForm({...form,ownerName:e.target.value})}/></label>
    <label>Owner username (optional)<input value={form.ownerUsername} onChange={(e)=>setForm({...form,ownerUsername:e.target.value.toLowerCase()})}/></label>
    <label>Owner email<input required type="email" value={form.ownerEmail} onChange={(e)=>setForm({...form,ownerEmail:e.target.value})}/></label>
    <label>Owner phone<input value={form.ownerPhone} onChange={(e)=>setForm({...form,ownerPhone:e.target.value})}/></label>
    <PasswordField label="Temporary password" value={form.initialPassword} onChange={(value)=>setForm({...form,initialPassword:value})}/>
    <label className="checkbox-label"><input type="checkbox" checked={form.manualOrderAcceptance} onChange={(e)=>setForm({...form,manualOrderAcceptance:e.target.checked})}/>Require vendor order acceptance</label>
    <p className="muted-note">The vendor ID and map location are generated automatically from the address. A welcome email with the username, email and temporary password is sent to the owner on creation.</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create vendor"}</button>
  </form>;
}

function EditVendorForm({restaurant,onSaved}:{restaurant:AdminRestaurant;onSaved:()=>void}){
  const [form,setForm]=useState({name:restaurant.name,imageUrl:restaurant.imageUrl||"",area:restaurant.area,address:restaurant.address||"",commissionPercent:restaurant.commissionPercent===null?"":String(restaurant.commissionPercent)});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi(`/restaurants/${restaurant.id}`,{method:"PATCH",body:JSON.stringify({name:form.name,imageUrl:form.imageUrl||null,area:form.area,address:form.address,commissionPercent:form.commissionPercent===""?null:Number(form.commissionPercent)})});
      onSaved();
    }catch(e){setError(e instanceof Error?e.message:"Could not save this vendor");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void save(e)}>
    <ImageUploadField label="Shop / restaurant photo" value={form.imageUrl} onChange={(imageUrl)=>setForm({...form,imageUrl})}/>
    <label>Business name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Address<input required value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></label>
    <label>Area<input required value={form.area} onChange={(e)=>setForm({...form,area:e.target.value})}/></label>
    <label>Commission rate (%)<input type="number" min="0" max="100" step="0.1" placeholder="Platform default" value={form.commissionPercent} onChange={(e)=>setForm({...form,commissionPercent:e.target.value})}/></label>
    <p className="muted-note">Changing address or area re-derives the map location automatically.</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Saving…":"Save vendor"}</button>
  </form>;
}

function RestaurantAutomationPanel({restaurant,onChange}:{restaurant:AdminRestaurant;onChange:()=>Promise<void>}){
  const [form,setForm]=useState({
    autoAcceptanceMode:restaurant.autoAcceptanceMode||"MANUAL",
    temporaryBusyMode:restaurant.temporaryBusyMode,
    maxSimultaneousOrders:String(restaurant.maxSimultaneousOrders||12),
    averagePreparationMinutes:String(restaurant.averagePreparationMinutes||25),
    maximumQueue:String(restaurant.maximumQueue||20)
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi(`/restaurants/${restaurant.id}/automation`,{method:"PATCH",body:JSON.stringify({
        autoAcceptanceMode:form.autoAcceptanceMode,
        temporaryBusyMode:form.temporaryBusyMode,
        maxSimultaneousOrders:Number(form.maxSimultaneousOrders),
        averagePreparationMinutes:Number(form.averagePreparationMinutes),
        maximumQueue:Number(form.maximumQueue)
      })});
      await onChange();
    }catch(e){setError(e instanceof Error?e.message:"Could not save restaurant automation");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void save(e)}>
    <label>Acceptance flow
      <select value={form.autoAcceptanceMode} onChange={(e)=>setForm({...form,autoAcceptanceMode:e.target.value as AdminRestaurant["autoAcceptanceMode"]})}>
        <option value="MANUAL">Manual accept in Vendor App</option>
        <option value="AUTOMATIC">Always auto-accept</option>
        <option value="SMART_AUTOMATIC">Smart auto-accept by capacity</option>
      </select>
    </label>
    <label>Max simultaneous live orders<input required type="number" min="1" max="200" value={form.maxSimultaneousOrders} onChange={(e)=>setForm({...form,maxSimultaneousOrders:e.target.value})}/></label>
    <label>Average preparation minutes<input required type="number" min="1" max="240" value={form.averagePreparationMinutes} onChange={(e)=>setForm({...form,averagePreparationMinutes:e.target.value})}/></label>
    <label>Maximum queue<input required type="number" min="1" max="500" value={form.maximumQueue} onChange={(e)=>setForm({...form,maximumQueue:e.target.value})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.temporaryBusyMode} onChange={(e)=>setForm({...form,temporaryBusyMode:e.target.checked})}/>Temporary busy mode</label>
    <p className="muted-note">Smart auto-accept only works when the restaurant is open, active, not in busy mode, and below these limits.</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Saving…":"Save restaurant automation"}</button>
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
  const resetAccess=async(userId:string)=>{const password=prompt("Enter a new temporary password (minimum 8 characters), or leave blank to only sign out existing devices:")??"";if(password&&password.length<8){setError("Password must be at least 8 characters.");return;}setBusy(true);try{await adminApi(`/restaurants/${restaurantId}/users/${userId}/reset-access`,{method:"POST",body:JSON.stringify({password})});}catch(e){setError(e instanceof Error?e.message:"Could not reset access");}finally{setBusy(false);}};
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
  const [form,setForm]=useState({name:"",email:"",phone:"",role:"VENDOR_STAFF",staffTitle:"",initialPassword:""});
  const [permissions,setPermissions]=useState<string[]>(["CAN_VIEW_ORDERS"]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const togglePerm=(p:string)=>setPermissions(permissions.includes(p)?permissions.filter((x)=>x!==p):[...permissions,p]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi(`/restaurants/${restaurantId}/users`,{method:"POST",body:JSON.stringify({name:form.name,email:form.email,phone:form.phone||undefined,role:form.role,staffTitle:form.staffTitle||null,initialPassword:form.initialPassword,permissions})});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create this vendor user");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Full name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Email<input required type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
    <label>Phone (optional)<input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
    <label>Title (e.g. Kitchen Staff)<input value={form.staffTitle} onChange={(e)=>setForm({...form,staffTitle:e.target.value})}/></label>
    <PasswordField label="Initial password" value={form.initialPassword} onChange={(value)=>setForm({...form,initialPassword:value})}/>
    <label>Role
      <select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}>
        <option value="VENDOR_OWNER">Owner</option>
        <option value="VENDOR_MANAGER">Manager</option>
        <option value="VENDOR_STAFF">Staff</option>
      </select>
    </label>
    <div className="permission-grid">{VENDOR_PERMISSIONS.map((p)=><label key={p} className="checkbox-label small"><input type="checkbox" checked={permissions.includes(p)} onChange={()=>togglePerm(p)}/>{label(p.replace("CAN_",""))}</label>)}</div>
    <p className="muted-note">They can sign in with this password or request an email OTP. Existing sessions are always revocable here.</p>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create vendor user"}</button>
  </form>;
}

function VendorPercentOffersPanel({restaurantId}:{restaurantId:string}){
  const [coupons,setCoupons]=useState<AdminCoupon[]|null>(null);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({title:"",percent:"",minOrder:"0"});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{coupons:AdminCoupon[]}>("/coupons");setCoupons(r.coupons.filter((c)=>c.targetRestaurantIds.includes(restaurantId)));setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load offers");}},[restaurantId]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const add=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      const code=`${(form.title.toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,10)||"offer")}${Date.now().toString(36)}`.toUpperCase();
      await adminApi("/coupons",{method:"POST",body:JSON.stringify({code,title:form.title,type:"PERCENT",value:Number(form.percent),minOrder:Number(form.minOrder)||0,targetRestaurantIds:[restaurantId]})});
      setForm({title:"",percent:"",minOrder:"0"});setShowAdd(false);await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not add this offer");}finally{setBusy(false);}
  };
  const toggle=async(c:AdminCoupon)=>{setBusy(true);try{await adminApi(`/coupons/${c.id}`,{method:"PATCH",body:JSON.stringify({active:!c.active})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this offer");}finally{setBusy(false);}};
  const remove=async(c:AdminCoupon)=>{setBusy(true);try{await adminApi(`/coupons/${c.id}`,{method:"DELETE"});await load();}catch(e){setError(e instanceof Error?e.message:"Could not remove this offer");}finally{setBusy(false);}};

  return <div className="team-panel">
    {error&&<p className="auth-error">{error}</p>}
    <p className="muted-note">These are real, functioning percentage discounts customers can apply at checkout for this vendor (not just a display banner).</p>
    {coupons===null?<p className="muted-note">Loading offers…</p>:!coupons.length?<p className="muted-note">No percentage offers for this vendor yet.</p>:
      <div className="team-list">{coupons.map((c)=><div key={c.id} className="team-member">
        <div className="team-member-head">
          <b>{c.title||c.code}</b><small>{c.value}% off{c.minOrder?` • Min order ₹${c.minOrder}`:""} • Code {c.code}</small>
          <span className={`status status-${c.active?"active":"suspended"}`}>● {c.active?"Active":"Paused"}</span>
        </div>
        <div className="team-member-actions">
          <button className="secondary" disabled={busy} onClick={()=>void toggle(c)}>{c.active?"Pause":"Activate"}</button>
          <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(c)}>Remove</button>
        </div>
      </div>)}</div>}
    <PrimaryActionButton label={showAdd?"Cancel":"+ Add % Offer"} onClick={()=>setShowAdd(!showAdd)}/>
    {showAdd&&<form className="auth-form inline-form" onSubmit={(e)=>void add(e)}>
      <label>{'Offer title (e.g. "Weekend 20% off")'}<input required value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></label>
      <label>Discount (%)<input required type="number" min="1" max="100" value={form.percent} onChange={(e)=>setForm({...form,percent:e.target.value})}/></label>
      <label>Minimum order (₹, optional)<input type="number" min="0" value={form.minOrder} onChange={(e)=>setForm({...form,minOrder:e.target.value})}/></label>
      {error&&<p className="auth-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Adding…":"Add offer"}</button>
    </form>}
  </div>;
}

type AdminMenuItem = { id:string; name:string; description:string; imageUrl:string|null; price:number; discountPercent:number; veg:boolean; available:boolean; categoryId:string };

function VendorMenuGrid({restaurant,onBack}:{restaurant:AdminRestaurant;onBack:()=>void}){
  const [items,setItems]=useState<AdminMenuItem[]|null>(null);
  const [showAdd,setShowAdd]=useState(false);
  const [editingItem,setEditingItem]=useState<AdminMenuItem|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{items:AdminMenuItem[]}>(`/restaurants/${restaurant.id}/menu`);setItems(r.items);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load this restaurant's menu");}},[restaurant.id]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const toggleAvailable=async(item:AdminMenuItem)=>{setBusy(true);try{await adminApi(`/restaurants/${restaurant.id}/menu/${item.id}`,{method:"PATCH",body:JSON.stringify({available:!item.available})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update this item");}finally{setBusy(false);}};
  const remove=async(item:AdminMenuItem)=>{if(!confirm(`Delete "${item.name}"?`))return;setBusy(true);try{await adminApi(`/restaurants/${restaurant.id}/menu/${item.id}`,{method:"DELETE"});await load();}catch(e){setError(e instanceof Error?e.message:"Could not delete this item");}finally{setBusy(false);}};

  return <WorkspacePage eyebrow={`MENU — ${restaurant.name.toUpperCase()}`} title="Menu items" copy="Every dish on this vendor's menu, with photos, pricing and per-item discounts.">
    <button className="secondary" style={{marginBottom:14}} onClick={onBack}>← Back to vendors</button>
    {error&&<p className="auth-error">{error}</p>}
    <div className="menu-grid-toolbar">
      <PrimaryActionButton label={showAdd?"Cancel":"+ Add Menu Item"} onClick={()=>{setEditingItem(null);setShowAdd(!showAdd);}}/>
    </div>
    {showAdd&&<MenuItemForm restaurantId={restaurant.id} onDone={()=>{setShowAdd(false);void load();}}/>}
    {items===null?<Empty title="Loading…" copy="Fetching this vendor's menu."/>:!items.length?<Empty title="No menu items yet" copy="Add the first dish above."/>:
    <div className="menu-grid">{items.map((item)=><article key={item.id} className="menu-card">
      {item.imageUrl?<img src={item.imageUrl} alt="" className="menu-card-image"/>:<div className="menu-card-image menu-card-image-empty">No photo</div>}
      {item.discountPercent>0&&<span className="menu-card-discount">{item.discountPercent}% OFF</span>}
      <div className="menu-card-body">
        <b>{item.name}</b>
        <small>{item.veg?"Veg":"Non-veg"} • ₹{item.price}</small>
        {item.description&&<p className="muted-note">{item.description}</p>}
        <span className={`status status-${item.available?"active":"suspended"}`}>● {item.available?"Available":"Unavailable"}</span>
      </div>
      {editingItem?.id===item.id?<MenuItemForm restaurantId={restaurant.id} item={item} onDone={()=>{setEditingItem(null);void load();}}/>:
      <div className="menu-card-actions">
        <button className="secondary" disabled={busy} onClick={()=>{setShowAdd(false);setEditingItem(item);}}>Edit</button>
        <button className="secondary" disabled={busy} onClick={()=>void toggleAvailable(item)}>{item.available?"Mark unavailable":"Mark available"}</button>
        <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(item)}>Delete</button>
      </div>}
    </article>)}</div>}
  </WorkspacePage>;
}

function MenuItemForm({restaurantId,item,onDone}:{restaurantId:string;item?:AdminMenuItem;onDone:()=>void}){
  const [form,setForm]=useState({name:item?.name||"",description:item?.description||"",imageUrl:item?.imageUrl||"",price:item?item.price!==undefined?String(item.price):"":"",discountPercent:item?String(item.discountPercent||0):"0",categoryKey:item?.categoryId||"mains",veg:item?item.veg:true});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      const body=JSON.stringify({name:form.name,description:form.description,imageUrl:form.imageUrl||null,price:Number(form.price),discountPercent:Number(form.discountPercent)||0,categoryKey:form.categoryKey,veg:form.veg});
      if(item)await adminApi(`/restaurants/${restaurantId}/menu/${item.id}`,{method:"PATCH",body});
      else await adminApi(`/restaurants/${restaurantId}/menu`,{method:"POST",body});
      onDone();
    }catch(e){setError(e instanceof Error?e.message:"Could not save this menu item");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <ImageUploadField label="Dish photo" value={form.imageUrl} onChange={(imageUrl)=>setForm({...form,imageUrl})}/>
    <label>Dish name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Description (optional)<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
    <label>Price (₹)<input required type="number" min="1" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})}/></label>
    <label>Discount (%, optional)<input type="number" min="0" max="100" value={form.discountPercent} onChange={(e)=>setForm({...form,discountPercent:e.target.value})}/></label>
    <label>Category key (e.g. mains, starters)<input required value={form.categoryKey} onChange={(e)=>setForm({...form,categoryKey:e.target.value})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.veg} onChange={(e)=>setForm({...form,veg:e.target.checked})}/>Vegetarian</label>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Saving…":item?"Save changes":"Add menu item"}</button>
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

type AdminPartnerRow = { id:string; name:string; email:string; phone:string|null; photoUrl:string|null; vehicleType:string|null; vehicleNumber:string|null; aadhaarNumber:string|null; panNumber:string|null; bankDetails:{accountNumber?:string;ifsc?:string;accountHolderName?:string}|null; status:string; partnerApprovalStatus:string; partnerOnline:boolean; partnerBusy:boolean; partnerRating:number; partnerCompletedDeliveries:number };

function AdminPartners(){
  const [partners,setPartners]=useState<AdminPartnerRow[]|null>(null);
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{partners:AdminPartnerRow[]}>("/partners");setPartners(r.partners);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load delivery partners");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);const t=setInterval(()=>void load(),8000);return()=>{clearTimeout(initial);clearInterval(t);};},[load]);
  const setApproval=async(id:string,approvalStatus:string)=>{setBusy(true);try{await adminApi(`/partners/${id}/approval`,{method:"PATCH",body:JSON.stringify({approvalStatus})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update approval");}finally{setBusy(false);}};
  const setStatus=async(id:string,status:string)=>{setBusy(true);try{await adminApi(`/partners/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update status");}finally{setBusy(false);}};
  const remove=async(p:AdminPartnerRow)=>{if(!confirm(`Delete "${p.name}"? Partners with delivery history are disabled instead of permanently deleted.`))return;setBusy(true);try{const res=await adminApi<{deleted:boolean;disabled?:boolean}>(`/partners/${p.id}`,{method:"DELETE"});await load();if(res.disabled)alert(`"${p.name}" has delivery history, so the account was disabled instead of deleted.`);}catch(e){setError(e instanceof Error?e.message:"Could not delete this partner");}finally{setBusy(false);}};

  return <WorkspacePage eyebrow="DELIVERY FLEET" title="Delivery partners" copy="Approve new partners, and control who can go online and receive deliveries.">
    {error&&<p className="auth-error">{error}</p>}
    <FlowSteps steps={[
      ["1","Create partner login","Enter identity, KYC documents, bank details and a temporary password."],
      ["2","Verify & approve","Keep pending until documents are checked, or approve immediately."],
      ["3","Keep active","Only active and approved partners can go online."],
      ["4","Partner goes online","The Partner app receives offers only after online + location update."],
    ]}/>
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Delivery Partner"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreatePartnerForm onCreated={()=>{setShowCreate(false);void load();}}/>}
    {partners===null?<Empty title="Loading…" copy="Fetching delivery partners."/>:!partners.length?<Empty title="No delivery partners yet" copy="Create one above to get started."/>:
    <div className="directory">{partners.map((p)=><article key={p.id}>
      {p.photoUrl?<img src={p.photoUrl} alt="" className="vendor-thumb"/>:<i>{p.name[0]||"?"}</i>}
      <span><b>{p.name}</b><small>{p.email}{p.phone?` • ${p.phone}`:""}{p.vehicleType?` • ${p.vehicleType} ${p.vehicleNumber||""}`:""} • ★ {(p.partnerRating||0).toFixed(1)} • {p.partnerCompletedDeliveries} deliveries</small></span>
      <span className={`status status-${p.partnerOnline?"online":"suspended"}`}>● {p.partnerBusy?"On a delivery":p.partnerOnline?"Online":"Offline"}</span>
      {p.partnerApprovalStatus==="PENDING"?<><button className="secondary" disabled={busy} onClick={()=>void setApproval(p.id,"APPROVED")}>Approve</button><button className="secondary danger-text" disabled={busy} onClick={()=>void setApproval(p.id,"REJECTED")}>Reject</button></>
        :p.status==="ACTIVE"?<button className="secondary" disabled={busy} onClick={()=>void setStatus(p.id,"SUSPENDED")}>Suspend</button>:<button className="secondary" disabled={busy} onClick={()=>void setStatus(p.id,"ACTIVE")}>Activate</button>}
      <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(p)}>Delete</button>
    </article>)}</div>}
  </WorkspacePage>;
}

function CreatePartnerForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({name:"",email:"",phone:"",photoUrl:"",vehicleType:"Bike",vehicleNumber:"",licenceNumber:"",aadhaarNumber:"",panNumber:"",bankAccountNumber:"",bankIfsc:"",bankAccountHolderName:"",initialPassword:"",approveNow:true});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [created,setCreated]=useState<{name:string;partnerId:string;email:string;password:string}|null>(null);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      const res=await adminApi<{partner:{id:string}}>("/partners",{method:"POST",body:JSON.stringify({
        name:form.name,email:form.email,phone:form.phone||undefined,photoUrl:form.photoUrl||null,
        vehicleType:form.vehicleType||null,vehicleNumber:form.vehicleNumber||null,licenceNumber:form.licenceNumber||null,
        aadhaarNumber:form.aadhaarNumber,panNumber:form.panNumber||undefined,
        bankDetails:(form.bankAccountNumber||form.bankIfsc||form.bankAccountHolderName)?{accountNumber:form.bankAccountNumber,ifsc:form.bankIfsc,accountHolderName:form.bankAccountHolderName}:null,
        initialPassword:form.initialPassword,approveNow:form.approveNow,
      })});
      setCreated({name:form.name,partnerId:res.partner.id,email:form.email,password:form.initialPassword});
      onCreated();
    }
    catch(e){setError(e instanceof Error?e.message:"Could not create this delivery partner");}finally{setBusy(false);}
  };
  if(created)return <div className="auth-form inline-form">
    <p><b>{created.name}</b> was created.</p>
    <p className="muted-note">Partner ID: <b>{created.partnerId}</b><br/>Login email: <b>{created.email}</b> • Temporary password: <b>{created.password}</b><br/>A welcome email with these credentials was sent to the partner (delivery depends on email being configured on this server).</p>
  </div>;
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <ImageUploadField label="Partner photo" value={form.photoUrl} onChange={(photoUrl)=>setForm({...form,photoUrl})}/>
    <label>Full name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
    <label>Email<input required type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
    <label>Mobile number<input required value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
    <label>Aadhaar number<input required inputMode="numeric" maxLength={12} value={form.aadhaarNumber} onChange={(e)=>setForm({...form,aadhaarNumber:e.target.value.replace(/\D/g,"")})}/></label>
    <label>PAN (optional)<input value={form.panNumber} onChange={(e)=>setForm({...form,panNumber:e.target.value.toUpperCase()})}/></label>
    <label>Driving licence number (optional)<input value={form.licenceNumber} onChange={(e)=>setForm({...form,licenceNumber:e.target.value})}/></label>
    <label>Vehicle type<input value={form.vehicleType} onChange={(e)=>setForm({...form,vehicleType:e.target.value})}/></label>
    <label>Vehicle number<input value={form.vehicleNumber} onChange={(e)=>setForm({...form,vehicleNumber:e.target.value})}/></label>
    <p className="muted-note" style={{margin:"4px 0 -6px"}}>Bank account for delivery payouts</p>
    <label>Account number<input value={form.bankAccountNumber} onChange={(e)=>setForm({...form,bankAccountNumber:e.target.value})}/></label>
    <label>IFSC<input value={form.bankIfsc} onChange={(e)=>setForm({...form,bankIfsc:e.target.value.toUpperCase()})}/></label>
    <label>Account holder name<input value={form.bankAccountHolderName} onChange={(e)=>setForm({...form,bankAccountHolderName:e.target.value})}/></label>
    <PasswordField label="Temporary password" value={form.initialPassword} onChange={(value)=>setForm({...form,initialPassword:value})}/>
    <label className="checkbox-label"><input type="checkbox" checked={form.approveNow} onChange={(e)=>setForm({...form,approveNow:e.target.checked})}/>Approve this partner immediately</label>
    <p className="muted-note">The partner ID is generated automatically. A welcome email with the login email and temporary password is sent on creation.</p>
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

type AdminPricingSettings = { deliveryFee:number; platformFee:number; taxRatePercent:number; restaurantDiscountThreshold:number; restaurantDiscountAmount:number; vendorCommissionPercent:number; deliveryPartnerPayout:number };
type AdminCoupon = { id:string; code:string; title:string; description:string; type:"PERCENT"|"FLAT"|"FREE_DELIVERY"; value:number; minOrder:number; maxDiscount:number|null; active:boolean; targetRestaurantIds:string[]; targetFoodItemIds:string[]; showOnHome:boolean };
type AdminServicePricing = { service:"Bike Taxi"|"Parcel"; baseFare:number; perKm:number; platformFee:number; partnerPayoutPercent:number };
type AdminBanner = { id:string; imageUrl:string; title:string; subtitle:string; linkType:"NONE"|"RESTAURANT"|"SERVICE"; linkTargetId:string|null; active:boolean; sortOrder:number };
type AdminSupportTicket = { id:string; ticketNumber:string; customerId:string; customerName:string; customerContact:string; orderId:string|null; orderNumber:string|null; orderStatus:string|null; category:string; subject:string; message:string; status:"OPEN"|"IN_PROGRESS"|"RESOLVED"|"CLOSED"; createdAt:string; updatedAt:string };

type FinanceData = {
  summary:{recognizedOrders:number;pendingOrders:number;cancelledOrders:number;customerRevenue:number;merchandiseValue:number;discounts:number;taxes:number;platformGrossRevenue:number;platformNetRevenue:number;vendorPayable:number;partnerPayable:number;legacyEstimatedOrders:number};
  byService:{service:string;orders:number;customerRevenue:number;platformNetRevenue:number;vendorPayable:number;partnerPayout:number}[];
  vendorSettlements:{vendorId:string;vendorName:string;orders:number;grossFoodSales:number;commission:number;payable:number}[];
};

function AdminFinance(){
  const [data,setData]=useState<FinanceData|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const result=await adminApi<FinanceData>("/finance");setData(result);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not calculate finance");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  if(!data)return <WorkspacePage eyebrow="FINANCE LEDGER" title="Platform finance" copy="Recognized only after an order is delivered or completed."><Empty title={error?"Finance unavailable":"Calculating…"} copy={error||"Reading order settlement records."}/></WorkspacePage>;
  const s=data.summary;
  return <WorkspacePage eyebrow="FINANCE LEDGER" title="Platform finance" copy="Real settlement values from completed order snapshots — pricing changes do not rewrite history.">
    <Kpis items={[[money(s.customerRevenue),"Customer revenue",`${s.recognizedOrders} completed`],[money(s.platformNetRevenue),"Net platform revenue","after partner payouts"],[money(s.vendorPayable),"Vendor payable","completed orders"],[money(s.partnerPayable),"Partner payable","delivery earnings"]]}/>
    <div className="stat-list">
      {[["Merchandise value",money(s.merchandiseValue)],["Discounts funded",money(s.discounts)],["Taxes collected",money(s.taxes)],["Gross platform revenue",money(s.platformGrossRevenue)],["Pending orders",String(s.pendingOrders)],["Cancelled orders",String(s.cancelledOrders)]].map((row)=><article key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong></article>)}
    </div>
    {s.legacyEstimatedOrders>0&&<p className="muted-note">{s.legacyEstimatedOrders} older food order{s.legacyEstimatedOrders===1?" uses":"s use"} the current commission rule because it predates settlement snapshots. New orders are exact.</p>}
    <h4 style={{margin:"28px 0 10px",fontSize:11}}>Revenue by service</h4>
    <div className="directory">{data.byService.map((row)=><article key={row.service}><i>{row.service[0]}</i><span><b>{row.service}</b><small>{row.orders} completed • Vendor {money(row.vendorPayable)} • Partner {money(row.partnerPayout)}</small></span><strong>{money(row.customerRevenue)}</strong><small>Net {money(row.platformNetRevenue)}</small></article>)}</div>
    <h4 style={{margin:"28px 0 10px",fontSize:11}}>Vendor settlements</h4>
    {!data.vendorSettlements.length?<p className="muted-note">No completed vendor settlements yet.</p>:<div className="directory">{data.vendorSettlements.map((row)=><article key={row.vendorId}><i>{row.vendorName[0]||"V"}</i><span><b>{row.vendorName}</b><small>{row.orders} completed • Sales {money(row.grossFoodSales)} • Commission {money(row.commission)}</small></span><strong>{money(row.payable)}</strong></article>)}</div>}
  </WorkspacePage>;
}

function AdminSupport(){
  const [tickets,setTickets]=useState<AdminSupportTicket[]|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const result=await adminApi<{tickets:AdminSupportTicket[]}>("/support-tickets");setTickets(result.tickets);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load support tickets");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const setStatus=async(id:string,status:AdminSupportTicket["status"])=>{setBusy(true);setError("");try{await adminApi(`/support-tickets/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update ticket");}finally{setBusy(false);}};
  return <WorkspacePage eyebrow="CUSTOMER CARE" title="Support tickets" copy="Real customer tickets created from the app, linked to the order when available.">
    {error&&<p className="auth-error">{error}</p>}
    {tickets===null?<Empty title="Loading support…" copy="Fetching live customer care tickets."/>:!tickets.length?<Empty title="No tickets yet" copy="Customer support requests will appear here after they are submitted from the app."/>:
    <div className="directory">{tickets.map((ticket)=><article key={ticket.id} className="vendor-row">
      <div className="vendor-row-head">
        <i>{ticket.ticketNumber.replace("SUP-","").slice(-2)||"S"}</i>
        <span>
          <b>{ticket.ticketNumber} • {ticket.category}</b>
          <small>{ticket.customerName}{ticket.customerContact?` • ${ticket.customerContact}`:""}{ticket.orderNumber?` • ${ticket.orderNumber}`:" • No order linked"}{ticket.orderStatus?` • ${label(ticket.orderStatus)}`:""}</small>
          {ticket.message&&<small>{ticket.message}</small>}
        </span>
        <Status value={ticket.status}/>
      </div>
      <div className="vendor-row-actions">
        {(["OPEN","IN_PROGRESS","RESOLVED","CLOSED"] as AdminSupportTicket["status"][]).map((status)=><button key={status} className="secondary" disabled={busy||ticket.status===status} onClick={()=>void setStatus(ticket.id,status)}>{label(status)}</button>)}
      </div>
    </article>)}</div>}
  </WorkspacePage>;
}

function AdminDiscounts(){
  return <WorkspacePage eyebrow="MONEY & PROMOTIONS" title="Discounts & Pricing" copy="Set platform pricing and create offers for all restaurants, selected restaurants, or selected food items.">
    <PricingSettingsPanel/>
    <div style={{height:28}}/>
    <ServicePricingPanel/>
    <div style={{height:28}}/>
    <CouponsPanel/>
    <div style={{height:28}}/>
    <BannersPanel/>
  </WorkspacePage>;
}

function BannersPanel(){
  const [banners,setBanners]=useState<AdminBanner[]|null>(null);
  const [showCreate,setShowCreate]=useState(false);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{banners:AdminBanner[]}>("/banners");setBanners(r.banners);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load banners");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const toggleActive=async(b:AdminBanner)=>{setBusy(true);try{await adminApi(`/banners/${b.id}`,{method:"PATCH",body:JSON.stringify({active:!b.active})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update banner");}finally{setBusy(false);}};
  const remove=async(b:AdminBanner)=>{if(!confirm(`Delete banner "${b.title||"Untitled"}"?`))return;setBusy(true);try{await adminApi(`/banners/${b.id}`,{method:"DELETE"});await load();}catch(e){setError(e instanceof Error?e.message:"Could not delete banner");}finally{setBusy(false);}};
  const move=async(b:AdminBanner,delta:number)=>{setBusy(true);try{await adminApi(`/banners/${b.id}`,{method:"PATCH",body:JSON.stringify({sortOrder:b.sortOrder+delta})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not reorder banners");}finally{setBusy(false);}};

  return <div>
    <h4 style={{margin:"0 0 4px",fontSize:11}}>Home screen banners</h4>
    <p className="muted-note">Shown as a carousel on the customer app home screen, right below the search bar. Lowest order number shows first.</p>
    {error&&<p className="auth-error">{error}</p>}
    <PrimaryActionButton label={showCreate?"Cancel":"+ Add Banner"} onClick={()=>{setShowCreate(!showCreate);setEditingId(null);}}/>
    {showCreate&&<BannerForm onDone={()=>{setShowCreate(false);void load();}}/>}
    {banners===null?<Empty title="Loading…" copy="Fetching banners."/>:!banners.length?<Empty title="No banners yet" copy="Add one above to show a promo carousel on the customer app home screen."/>:
    <div className="directory">{banners.map((b,i)=>editingId===b.id?
      <BannerForm key={b.id} banner={b} onDone={()=>{setEditingId(null);void load();}}/>
      :<article key={b.id}>
      {b.imageUrl?<img src={b.imageUrl} alt="" className="vendor-thumb"/>:<i>{(b.title||"B")[0]}</i>}
      <span><b>{b.title||"Untitled banner"}</b><small>{b.subtitle||"No subtitle"} • {b.linkType==="NONE"?"No link":b.linkType==="RESTAURANT"?"Links to a restaurant":"Links to a service"} • Order {b.sortOrder}</small></span>
      <span className={`status status-${b.active?"active":"suspended"}`}>● {b.active?"Active":"Inactive"}</span>
      <button className="secondary" disabled={busy||i===0} onClick={()=>void move(b,-1)} aria-label="Move up">↑</button>
      <button className="secondary" disabled={busy||i===banners.length-1} onClick={()=>void move(b,1)} aria-label="Move down">↓</button>
      <button className="secondary" disabled={busy} onClick={()=>{setEditingId(b.id);setShowCreate(false);}}>Edit</button>
      <button className="secondary" disabled={busy} onClick={()=>void toggleActive(b)}>{b.active?"Deactivate":"Activate"}</button>
      <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(b)}>Delete</button>
    </article>)}</div>}
  </div>;
}

function BannerForm({banner,onDone}:{banner?:AdminBanner;onDone:()=>void}){
  const [form,setForm]=useState({
    imageUrl:banner?.imageUrl??"",
    title:banner?.title??"",
    subtitle:banner?.subtitle??"",
    linkType:banner?.linkType??("NONE" as AdminBanner["linkType"]),
    linkTargetId:banner?.linkTargetId??"",
    sortOrder:String(banner?.sortOrder??0),
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:React.FormEvent)=>{e.preventDefault();
    if(!form.imageUrl){setError("Upload a banner image.");return;}
    setBusy(true);setError("");
    const body={
      imageUrl:form.imageUrl,
      title:form.title,
      subtitle:form.subtitle,
      linkType:form.linkType,
      linkTargetId:form.linkType==="NONE"?null:form.linkTargetId.trim()||null,
      sortOrder:Number(form.sortOrder)||0,
    };
    try{
      if(banner)await adminApi(`/banners/${banner.id}`,{method:"PATCH",body:JSON.stringify(body)});
      else await adminApi("/banners",{method:"POST",body:JSON.stringify(body)});
      onDone();
    }catch(e){setError(e instanceof Error?e.message:`Could not ${banner?"update":"create"} this banner`);}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <ImageUploadField label="Banner image" value={form.imageUrl} onChange={(imageUrl)=>setForm({...form,imageUrl})}/>
    <label>Title (optional)<input value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} placeholder="e.g. Weekend Grocery Sale"/></label>
    <label>Subtitle (optional)<input value={form.subtitle} onChange={(e)=>setForm({...form,subtitle:e.target.value})} placeholder="e.g. Up to 30% off, this weekend only"/></label>
    <label>Display order<input type="number" value={form.sortOrder} onChange={(e)=>setForm({...form,sortOrder:e.target.value})} placeholder="0"/></label>
    <label>Tapping this banner opens
      <select value={form.linkType} onChange={(e)=>setForm({...form,linkType:e.target.value as AdminBanner["linkType"],linkTargetId:""})}>
        <option value="NONE">Nothing (display only)</option>
        <option value="RESTAURANT">A restaurant</option>
        <option value="SERVICE">A service (Grocery, Vegetables, Mart, Bike Taxi, Parcel)</option>
      </select>
    </label>
    {form.linkType==="RESTAURANT"&&<label>Restaurant ID<input value={form.linkTargetId} onChange={(e)=>setForm({...form,linkTargetId:e.target.value})} placeholder="Paste the restaurant's ID from the Vendors page"/></label>}
    {form.linkType==="SERVICE"&&<label>Service
      <select value={form.linkTargetId} onChange={(e)=>setForm({...form,linkTargetId:e.target.value})}>
        <option value="">Choose a service</option>
        <option value="GROCERY">Grocery</option>
        <option value="VEGETABLES">Vegetables</option>
        <option value="MART">Mart</option>
        <option value="BIKE_TAXI">Bike Taxi</option>
        <option value="PARCEL">Parcel</option>
      </select>
    </label>}
    {error&&<p className="auth-error">{error}</p>}
    <div style={{display:"flex",gap:8}}>
      <button className="primary" disabled={busy}>{busy?"Saving…":banner?"Save changes":"Add banner"}</button>
      {banner&&<button type="button" className="secondary" disabled={busy} onClick={onDone}>Cancel</button>}
    </div>
  </form>;
}

function PricingSettingsPanel(){
  const [pricing,setPricing]=useState<AdminPricingSettings|null>(null);
  const [form,setForm]=useState<AdminPricingSettings|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const load=useCallback(async()=>{try{const r=await adminApi<{pricing:AdminPricingSettings}>("/pricing-settings");setPricing(r.pricing);setForm(r.pricing);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load pricing settings");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const save=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!form)return;
    setBusy(true);setError("");setSaved(false);
    try{
      const r=await adminApi<{pricing:AdminPricingSettings}>("/pricing-settings",{method:"PATCH",body:JSON.stringify(form)});
      setPricing(r.pricing);setForm(r.pricing);setSaved(true);setTimeout(()=>setSaved(false),2500);
    }catch(e){setError(e instanceof Error?e.message:"Could not save pricing settings");}finally{setBusy(false);}
  };

  if(!form)return <div className="inline-form"><p className="muted-note">{error||"Loading pricing settings…"}</p></div>;

  return <form className="auth-form inline-form" onSubmit={(e)=>void save(e)}>
    <h4 style={{margin:"0 0 4px",fontSize:11}}>Platform fees & tax</h4>
    <div className="permission-grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))"}}>
      <label>Delivery fee (₹)<input type="number" min={0} step="1" value={form.deliveryFee} onChange={(e)=>setForm({...form,deliveryFee:Number(e.target.value)})}/></label>
      <label>Platform fee (₹)<input type="number" min={0} step="1" value={form.platformFee} onChange={(e)=>setForm({...form,platformFee:Number(e.target.value)})}/></label>
      <label>Tax rate (%)<input type="number" min={0} max={100} step="0.1" value={form.taxRatePercent} onChange={(e)=>setForm({...form,taxRatePercent:Number(e.target.value)})}/></label>
      <label>Restaurant discount threshold (₹)<input type="number" min={0} step="1" value={form.restaurantDiscountThreshold} onChange={(e)=>setForm({...form,restaurantDiscountThreshold:Number(e.target.value)})}/></label>
      <label>Restaurant discount amount (₹)<input type="number" min={0} step="1" value={form.restaurantDiscountAmount} onChange={(e)=>setForm({...form,restaurantDiscountAmount:Number(e.target.value)})}/></label>
      <label>Vendor commission (%)<input type="number" min={0} max={100} step="0.1" value={form.vendorCommissionPercent} onChange={(e)=>setForm({...form,vendorCommissionPercent:Number(e.target.value)})}/></label>
      <label>Partner payout per food delivery (₹)<input type="number" min={0} step="1" value={form.deliveryPartnerPayout} onChange={(e)=>setForm({...form,deliveryPartnerPayout:Number(e.target.value)})}/></label>
    </div>
    <p className="muted-note">Orders above the threshold automatically get the discount amount taken off — this is separate from coupon codes below.</p>
    {error&&<p className="auth-error">{error}</p>}
    {saved&&<p className="muted-note" style={{color:"#247340"}}>Saved — every new order uses these values immediately.</p>}
    <button className="primary" disabled={busy || JSON.stringify(form)===JSON.stringify(pricing)}>{busy?"Saving…":"Save pricing"}</button>
  </form>;
}

function ServicePricingPanel(){
  const [rows,setRows]=useState<AdminServicePricing[]|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{pricing:AdminServicePricing[]}>("/service-pricing");setRows(r.pricing.filter((row)=>row.service==="Bike Taxi"||row.service==="Parcel"));setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load service pricing");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);
  const update=(service:AdminServicePricing["service"],field:keyof Omit<AdminServicePricing,"service">,value:number)=>setRows((current)=>current?.map((row)=>row.service===service?{...row,[field]:value}:row)??null);
  const save=async(row:AdminServicePricing)=>{setBusy(row.service);setError("");try{await adminApi(`/service-pricing/${encodeURIComponent(row.service)}`,{method:"PATCH",body:JSON.stringify(row)});await load();}catch(e){setError(e instanceof Error?e.message:"Could not save service pricing");}finally{setBusy(null);}};
  if(!rows)return <div className="inline-form"><p className="muted-note">{error||"Loading ride and parcel pricing…"}</p></div>;
  return <div className="auth-form inline-form">
    <h4 style={{margin:"0 0 4px",fontSize:11}}>Bike taxi & parcel pricing</h4>
    {error&&<p className="auth-error">{error}</p>}
    <div className="directory">{rows.map((row)=><article key={row.service}>
      <i>{row.service[0]}</i>
      <span><b>{row.service}</b><small>Fare = base + per km + platform fee. Partner payout is calculated from fare.</small></span>
      <label>Base ₹<input type="number" min={0} step="1" value={row.baseFare} onChange={(e)=>update(row.service,"baseFare",Number(e.target.value))}/></label>
      <label>Per km ₹<input type="number" min={0} step="1" value={row.perKm} onChange={(e)=>update(row.service,"perKm",Number(e.target.value))}/></label>
      <label>Fee ₹<input type="number" min={0} step="1" value={row.platformFee} onChange={(e)=>update(row.service,"platformFee",Number(e.target.value))}/></label>
      <label>Payout %<input type="number" min={0} max={100} step="0.1" value={row.partnerPayoutPercent} onChange={(e)=>update(row.service,"partnerPayoutPercent",Number(e.target.value))}/></label>
      <button className="secondary" disabled={busy===row.service} onClick={()=>void save(row)}>{busy===row.service?"Saving…":"Save"}</button>
    </article>)}</div>
  </div>;
}

function CouponsPanel(){
  const [coupons,setCoupons]=useState<AdminCoupon[]|null>(null);
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await adminApi<{coupons:AdminCoupon[]}>("/coupons");setCoupons(r.coupons);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load coupons");}},[]);
  useEffect(()=>{const initial=setTimeout(()=>void load(),0);return()=>clearTimeout(initial);},[load]);

  const toggleActive=async(c:AdminCoupon)=>{setBusy(true);try{await adminApi(`/coupons/${c.id}`,{method:"PATCH",body:JSON.stringify({active:!c.active})});await load();}catch(e){setError(e instanceof Error?e.message:"Could not update coupon");}finally{setBusy(false);}};
  const remove=async(c:AdminCoupon)=>{if(!confirm(`Delete coupon ${c.code}?`))return;setBusy(true);try{await adminApi(`/coupons/${c.id}`,{method:"DELETE"});await load();}catch(e){setError(e instanceof Error?e.message:"Could not delete coupon");}finally{setBusy(false);}};

  const describe=(c:AdminCoupon)=>c.type==="FREE_DELIVERY"?"Free delivery":c.type==="PERCENT"?`${c.value}% off${c.maxDiscount?` up to ₹${c.maxDiscount}`:""}`:`₹${c.value} off`;

  return <div>
    <h4 style={{margin:"0 0 10px",fontSize:11}}>Coupon codes</h4>
    {error&&<p className="auth-error">{error}</p>}
    <PrimaryActionButton label={showCreate?"Cancel":"+ Create Coupon"} onClick={()=>setShowCreate(!showCreate)}/>
    {showCreate&&<CreateCouponForm onCreated={()=>{setShowCreate(false);void load();}}/>}
    {coupons===null?<Empty title="Loading…" copy="Fetching coupons."/>:!coupons.length?<Empty title="No coupons yet" copy="Create one above to offer customers a discount code."/>:
    <div className="directory">{coupons.map((c)=><article key={c.id}>
      <i>%</i>
      <span><b>{c.code}</b><small>{describe(c)}{c.minOrder>0?` • min order ₹${c.minOrder}`:""}{c.title&&c.title!==c.code?` • ${c.title}`:""} • {c.targetFoodItemIds.length?`${c.targetFoodItemIds.length} selected food item${c.targetFoodItemIds.length===1?"":"s"}`:c.targetRestaurantIds.length?`${c.targetRestaurantIds.length} selected restaurant${c.targetRestaurantIds.length===1?"":"s"}`:"All restaurants"}{c.showOnHome?" • Shown on app home":""}</small></span>
      <span className={`status status-${c.active?"active":"suspended"}`}>● {c.active?"Active":"Inactive"}</span>
      <button className="secondary" disabled={busy} onClick={()=>void toggleActive(c)}>{c.active?"Deactivate":"Activate"}</button>
      <button className="secondary danger-text" disabled={busy} onClick={()=>void remove(c)}>Delete</button>
    </article>)}</div>}
  </div>;
}

function CreateCouponForm({onCreated}:{onCreated:()=>void}){
  const [form,setForm]=useState({code:"",title:"",description:"",type:"PERCENT" as AdminCoupon["type"],value:"10",minOrder:"0",maxDiscount:"",targetRestaurantIds:[] as string[],targetFoodItemIds:[] as string[],showOnHome:true});
  const [restaurants,setRestaurants]=useState<AdminRestaurant[]|null>(null);
  const [menus,setMenus]=useState<Record<string,AdminMenuItem[]>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{let cancelled=false;adminApi<{restaurants:AdminRestaurant[]}>("/restaurants").then((r)=>{if(!cancelled)setRestaurants(r.restaurants);}).catch((e)=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not load restaurants");});return()=>{cancelled=true;};},[]);
  const toggleRestaurant=async(id:string)=>{
    if(form.targetRestaurantIds.includes(id)){
      const removedFoodIds=new Set((menus[id]||[]).map((item)=>item.id));
      setForm((current)=>({...current,targetRestaurantIds:current.targetRestaurantIds.filter((x)=>x!==id),targetFoodItemIds:current.targetFoodItemIds.filter((x)=>!removedFoodIds.has(x))}));
      return;
    }
    setForm((current)=>({...current,targetRestaurantIds:[...current.targetRestaurantIds,id]}));
    if(!menus[id]){
      try{const result=await adminApi<{items:AdminMenuItem[]}>(`/restaurants/${id}/menu`);setMenus((current)=>({...current,[id]:result.items}));}
      catch(e){setError(e instanceof Error?e.message:"Could not load this restaurant's food items");}
    }
  };
  const toggleFood=(id:string)=>setForm((current)=>({...current,targetFoodItemIds:current.targetFoodItemIds.includes(id)?current.targetFoodItemIds.filter((x)=>x!==id):[...current.targetFoodItemIds,id]}));
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");
    try{
      await adminApi("/coupons",{method:"POST",body:JSON.stringify({
        code:form.code,
        title:form.title||form.code,
        description:form.description,
        type:form.type,
        value:form.type==="FREE_DELIVERY"?0:Number(form.value),
        minOrder:Number(form.minOrder)||0,
        maxDiscount:form.maxDiscount?Number(form.maxDiscount):null,
        targetRestaurantIds:form.targetRestaurantIds,
        targetFoodItemIds:form.targetFoodItemIds,
        showOnHome:form.showOnHome,
      })});
      onCreated();
    }catch(e){setError(e instanceof Error?e.message:"Could not create this coupon");}finally{setBusy(false);}
  };
  return <form className="auth-form inline-form" onSubmit={(e)=>void submit(e)}>
    <label>Code<input required value={form.code} onChange={(e)=>setForm({...form,code:e.target.value.toUpperCase()})}/></label>
    <label>Title (optional)<input value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></label>
    <label>Description (optional)<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} placeholder="Short message shown to customers"/></label>
    <label>Type
      <select value={form.type} onChange={(e)=>setForm({...form,type:e.target.value as AdminCoupon["type"]})}>
        <option value="PERCENT">Percentage off</option>
        <option value="FLAT">Flat amount off</option>
        <option value="FREE_DELIVERY">Free delivery</option>
      </select>
    </label>
    {form.type!=="FREE_DELIVERY"&&<label>{form.type==="PERCENT"?"Percent off":"Amount off (₹)"}<input required type="number" min="1" value={form.value} onChange={(e)=>setForm({...form,value:e.target.value})}/></label>}
    <label>Minimum order (₹)<input type="number" min="0" value={form.minOrder} onChange={(e)=>setForm({...form,minOrder:e.target.value})}/></label>
    {form.type==="PERCENT"&&<label>Max discount cap (₹, optional)<input type="number" min="0" value={form.maxDiscount} onChange={(e)=>setForm({...form,maxDiscount:e.target.value})}/></label>}
    <fieldset className="target-picker">
      <legend>Apply offer to restaurants</legend>
      <p>Leave every restaurant unchecked to make this a platform-wide offer.</p>
      {restaurants===null?<small>Loading restaurants…</small>:restaurants.map((restaurant)=><label key={restaurant.id} className="checkbox-label">
        <input type="checkbox" checked={form.targetRestaurantIds.includes(restaurant.id)} onChange={()=>void toggleRestaurant(restaurant.id)}/>
        {restaurant.name} <small>({restaurant.area})</small>
      </label>)}
    </fieldset>
    {form.targetRestaurantIds.length>0&&<fieldset className="target-picker">
      <legend>Optional: only selected food items</legend>
      <p>Leave all food items unchecked to apply the offer to the entire selected restaurant.</p>
      {form.targetRestaurantIds.map((restaurantId)=>{
        const restaurant=restaurants?.find((item)=>item.id===restaurantId);
        const items=menus[restaurantId];
        return <div key={restaurantId} className="food-target-group"><b>{restaurant?.name||"Restaurant"}</b>{items===undefined?<small>Loading food items…</small>:items.length===0?<small>No food items available.</small>:items.map((item)=><label key={item.id} className="checkbox-label small"><input type="checkbox" checked={form.targetFoodItemIds.includes(item.id)} onChange={()=>toggleFood(item.id)}/>{item.name} • ₹{item.price}</label>)}</div>;
      })}
    </fieldset>}
    <label className="checkbox-label"><input type="checkbox" checked={form.showOnHome} onChange={(e)=>setForm({...form,showOnHome:e.target.checked})}/>Show this offer below the customer app home search bar</label>
    {error&&<p className="auth-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?"Creating…":"Create coupon"}</button>
  </form>;
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

export default function Home(){const {state,busy,toast,error,act,retry}=useGoocart();if(error?.code==="AUTH_REQUIRED")return <AuthGate onAuthenticated={()=>void retry()}/>;if(error)return <main className="fatal"><Brand/><h1>Goocart couldn’t start</h1><p>{error.message}</p><button onClick={()=>void retry()}>Try again</button></main>;if(!state)return <main className="loading"><Brand/><div className="loader"/><p>Starting Goocart...</p></main>;const content=state.actor.role.includes("ADMIN")?<Admin state={state} act={act} busy={busy} retry={retry}/>:<main className="fatal"><Brand/><h1>This is the Admin console</h1><p>{roleGuidance(state.actor.role)}</p><button onClick={()=>void logout()}>Sign out</button></main>;return <div>{busy&&<div className="syncing">Syncing…</div>}{toast&&<div className="toast">{toast}</div>}{content}</div>}

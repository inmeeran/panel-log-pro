/* Panel Log Pro — cloud/PWA sync layer.
 * Keeps the existing application UI/data model and adds:
 * - Supabase email/password authentication
 * - Cloud JSON persistence with Row Level Security
 * - Local cache for fast/offline use
 * - Debounced cloud sync + retry when connectivity returns
 * - Legacy localStorage → cloud migration
 */
(function(){
  "use strict";
  var CFG = window.PANEL_LOG_CONFIG || {};
  var TABLE = "panel_log_data";
  var CORE_KEY = "panelLogData.v2";
  var EXTRA_KEY = "panelLogData.ops.v1";
  var QUEUE_KEY = "panelLog.cloudQueue.v1";
  var client = null;
  var user = null;
  var timer = null;
  var ready = false;
  var bootPromise = null;
  var setupMode = false;

  function configured(){
    return !!(CFG.supabaseUrl && CFG.supabaseAnonKey &&
      CFG.supabaseUrl.indexOf("YOUR-PROJECT-REF") === -1 &&
      CFG.supabaseAnonKey.indexOf("YOUR_SUPABASE") === -1);
  }
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); }
  function toast(msg){
    var el=document.getElementById("toast");
    if(el){el.textContent=msg;el.classList.add("show");setTimeout(function(){el.classList.remove("show");},2600);}
  }
  function setStatus(text, online){
    var el=document.getElementById("panel-cloud-status");
    if(!el) return;
    el.textContent=text;
    el.className="panel-cloud-status "+(online===false?"offline":online===true?"online":"pending");
  }
  function ensureStyles(){
    if(document.getElementById("panel-cloud-style")) return;
    var st=document.createElement("style");st.id="panel-cloud-style";
    st.textContent=`
      .panel-cloud-status{font-family:var(--mono);font-size:10px;letter-spacing:.25px;padding:4px 7px;border:1px solid var(--border);border-radius:999px;white-space:nowrap;background:var(--panel-bg-2);color:var(--text-dim)}
      .panel-cloud-status.online{color:#b9e8cf;border-color:#2c6449;background:#14281f}.panel-cloud-status.offline{color:#f3d6a0;border-color:#6a4d20;background:#2b2112}.panel-cloud-status.pending{color:var(--text-dim)}
      .panel-cloud-user{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-dim)}
      .cloud-overlay{position:fixed;inset:0;z-index:10000;background:rgba(5,8,10,.94);display:flex;align-items:center;justify-content:center;padding:18px}
      .cloud-card{width:min(440px,100%);background:var(--panel-bg);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
      .cloud-card h1{font-size:22px;margin:0 0 4px;color:var(--text)}.cloud-card p{color:var(--text-dim);font-size:13px;margin:0 0 18px}
      .cloud-card .cloud-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}.cloud-card label{font-size:11px;color:var(--text-dim)}
      .cloud-card input{width:100%;padding:10px}.cloud-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.cloud-error{color:#f5c9c4;background:#321a18;border:1px solid #67322c;padding:9px;border-radius:7px;font-size:12px;display:none;margin-top:10px}.cloud-note{font-size:11px;color:var(--text-faint);margin-top:14px;line-height:1.5}
      .cloud-setup code{font-family:var(--mono);font-size:11px;color:var(--focus)}
    `;
    document.head.appendChild(st);
  }
  function overlay(html){
    var old=document.getElementById("panel-cloud-overlay"); if(old) old.remove();
    var d=document.createElement("div");d.id="panel-cloud-overlay";d.className="cloud-overlay";d.innerHTML=html;document.body.appendChild(d);return d;
  }
  function setupScreen(){
    setupMode=true;
    overlay('<div class="cloud-card cloud-setup"><h1>Panel Log Pro Cloud Setup</h1><p>The app is ready for cloud mode, but Supabase has not been connected yet.</p><p>Open <code>supabase-config.js</code> and replace the two placeholder values with your Supabase project URL and publishable/anon key.</p><div class="cloud-note">Your database must also have the SQL from <code>supabase-schema.sql</code> applied. No service-role key belongs in the browser.</div><div class="cloud-actions"><button class="primary" id="cloud-local-mode">Continue in local mode</button></div></div>');
    document.getElementById("cloud-local-mode").onclick=function(){document.getElementById("panel-cloud-overlay").remove();ready=true;setStatus("LOCAL",false);};
  }
  function authScreen(){
    return new Promise(function(resolve){
      var d=overlay('<div class="cloud-card"><h1>Panel Log Pro</h1><p>Sign in to your cloud workspace. Your records will synchronize across phones and computers.</p><div class="cloud-field"><label>Email</label><input id="cloud-email" type="email" autocomplete="email" placeholder="you@example.com"></div><div class="cloud-field"><label>Password</label><input id="cloud-password" type="password" autocomplete="current-password" placeholder="Minimum 6 characters"></div><div class="cloud-error" id="cloud-error"></div><div class="cloud-actions"><button class="primary" id="cloud-signin">Sign in</button><button id="cloud-signup">Create account</button></div><div class="cloud-note">Email/password authentication is handled by Supabase Auth. Use a strong unique password.</div></div>');
      var err=d.querySelector("#cloud-error");
      function showErr(e){err.textContent=(e&&e.message)||String(e);err.style.display="block";}
      async function act(mode){
        err.style.display="none";
        var email=d.querySelector("#cloud-email").value.trim(), pw=d.querySelector("#cloud-password").value;
        if(!email||!pw){showErr({message:"Enter your email and password."});return;}
        try{
          var r=mode==="signup"?await client.auth.signUp({email:email,password:pw}):await client.auth.signInWithPassword({email:email,password:pw});
          if(r.error) throw r.error;
          if(mode==="signup" && !r.data.session){err.textContent="Account created. Check your email to confirm the account, then sign in.";err.style.display="block";return;}
          user=r.data.user; d.remove(); resolve(user);
        }catch(e){showErr(e);}
      }
      d.querySelector("#cloud-signin").onclick=function(){act("signin")};
      d.querySelector("#cloud-signup").onclick=function(){act("signup")};
      d.querySelectorAll("input").forEach(function(i){i.addEventListener("keydown",function(e){if(e.key==="Enter")act("signin")})});
    });
  }
  function mountAccountUI(){
    ensureStyles();
    var actions=document.getElementById("topbar-actions"); if(!actions) return;
    if(!document.getElementById("panel-cloud-status")){
      var s=document.createElement("span");s.id="panel-cloud-status";s.className="panel-cloud-status pending";s.textContent="SYNC";actions.insertBefore(s,actions.firstChild);
    }
    if(!document.getElementById("panel-cloud-user")){
      var u=document.createElement("span");u.id="panel-cloud-user";u.className="panel-cloud-user";u.title=user&&user.email||"";u.textContent=user&&user.email||"";actions.insertBefore(u,actions.firstChild);
    }
    if(!document.getElementById("panel-cloud-signout")){
      var b=document.createElement("button");b.id="panel-cloud-signout";b.textContent="Sign out";b.onclick=async function(){await client.auth.signOut();location.reload();};actions.appendChild(b);
    }
    setStatus("CLOUD",navigator.onLine);
  }
  async function readCloud(){
    if(!client||!user) return null;
    var r=await client.from(TABLE).select("data,updated_at").eq("user_id",user.id).maybeSingle();
    if(r.error) throw r.error;
    return r.data||null;
  }
  function localPayload(){
    var core=null, extra=null;
    try{core=JSON.parse(localStorage.getItem(CORE_KEY)||"null")}catch(e){}
    try{extra=JSON.parse(localStorage.getItem(EXTRA_KEY)||"null")}catch(e){}
    return {core:core,extra:extra};
  }
  async function writeCloud(){
    if(!ready || !client || !user) return;
    if(!navigator.onLine){ localStorage.setItem(QUEUE_KEY,"1");setStatus("OFFLINE",false);return; }
    var payload=localPayload();
    setStatus("SAVING…",true);
    var r=await client.from(TABLE).upsert({user_id:user.id,data:payload,updated_at:new Date().toISOString()},{onConflict:"user_id"});
    if(r.error){localStorage.setItem(QUEUE_KEY,"1");setStatus("RETRY",false);console.error("Cloud save failed",r.error);return;}
    localStorage.removeItem(QUEUE_KEY);setStatus("SYNCED",true);
  }
  function scheduleSave(){
    if(timer) clearTimeout(timer);
    timer=setTimeout(function(){writeCloud().catch(function(e){console.error(e);setStatus("RETRY",false);});},700);
  }
  async function migrateLocalIfNeeded(){
    if(!ready||!client||!user) return;
    var row=await readCloud();
    if(row && row.data){
      if(row.data.core) localStorage.setItem(CORE_KEY,JSON.stringify(row.data.core));
      if(row.data.extra) localStorage.setItem(EXTRA_KEY,JSON.stringify(row.data.extra));
      return;
    }
    var local=localPayload();
    if(local.core || local.extra) await writeCloud();
  }
  function startAutoSync(){
    window.addEventListener("online",function(){setStatus("SYNCING…",true);writeCloud().catch(function(){});});
    window.addEventListener("offline",function(){setStatus("OFFLINE",false);});
    if(navigator.onLine) setStatus("SYNCED",true); else setStatus("OFFLINE",false);
  }
  async function boot(){
    ensureStyles();
    if(!configured()){setupScreen();return;}
    if(!window.supabase||!window.supabase.createClient){setupScreen();return;}
    client=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey);
    var sessionResult=await client.auth.getSession();
    if(sessionResult.error) throw sessionResult.error;
    if(sessionResult.data.session) user=sessionResult.data.session.user;
    else await authScreen();
    ready=true; mountAccountUI();
    client.auth.onAuthStateChange(function(event,session){
      user=session&&session.user||null;
      if(user) mountAccountUI();
    });
  }
  window.PanelCloud={boot:boot,scheduleSave:scheduleSave,migrateLocalIfNeeded:migrateLocalIfNeeded,startAutoSync:startAutoSync,isReady:function(){return ready},getUser:function(){return user}};
})();

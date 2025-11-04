/* assets/app.js — core client logic for Step 1 */
/* -------------------------
  - Firebase Auth + RTDB integration (uses your firebaseConfig below)
  - Sign up: creates member record and memberNo using RTDB counter
  - Sign in: accepts memberNo (VYG-xxxx) or email
  - Forgot password: accepts memberNo or email
  - redirectToMpesa: calls server endpoint (replace SERVER_BASE)
------------------------- */

/* ====== CONFIG (your Firebase config inserted) ====== */
const firebaseConfig = {
  apiKey: "AIzaSyA_OCu7HQ5HCH2OYx5dQ2Z1r7YPwQJave4",
  authDomain: "visionary-youth-grou-2024.firebaseapp.com",
  databaseURL: "https://visionary-youth-grou-2024-default-rtdb.firebaseio.com",
  projectId: "visionary-youth-grou-2024",
  storageBucket: "visionary-youth-grou-2024.appspot.com",
  messagingSenderId: "372978592717",
  appId: "1:372978592717:web:1c15aec728ee5f854f3284"
};

/* Server base: change this to your server (ngrok or deployed) */
const SERVER_BASE = "https://REPLACE_WITH_YOUR_SERVER"; // e.g. https://xxxx.ngrok.io

/* Load firebase compat libraries if not present */
function loadFirebaseThen(fn){
  if(window.firebase) return fn();
  const s1 = document.createElement('script'); s1.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-app-compat.js";
  s1.onload = ()=> { const s2 = document.createElement('script'); s2.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-auth-compat.js"; s2.onload = ()=> { const s3 = document.createElement('script'); s3.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-database-compat.js"; s3.onload = fn; document.head.appendChild(s3); }; document.head.appendChild(s2); }; document.head.appendChild(s1);
}

/* Init firebase */
let firebaseApp, auth, rtdb;
function initFirebase(){
  if(window.firebase && !firebaseApp){
    firebaseApp = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    rtdb = firebase.database();
    auth.onAuthStateChanged(user => {
      if(user) localStorage.setItem('vyg_user', JSON.stringify({ uid: user.uid, email: user.email }));
      else localStorage.removeItem('vyg_user');
    });
  }
}

/* Helper to show messages */
function showMsg(id, txt){
  const el = document.getElementById(id);
  if(el) el.textContent = txt;
  else console.log(id, txt);
}

/* Generate member no using RTDB transaction */
async function generateMemberNo(){
  const ref = rtdb.ref('counters/members');
  const tx = await ref.transaction(current => (current || 0) + 1);
  const n = tx.snapshot.val();
  return 'VYG-' + String(n).padStart(4,'0');
}

/* Sign up handler */
async function handleSignUp(e){
  e && e.preventDefault();
  const fullname = document.getElementById('fullname').value.trim();
  const email = document.getElementById('email').value.trim();
  const pw = document.getElementById('su_password').value;
  const confirm = document.getElementById('su_confirm').value;
  if(pw.length < 8){ showMsg('signupMessage','Password must be at least 8 characters.'); return; }
  if(pw !== confirm){ showMsg('signupMessage','Passwords do not match.'); return; }

  loadFirebaseThen(async ()=>{
    initFirebase();
    try{
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      await cred.user.sendEmailVerification();
      const uid = cred.user.uid;
      const memberNo = await generateMemberNo();
      await rtdb.ref('members/' + uid).set({ name: fullname, email: email, memberNo: memberNo, createdAt: Date.now() });
      await rtdb.ref('memberIndex/' + memberNo).set(uid);
      showMsg('signupMessage', `Account created. Member no: ${memberNo}. Check your email to activate.`);
    }catch(err){
      showMsg('signupMessage', err.message || 'Sign up failed');
    }
  });
}

/* Sign in handler (memberNo or email) */
async function handleSignIn(e){
  e && e.preventDefault();
  const identifier = document.getElementById('memberNo').value.trim();
  const password = document.getElementById('password').value;
  if(!identifier || !password){ showMsg('signinMessage','Provide member no or email and password.'); return; }

  loadFirebaseThen(async ()=>{
    initFirebase();
    try{
      let emailToUse = identifier;
      if(/^VYG-/.test(identifier)){
        const idxSnap = await rtdb.ref('memberIndex/' + identifier).once('value');
        const uid = idxSnap.val();
        if(!uid){ showMsg('signinMessage','Member number not found.'); return; }
        const memSnap = await rtdb.ref('members/' + uid + '/email').once('value');
        const storedEmail = memSnap.val();
        if(!storedEmail){ showMsg('signinMessage','No email on record — contact admin.'); return; }
        emailToUse = storedEmail;
      }
      const res = await auth.signInWithEmailAndPassword(emailToUse, password);
      if(!res.user.emailVerified){ showMsg('signinMessage','Email not verified. Check your email.'); await auth.signOut(); return; }
      showMsg('signinMessage','Signed in. Redirecting...');
      setTimeout(()=> location.href = 'home.html', 700);
    }catch(err){
      showMsg('signinMessage', err.message || 'Sign in failed');
    }
  });
}

/* Forgot password handler (memberNo or email) */
async function handleForgot(e){
  e && e.preventDefault();
  const id = document.getElementById('resetEmail').value.trim();
  if(!id){ showMsg('resetMessage','Enter member no or email'); return; }
  loadFirebaseThen(async ()=>{
    initFirebase();
    try{
      let emailToUse = id;
      if(/^VYG-/.test(id)){
        const idxSnap = await rtdb.ref('memberIndex/' + id).once('value');
        const uid = idxSnap.val();
        if(!uid){ showMsg('resetMessage','Member not found'); return; }
        const memSnap = await rtdb.ref('members/' + uid + '/email').once('value');
        emailToUse = memSnap.val();
      }
      await auth.sendPasswordResetEmail(emailToUse);
      showMsg('resetMessage','Password reset email sent.');
    }catch(err){
      showMsg('resetMessage', err.message || 'Reset failed');
    }
  });
}

/* logout */
async function handleLogout(){
  loadFirebaseThen(async ()=>{ initFirebase(); await auth.signOut(); localStorage.removeItem('vyg_user'); location.href='index.html'; });
}

/* MPesa redirect / STK push initiation — call your server endpoint */
async function redirectToMpesa(amount, accountReference, phone){
  try{
    const res = await fetch(`${SERVER_BASE}/mpesa-initiate`, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ amount, accountReference, phone })
    });
    const j = await res.json();
    if(!res.ok) throw new Error(j.message || 'MPesa init failed');
    alert('Payment initiated. Check phone for STK prompt.');
    return j;
  }catch(err){
    alert('Payment initiation failed: ' + (err.message || err));
    console.error(err);
  }
}

/* Hook forms on DOMContentLoaded */
document.addEventListener('DOMContentLoaded', function(){
  if(document.getElementById('signupForm')) document.getElementById('signupForm').addEventListener('submit', handleSignUp);
  if(document.getElementById('signinForm')) document.getElementById('signinForm').addEventListener('submit', handleSignIn);
  if(document.getElementById('resetForm')) document.getElementById('resetForm').addEventListener('submit', handleForgot);
  if(document.getElementById('logoutBtn')) document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // If on home.html, load member details to display
  if(window.location.pathname.endsWith('home.html')){
    loadFirebaseThen(async ()=>{
      initFirebase();
      const raw = localStorage.getItem('vyg_user');
      if(!raw) return;
      const u = JSON.parse(raw);
      const snap = await rtdb.ref('members/' + u.uid).once('value');
      const mem = snap.val();
      if(mem){
        const elName = document.getElementById('memberName'); if(elName) elName.textContent = mem.name || mem.email || '';
        const elNo = document.getElementById('memberNo'); if(elNo) elNo.textContent = mem.memberNo || '';
      }
    });
  }
});

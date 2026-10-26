import { firebaseConfig, googleClientId } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";import {
  getAuth,onAuthStateChanged,signInWithEmailAndPassword,sendPasswordResetEmail,signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,collection,doc,getDoc,getDocs,query,where,orderBy,
  addDoc,setDoc,updateDoc,deleteDoc,serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
;
import { getFunctions,httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";
const app=initializeApp(firebaseConfig);

let driveToken = null;
let driveTokenExpiresAt = 0;

document.getElementById("connectDriveBtn")?.addEventListener("click", () => {
  if (!window.google?.accounts?.oauth2) {
    alert("No se pudo cargar Google. Recargá la página.");
    return;
  }

  const client = google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: "https://www.googleapis.com/auth/drive.file",
    callback: (response) => {
      if (response.access_token) {
        driveToken = response.access_token;
        driveTokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
        alert("Google Drive conectado correctamente.");
      } else {
        alert("No se pudo conectar Google Drive.");
      }
    },
  });

  client.requestAccessToken();
});
const auth=getAuth(app); auth.languageCode="es";
const db=getFirestore(app), storage=getStorage(app), functions=getFunctions(app);
const $=id=>document.getElementById(id);
const state={user:null,profile:null,garments:[],outfits:[],selected:{},tab:"all",search:""};
const catLabel={torso:"Torso",legs:"Piernas",full:"Cuerpo completo",shoes:"Zapatos",hats:"Gorros",accessories:"Accesorios",jewelry:"Joyas"};
const catOrder={full:10,legs:20,torso:30,shoes:40,hats:50};

function msg(el,text){el.textContent=text||""}
function esc(s=""){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fileToData(file,max=1800){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{let w=im.width,h=im.height;if(Math.max(w,h)>max){const k=max/Math.max(w,h);w=Math.round(w*k);h=Math.round(h*k)}const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(im,0,0,w,h);resolve(c.toDataURL("image/jpeg",.86))};im.onerror=reject;im.src=r.result};r.onerror=reject;r.readAsDataURL(file)})}
function dataUrlParts(data){const [h,b]=data.split(",");return {mime:(h.match(/data:(.*?);/)||[])[1]||"image/jpeg",data:b}}
async function uploadDataUrl(path, data) {
  if (!driveToken || Date.now() >= driveTokenExpiresAt) {
    throw new Error("Conectá Google Drive antes de guardar imágenes.");
  }

  const p = dataUrlParts(data);
  const bytes = Uint8Array.from(atob(p.data), c => c.charCodeAt(0));
  const boundary = "armario" + crypto.randomUUID().replaceAll("-", "");
  const name = path.split("/").pop();

  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name }),
    `\r\n--${boundary}\r\nContent-Type: ${p.mime}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`
  ], { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${driveToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  const file = await response.json();

  if (!response.ok) {
    throw new Error(file.error?.message || "Error al subir la imagen.");
  }

  const permission = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${driveToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type: "anyone", role: "reader" })
    }
  );

  if (!permission.ok) {
    throw new Error("La imagen se subió, pero no se pudo habilitar su enlace.");
  }

  return {
    id: file.id,
    url: `https://drive.google.com/uc?export=view&id=${file.id}`
  };
}

async function deleteDriveFile(id) {
  if (!id || id.includes("/") || !driveToken ||
      Date.now() >= driveTokenExpiresAt) return;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${driveToken}` }
    }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error("No se pudo eliminar la imagen de Drive.");
  }
}
async function loadProfile(){
  const snap=await getDoc(doc(db,"users",state.user.uid));
  state.profile=snap.exists()?snap.data():{role:"user",displayName:state.user.email};
  $("adminBtn").classList.toggle("hidden",state.profile.role!=="admin");
}
async function loadGarments(){
const q=query(
  collection(db,"garments"),
  where("ownerUid","==",state.user.uid)
);  const snap=await getDocs(q);state.garments=snap.docs.map(d=>({id:d.id,...d.data()}));render();
}
async function loadOutfits(){
  const q=query(collection(db,"outfits"),where("ownerUid","==",state.user.uid));
  const snap=await getDocs(q);state.outfits=snap.docs.map(d=>({id:d.id,...d.data()}));render();
}
function visibleGarments(){
  return state.garments.filter(g=>(state.tab==="all"||state.tab===g.category)&&g.name.toLowerCase().includes(state.search.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,"es"));
}
function render(){
  $("garmentPanel").classList.toggle("hidden",state.tab==="outfits");
  $("outfitPanel").classList.toggle("hidden",state.tab!=="outfits");
  if(state.tab==="outfits") renderOutfits(); else renderGarments();
  renderLayers();
}
function renderGarments(){
  const list=visibleGarments();$("garmentGrid").innerHTML=list.map(g=>`
    <article class="garment-card">
      <img class="garment-image" src="${g.adaptedPath ? `https://drive.google.com/thumbnail?id=${g.adaptedPath}&sz=w500` : (g.adaptedUrl || g.originalUrl)}" alt="${esc(g.name)}">
      <div class="card-body">
        <div class="card-name">${esc(g.name)}</div>
        <div class="card-meta">${catLabel[g.category]||g.category}</div>
        <span class="status ${g.status}">${g.status==="obtained"?"Obtenido":"Tentativa"}</span>
        <div class="card-actions">
          <button class="primary mini select-g" data-id="${g.id}">${state.selected[g.category]===g.id?"Quitar":"Usar"}</button>
          <button class="secondary mini delete-g" data-id="${g.id}">Eliminar</button>
        </div>
      </div>
    </article>`).join("");
  $("emptyState").classList.toggle("hidden",list.length>0);
  document.querySelectorAll(".select-g").forEach(b=>b.onclick=()=>toggleGarment(b.dataset.id));
  document.querySelectorAll(".delete-g").forEach(b=>b.onclick=()=>removeGarment(b.dataset.id));
}
function renderOutfits(){
  $("outfitGrid").innerHTML=state.outfits.map(o=>`
    <article class="outfit-card">
      <img class="outfit-image" src="${o.previewUrl||"assets/model.jpg"}" alt="${esc(o.name)}">
      <div class="card-body">
        <div class="card-name">${esc(o.name)}</div>
        <div class="card-meta">${o.rating?("★".repeat(o.rating)+"☆".repeat(5-o.rating)):"Sin puntuar"}</div>
        <div class="card-actions">
          <button class="primary mini load-o" data-id="${o.id}">Cargar</button>
          <button class="secondary mini use-o" data-id="${o.id}">Registrar uso</button>
          <a class="secondary mini" href="${o.previewUrl}" target="_blank" rel="noopener">Imagen</a>
          <button class="secondary mini delete-o" data-id="${o.id}">Eliminar</button>
        </div>
      </div>
    </article>`).join("");
  $("emptyState").classList.toggle("hidden",state.outfits.length>0);
  document.querySelectorAll(".load-o").forEach(b=>b.onclick=()=>loadOutfit(b.dataset.id));
  document.querySelectorAll(".use-o").forEach(b=>b.onclick=()=>openUse(b.dataset.id));
  document.querySelectorAll(".delete-o").forEach(b=>b.onclick=()=>removeOutfit(b.dataset.id));
}
function renderLayers(){
  const layer=$("layerCanvas");layer.innerHTML="";
  Object.entries(state.selected).sort((a,b)=>(catOrder[a[0]]||0)-(catOrder[b[0]]||0)).forEach(([cat,id])=>{
    const g=state.garments.find(x=>x.id===id);if(!g)return;
    const img=document.createElement("img");img.className="layer";img.alt=g.name;img.src=g.adaptedUrl||g.originalUrl;layer.appendChild(img);
  });
}
function toggleGarment(id) {
  const g = state.garments.find(x => x.id === id);
  if (!g) return;

  const fileId = g.adaptedPath || g.originalPath;

  $("modelImage").src = fileId
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`
    : (g.adaptedUrl || g.originalUrl);

  state.selected = {};
  $("layerCanvas").innerHTML = "";
  render();
}
async function removeGarment(id){
  if(!confirm("¿Eliminar esta prenda?"))return;
  const g=state.garments.find(x=>x.id===id);
  try{await deleteDoc(doc(db,"garments",id));for (const id of new Set([g.originalPath, g.adaptedPath])) {
  if (id) try { await deleteDriveFile(id); } catch {}
}
    delete state.selected[g.category];await loadGarments();
  }catch(e){alert(e.message)}
}
async function removeOutfit(id) {
  if (!confirm("¿Eliminar este atuendo?")) return;

  try {
    const outfit = state.outfits.find(o => o.id === id);
    await deleteDoc(doc(db, "outfits", id));

    if (outfit?.previewPath) {
      try { await deleteDriveFile(outfit.previewPath); } catch {}
    }

    await loadOutfits();
  } catch (e) {
    alert(e.message);
  }
}
function reset() {
  state.selected = {};
  $("modelImage").src = "assets/model.jpg";
  $("layerCanvas").innerHTML = "";
  render();
}
function currentSelection(){return Object.values(state.selected)}

async function loadImageForCanvas(url, path) {
  let src = url;
  let objectUrl = null;

  // Las imágenes nuevas de Drive guardan su ID en path.
  if (path && !path.includes("/")) {
    if (!driveToken || Date.now() >= driveTokenExpiresAt) {
      throw new Error("Conectá Google Drive antes de crear el atuendo.");
    }

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${path}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${driveToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error("No se pudo leer una imagen de Google Drive.");
    }

    objectUrl = URL.createObjectURL(await response.blob());
    src = objectUrl;
  }

  try {
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("No se pudo cargar una imagen."));
      img.src = src;
    });

    return img;
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function makePreview() {
  const baseUrl = state.profile.modelUrl || $("modelImage").src;
  const base = await loadImageForCanvas(
    baseUrl,
    state.profile.modelPath
  );

  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(base, 0, 0);

  for (const g of Object.values(state.selected)
    .map(id => state.garments.find(x => x.id === id))
    .filter(Boolean)) {

    const img = await loadImageForCanvas(
      g.adaptedUrl || g.originalUrl,
      g.adaptedPath || g.originalPath
    );

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}

async function saveOutfit(){
  if(!currentSelection().length){alert("Seleccioná al menos una prenda.");return}
  $("outfitDialog").showModal()
}
async function submitOutfit(e) {
  e.preventDefault();

  const name = $("outfitName").value.trim();
  if (!name) return;

  try {
    const preview = await makePreview();
    const uploaded = await uploadDataUrl(
      `outfit-${crypto.randomUUID()}.jpg`,
      preview
    );

    await addDoc(collection(db, "outfits"), {
      ownerUid: state.user.uid,
      name,
      rating: Number($("outfitRating").value),
      garmentIds: currentSelection(),
      previewUrl: uploaded.url,
      previewPath: uploaded.id,
      createdAt: serverTimestamp()
    });

    $("outfitDialog").close();
    e.target.reset();
    await loadOutfits();
  } catch (err) {
    alert("Error al guardar el atuendo: " + err.message);
  }
}

async function addGarment(e) {
  e.preventDefault();

  const file = $("garmentFile").files[0];
  if (!file) return;

  try {
    msg($("garmentMsg"), "Preparando imagen...");
    const originalData = await fileToData(file);
    const path = `garments/${crypto.randomUUID()}.jpg`;

    msg($("garmentMsg"), "Subiendo a Google Drive...");
    const uploaded = await uploadDataUrl(path, originalData);

    await addDoc(collection(db, "garments"), {
      ownerUid: state.user.uid,
      name: $("garmentName").value.trim(),
      category: $("garmentCategory").value,
      status: $("garmentStatus").value,
      originalUrl: uploaded.url,
      originalPath: uploaded.id,
      adaptedUrl: uploaded.url,
      adaptedPath: uploaded.id,
      createdAt: serverTimestamp()
    });

    $("garmentDialog").close();
    e.target.reset();
    msg($("garmentMsg"), "");
    await loadGarments();
  } catch (err) {
    msg($("garmentMsg"), "Error: " + (err.message || err));
  }
}

async function saveModel(e) {
  e.preventDefault();

  const file = $("modelFile").files[0];
  if (!file) {
    $("settingsDialog").close();
    return;
  }

  try {
    const data = await fileToData(file, 2200);
    const uploaded = await uploadDataUrl("model.jpg", data);

    await setDoc(doc(db, "users", state.user.uid), {
      modelUrl: uploaded.url,
      modelPath: uploaded.id
    }, { merge: true });

    state.profile.modelUrl = uploaded.url;
    state.profile.modelPath = uploaded.id;
    $("modelImage").src = uploaded.url;
    $("settingsDialog").close();
  } catch (err) {
    alert("Error al guardar el modelo: " + err.message);
  }
}
async function registerNoelia(e){
  e.preventDefault();
  const email=$("registerEmail").value.trim();
  const password=$("registerPassword").value;
  const password2=$("registerPassword2").value;
  if(password!==password2)return msg($("registerMsg"),"Las contraseñas no coinciden.");
  msg($("registerMsg"),"Creando cuenta...");
  try{
    const fn=httpsCallable(functions,"registerNoelia");
    await fn({email,password});
    $("registerDialog").close();
    $("loginEmail").value=email;
    msg($("authMsg"),"Cuenta creada. Ya podés ingresar.");
    e.target.reset();
  }catch(err){msg($("registerMsg"),err.message||"No se pudo crear la cuenta.")}
}

async function loadAdminSummary(){
  try{const fn=httpsCallable(functions,"adminSummary");const r=await fn();$("adminSummary").innerHTML=`Usuarios: <b>${r.data.users}</b><br>Prendas: <b>${r.data.garments}</b><br>Atuendos: <b>${r.data.outfits}</b>`}catch(e){$("adminSummary").textContent=e.message}
}
function openUse(id){$("useOutfitId").value=id;$("useDate").value=new Date().toISOString().slice(0,10);$("useDialog").showModal()}
async function registerUse(e){
  e.preventDefault();await addDoc(collection(db,"wearLogs"),{ownerUid:state.user.uid,outfitId:$("useOutfitId").value,date:$("useDate").value,note:$("useNote").value.trim(),createdAt:serverTimestamp()});$("useDialog").close();e.target.reset()
}
async function loadOutfit(id){const o=state.outfits.find(x=>x.id===id);if(!o)return;state.selected={};o.garmentIds.forEach(gid=>{const g=state.garments.find(x=>x.id===gid);if(g)state.selected[g.category]=g.id});state.tab="all";document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab==="all"));render()}

function downloadUrl(url,filename){
  if(!url){alert("Todavía no hay una foto base guardada.");return}
  const a=document.createElement("a");a.href=url;a.download=filename;a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
}
function downloadModel() {
  downloadUrl("assets/model.jpg", "foto-base-noelia.jpg");
}
function buildPrompt(entries){
  const list=entries.map(([category,value])=>`- ${category}: ${value}`).join("\n");
  return `Editá la fotografía de cuerpo entero de Noelia que adjunto y usala como imagen base. Conservá su identidad, rostro, rasgos faciales, cabello y proporciones corporales sin embellecer ni modificar su apariencia. Conservá la pose, postura, encuadre, fondo e iluminación originales. Mantené las dimensiones, resolución y relación de aspecto originales en la medida en que la herramienta lo permita.\n\nAgregá o adaptá exclusivamente estos elementos, integrándolos de forma realista y respetando anatomía, ajuste, perspectiva, sombras e iluminación:\n${list}\n\nNo agregues ninguna otra prenda, accesorio, joya ni elemento que no figure en la lista. No cambies la identidad ni el cuerpo de la modelo, no alteres el fondo ni la composición y no introduzcas objetos adicionales. Devolvé una imagen final de cuerpo entero y conservá la composición original tanto como sea posible. Si algún elemento no puede integrarse sin alterar la imagen, priorizá preservar la foto original. Estas instrucciones son orientativas y el resultado puede variar según la herramienta.`;
}
$("promptForm").onsubmit=e=>{
  e.preventDefault();const entries=[...new FormData(e.currentTarget).entries()].map(([k,v])=>[k,String(v).trim()]).filter(([,v])=>v.length>0);
  if(!entries.length){msg($("promptMsg"),"Completá al menos un campo para generar el prompt.");return}
  $("promptText").value=buildPrompt(entries);$("promptResult").classList.remove("hidden");msg($("promptMsg"),`Prompt generado con ${entries.length} elemento(s).`);
};
$("copyPromptBtn").onclick=async()=>{
  const text=$("promptText").value;
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text)}else{throw new Error("clipboard no disponible")};msg($("promptMsg"),"Prompt copiado al portapapeles.")}
  catch{const area=$("promptText");area.focus();area.select();let copied=false;try{copied=document.execCommand("copy")}catch{}msg($("promptMsg"),copied?"Prompt copiado. Si no aparece en el portapapeles, seleccioná el texto y copialo manualmente.":"No se pudo copiar automáticamente. Seleccioná el texto del cuadro y copiá con Ctrl+C (o ⌘+C).")}
};
$("anotherPromptBtn").onclick=()=>{$("promptForm").reset();$("promptResult").classList.add("hidden");$("promptText").value="";msg($("promptMsg"),"");$("promptForm").querySelector("input")?.focus()};
$("newGarmentFromAI").onclick=()=>{$("garmentDialog").showModal();$("garmentHelp").textContent="Seleccioná la imagen descargada de la IA, asignale un nombre y categoría y guardala en el armario."};
$("downloadModelBtn").onclick=downloadModel;$("downloadModelFromSettings").onclick=downloadModel;
$("settingsBtnModel").onclick=()=>$("settingsDialog").showModal();

$("loginForm").onsubmit=async e=>{e.preventDefault();msg($("authMsg"),"");try{await signInWithEmailAndPassword(auth,$("loginEmail").value,$("loginPassword").value)}catch(x){msg($("authMsg"),"No se pudo ingresar. Verificá email y contraseña.")}};
$("registerBtn").onclick=()=>$("registerDialog").showModal();
$("registerForm").onsubmit=registerNoelia;
$("forgotBtn").onclick=async()=>{const email=$("loginEmail").value.trim();if(!email)return msg($("authMsg"),"Ingresá primero tu email.");try{await sendPasswordResetEmail(auth,email);msg($("authMsg"),"Se envió el enlace de recuperación.")}catch(x){msg($("authMsg"),"No se pudo enviar el correo.")}};
$("logoutBtn").onclick=()=>signOut(auth);
$("newGarmentBtn").onclick=()=>$("garmentDialog").showModal();
$("saveOutfitBtn").onclick=saveOutfit;$("resetOutfitBtn").onclick=reset;
$("garmentForm").onsubmit=addGarment;$("outfitForm").onsubmit=submitOutfit;$("settingsForm").onsubmit=saveModel;$("useForm").onsubmit=registerUse;
$("settingsBtn").onclick=()=>$("settingsDialog").showModal();
$("adminBtn").onclick=()=>{$("adminDialog").showModal();loadAdminSummary()};
$("adminRefreshBtn").onclick=loadAdminSummary;
$("searchInput").oninput=e=>{state.search=e.target.value;render()};
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{state.tab=t.dataset.tab;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));render()});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());

onAuthStateChanged(auth,async u=>{
  state.user=u;
  $("authView").classList.toggle("hidden",!!u);$("appView").classList.toggle("hidden",!u);
  if(!u)return;
  try{await loadProfile();$("modelImage").src = "assets/model.jpg";await loadGarments();await loadOutfits()}catch(e){alert("No se pudo cargar el armario: "+e.message)}
});

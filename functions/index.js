const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const admin=require("firebase-admin");
admin.initializeApp();
const db=admin.firestore();
const GEMINI_API_KEY=defineSecret("GEMINI_API_KEY");

async function requireAdmin(auth){
  if(!auth) throw new HttpsError("unauthenticated","Autenticación requerida.");
  const snap=await db.doc(`users/${auth.uid}`).get();
  if(!snap.exists||snap.data().role!=="admin") throw new HttpsError("permission-denied","Solo el creador puede ejecutar esta acción.");
}
async function requireUser(auth){
  if(!auth) throw new HttpsError("unauthenticated","Autenticación requerida.");
}

exports.registerNoelia=onCall(async request=>{
  const {email,password}=request.data||{};
  if(!email||!password||password.length<6) throw new HttpsError("invalid-argument","Email y contraseña válida requeridos.");

  const existing=await db.collection("users").where("role","==","user").limit(1).get();
  if(!existing.empty) throw new HttpsError("failed-precondition","La cuenta de Noelia ya existe.");

  try{
    const u=await admin.auth().createUser({email,password,displayName:"Noelia"});
    await db.doc(`users/${u.uid}`).set({email:u.email,displayName:"Noelia",role:"user",createdAt:admin.firestore.FieldValue.serverTimestamp()});
    return {uid:u.uid};
  }catch(e){
    if(e.code==="auth/email-already-exists") throw new HttpsError("already-exists","Ese email ya está registrado.");
    throw new HttpsError("internal","No se pudo crear la cuenta.");
  }
});

exports.adminSummary=onCall(async request=>{
  await requireAdmin(request.auth);
  const [u,g,o]=await Promise.all([db.collection("users").get(),db.collection("garments").get(),db.collection("outfits").get()]);
  return {users:u.size,garments:g.size,outfits:o.size};
});

exports.adaptGarment=onCall({secrets:[GEMINI_API_KEY],timeoutSeconds:180,memory:"1GiB"},async request=>{
  await requireUser(request.auth);
  const d=request.data||{};
  if(!d.modelImage||!d.garmentImage) throw new HttpsError("invalid-argument","Faltan imágenes.");
  const prompt=`You are a virtual wardrobe image editor. The first image is the user's full-body MODEL. The second image is a REAL GARMENT photographed separately. Category: ${d.category}. Garment name: ${d.name||"garment"}.
Create a photorealistic, front-facing, full-body fashion reference image based on the model. Preserve the model's face, hair, body proportions, pose, camera angle, lighting and background exactly. Add ONLY the supplied garment to the correct body area, with realistic fit, folds and occlusion.
The output must be a same-size vertical canvas. Keep the garment aligned exactly to the model. Remove the garment source background and do not add extra accessories or clothing.
For layering, make the non-garment areas transparent if the model allows transparency; otherwise keep them visually identical to the supplied model. Do not change identity or anatomy.`;
  const input=[
    {type:"text",text:prompt},
    {type:"image",mime_type:d.modelMime||"image/jpeg",data:d.modelImage},
    {type:"image",mime_type:d.garmentMime||"image/jpeg",data:d.garmentImage}
  ];
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{"x-goog-api-key":GEMINI_API_KEY.value(),"Content-Type":"application/json"},
    body:JSON.stringify({model:"gemini-3.1-flash-image",input,response_format:{type:"image",mime_type:"image/jpeg",image_size:"1K"}})
  });
  if(!response.ok) throw new HttpsError("internal",`Gemini respondió ${response.status}: ${await response.text()}`);
  const json=await response.json();
  let imageData=null;
  for(const step of (json.steps||[])){
    for(const block of (step.content||[])){
      if(block.type==="image"&&block.data){imageData=`data:${block.mime_type||"image/jpeg"};base64,${block.data}`}
    }
  }
  if(!imageData&&json.output_image?.data) imageData=`data:${json.output_image.mime_type||"image/jpeg"};base64,${json.output_image.data}`;
  if(!imageData) throw new HttpsError("internal","La IA no devolvió una imagen.");
  return {imageDataUrl:imageData};
});

// GodriadMedia - PAYMENT + SAFARICOM VERIFY SERVER
// Deploy: Node.js on Render / Railway / Firebase Functions / VPS
// NEVER put Daraja secret / passkey in the HTML file. Only here, on server, in env vars.
// Env vars needed: DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_PASSKEY, DARAJA_SHORTCODE, FIREBASE_PROJECT_ID
// This file does NOT charge anyone by itself. It only VERIFIES after provider callback.
const express = require('express');
const app = express();
app.use(express.json());

// 1. PAYMENT VERIFY - app calls this. Server checks provider, then marks order PAID in Firestore.
// Replace checkWithProvider() with your real provider (Paystack / Stripe / M-Pesa) API call.
async function checkWithProvider(orderId){
  // TODO: call provider API with secret key from env, return true only if provider says PAID
  return false;
}
app.post('/verify', async (req,res)=>{
  try{
    const {orderId} = req.body||{};
    if(!orderId) return res.json({paid:false});
    const paid = await checkWithProvider(orderId);
    if(paid){
      // TODO: update Firestore orders/{orderId} -> status='paid', unlock VIP/Boost on server only
    }
    return res.json({paid});
  }catch(e){ return res.json({paid:false, error:e.message}); }
});

// 2. SAFARICOM BUNDLE VERIFY - Safaricom calls /daraja-callback, NOT the app.
// App calls /verify-bundle, server checks if callback already arrived for that checkoutRequestId.
const verifiedBundles = new Map(); // In production use Firestore, not memory
app.post('/daraja-callback', (req,res)=>{
  try{
    const stk = req.body?.Body?.stkCallback;
    if(stk && stk.ResultCode===0){
      const id = stk.CheckoutRequestID;
      verifiedBundles.set(id, {delivered:true, amount: stk.CallbackMetadata, time: Date.now()});
      // TODO: save to Firestore bundles/{id} -> delivered:true
    }
    return res.json({ok:true});
  }catch(e){ return res.json({ok:false}); }
});
app.post('/verify-bundle', (req,res)=>{
  const {checkoutRequestId} = req.body||{};
  const found = verifiedBundles.get(checkoutRequestId);
  return res.json({delivered: !!(found && found.delivered)});
});


// 3. CLOUDINARY SIGNING - App asks server for signature, server uses SECRET (never in app)
// Env: CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME
// Allowed presets only - prevents someone using your server to sign any preset
const GM_ALLOWED_PRESETS = ['godriad_profile','godriad_post','godriad_reel','godriad_story'];
const GM_PRESET_FOLDERS = {
  godriad_profile: 'godriadmedia/profile-photos',
  godriad_post: 'godriadmedia/post-images',
  godriad_reel: 'godriadmedia/videos',
  godriad_story: 'godriadmedia/stories'
};
app.post('/sign-cloudinary', (req,res)=>{
  try{
    const {preset} = req.body||{};
    if(!GM_ALLOWED_PRESETS.includes(preset)) return res.json({error:'preset not allowed'});
    const timestamp = Math.floor(Date.now()/1000);
    const folder = GM_PRESET_FOLDERS[preset];
    // Signature = SHA1(timestamp + folder + preset + secret) - Cloudinary format
    // We use Node crypto, no cloudinary SDK needed for signing
    const crypto = require('crypto');
    const toSign = `folder=${folder}&timestamp=${timestamp}&upload_preset=${preset}${process.env.CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    return res.json({timestamp, signature, api_key: process.env.CLOUDINARY_API_KEY, folder, cloud_name: process.env.CLOUDINARY_CLOUD_NAME});
  }catch(e){ return res.json({error:e.message}); }
});

const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log('Godriad verify server on '+PORT));


// GodriadMedia - SECURE PAYMENT + SAFARICOM + CLOUDINARY SERVER

const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();

// 1. FIREBASE ADMIN INITIALIZATION
let firebaseReady = false;

try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing');
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  firebaseReady = true;
  console.log('[FIREBASE] Admin initialized');

} catch (error) {
  console.error('[FIREBASE INIT ERROR]', error.message);
}

// 2. CORS
const ALLOWED_ORIGINS = [
  'https://godriadmedia.vercel.app'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '2mb' }));

// 3. REQUEST LOGGING
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  next();
});

// 4. FIREBASE LOGIN VERIFICATION
async function requireFirebaseAuth(req, res, next) {
  if (!firebaseReady) {
    return res.status(503).json({
      error: 'Authentication service unavailable'
    });
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: 'Firebase login required'
    });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(match[1]);

    req.firebaseUser = decodedToken;
    next();

  } catch (error) {
    console.log('[AUTH] Token rejected');

    return res.status(401).json({
      error: 'Invalid or expired login token'
    });
  }
}

// 5. HEALTH CHECK
app.get('/', (req, res) => {
  res.json({
    service: 'GodriadMedia Verify Server',
    status: 'running',
    firebaseReady
  });
});

// 6. PAYMENT VERIFICATION
async function checkWithProvider(orderId) {
  // Real payment-provider verification is not implemented.
  return false;
}

app.post('/verify', async (req, res) => {
  try {
    const { orderId } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ paid: false });
    }

    const paid = await checkWithProvider(orderId);
    return res.json({ paid });

  } catch (error) {
    console.error('[PAYMENT VERIFY ERROR]', error.message);
    return res.status(500).json({ paid: false });
  }
});

// 7. SAFARICOM BUNDLE CALLBACK
// Temporary storage only. Persistent storage and callback
// authenticity verification are still required.

const verifiedBundles = new Map();

app.post('/daraja-callback', (req, res) => {
  try {
    const stk = req.body?.Body?.stkCallback;

    if (stk && stk.ResultCode === 0 && stk.CheckoutRequestID) {
      verifiedBundles.set(stk.CheckoutRequestID, {
        delivered: true,
        time: Date.now()
      });

      console.log('[DARAJA] Successful callback received');
    }

    return res.json({ ok: true });

  } catch (error) {
    console.error('[DARAJA CALLBACK ERROR]', error.message);
    return res.status(500).json({ ok: false });
  }
});

app.post('/verify-bundle', (req, res) => {
  const { checkoutRequestId } = req.body || {};

  if (!checkoutRequestId) {
    return res.status(400).json({ delivered: false });
  }

  const found = verifiedBundles.get(checkoutRequestId);

  return res.json({
    delivered: !!(found && found.delivered)
  });
});

// 8. CLOUDINARY SIGNING
const GM_ALLOWED_PRESETS = [
  'godriad_profile',
  'godriad_post',
  'godriad_reel',
  'godriad_story'
];

const GM_PRESET_FOLDERS = {
  godriad_profile: 'godriadmedia/profile-photos',
  godriad_post: 'godriadmedia/post-images',
  godriad_reel: 'godriadmedia/videos',
  godriad_story: 'godriadmedia/stories'
};

// A valid Firebase login is now required.
app.post('/sign-cloudinary', requireFirebaseAuth, (req, res) => {
  try {
    const {
      CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET,
      CLOUDINARY_CLOUD_NAME
    } = process.env;

    if (
      !CLOUDINARY_API_KEY ||
      !CLOUDINARY_API_SECRET ||
      !CLOUDINARY_CLOUD_NAME
    ) {
      return res.status(503).json({
        error: 'Cloudinary configuration is incomplete'
      });
    }

    const { preset } = req.body || {};

    if (!GM_ALLOWED_PRESETS.includes(preset)) {
      return res.status(400).json({
        error: 'Preset not allowed'
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = GM_PRESET_FOLDERS[preset];

    const toSign =
      `folder=${folder}` +
      `&timestamp=${timestamp}` +
      `&upload_preset=${preset}`;

    const signature = crypto
      .createHash('sha1')
      .update(toSign + CLOUDINARY_API_SECRET)
      .digest('hex');

    console.log(`[CLOUDINARY] Authorized signature for ${preset}`);

    return res.json({
      timestamp,
      signature,
      api_key: CLOUDINARY_API_KEY,
      folder,
      cloud_name: CLOUDINARY_CLOUD_NAME
    });

  } catch (error) {
    console.error('[CLOUDINARY SIGN ERROR]', error.message);

    return res.status(500).json({
      error: 'Unable to create Cloudinary signature'
    });
  }
});

// 9. START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Godriad verify server on ' + PORT);
});

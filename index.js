
// GodriadMedia - PAYMENT + SAFARICOM + CLOUDINARY VERIFY SERVER
// Render: Node.js service
// Keep all private API secrets in Render Environment Variables.
// Never put Cloudinary API secrets or payment secrets in frontend code.

const express = require('express');
const crypto = require('crypto');

const app = express();

// 1. CORS — allow the official GodriadMedia website.
const ALLOWED_ORIGINS = [
  'https://godriadmedia.vercel.app'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '2mb' }));

// Basic request logging — never log secrets or uploaded files.
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  next();
});

// 2. Health check
app.get('/', (req, res) => {
  res.json({
    service: 'GodriadMedia Verify Server',
    status: 'running'
  });
});

// 3. PAYMENT VERIFICATION
async function checkWithProvider(orderId) {
  // Payment-provider verification is not implemented yet.
  // Never mark an order paid without checking the real provider.
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

// 4. SAFARICOM BUNDLE CALLBACK
// This temporary Map loses its records when the server restarts.
// Firestore persistence and callback validation are still required.
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

// 5. CLOUDINARY SIGNING
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

app.post('/sign-cloudinary', (req, res) => {
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
      console.error('[CLOUDINARY] Required environment variables missing');

      return res.status(503).json({
        error: 'Cloudinary server configuration is incomplete'
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

    // Parameters are signed in alphabetical order.
    const toSign =
      `folder=${folder}` +
      `&timestamp=${timestamp}` +
      `&upload_preset=${preset}`;

    const signature = crypto
      .createHash('sha1')
      .update(toSign + CLOUDINARY_API_SECRET)
      .digest('hex');

    console.log(`[CLOUDINARY] Signature created for ${preset}`);

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

// 6. START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Godriad verify server on ' + PORT);
});

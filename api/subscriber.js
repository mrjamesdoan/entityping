// Subscriber dashboard API — magic link auth + subscriber data
// POST /api/subscriber          → { action: "login", email } — send magic link
// GET  /api/subscriber?token=X  → verify magic link, set session cookie
// GET  /api/subscriber          → return subscriber dashboard data (authed)
// PUT  /api/subscriber          → update subscriber preferences (authed)

const crypto = require("crypto");
const { redis, redisPipeline } = require("./_lib/redis");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const BASE_URL = "https://entityping.com";
const TOKEN_TTL = 600; // 10 minutes
const SESSION_TTL = 2592000; // 30 days

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") return handleLogin(req, res);

  if (req.method === "GET") {
    // Token verification flow
    if (req.query?.token) return handleVerify(req, res);
    // Dashboard data (requires session)
    return handleDashboard(req, res);
  }

  if (req.method === "PUT") return handleUpdate(req, res);

  return res.status(405).json({ error: "Method not allowed" });
};

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function getSessionId(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/ep_sub=([^;]+)/);
  return match ? match[1] : null;
}

async function getSubscriber(req) {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;

  const email = await redis(["GET", `sub:session:${sessionId}`]);
  if (!email) return null;

  const raw = await redis(["HGETALL", `sub:${email}`]);
  if (!raw || raw.length === 0) return null;

  const sub = {};
  for (let i = 0; i < raw.length; i += 2) {
    sub[raw[i]] = raw[i + 1];
  }
  return sub;
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    "Set-Cookie",
    `ep_sub=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`
  );
}

// ---------------------------------------------------------------------------
// POST — Send magic link email
// ---------------------------------------------------------------------------

async function handleLogin(req, res) {
  try {
    const { action, email } = req.body || {};

    if (action !== "login" || !email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }

    const normalised = email.toLowerCase().trim();

    // Generate magic link token
    const token = crypto.randomBytes(32).toString("hex");

    // Store token → email mapping with TTL
    await redisPipeline([
      ["SET", `sub:token:${token}`, normalised, "EX", TOKEN_TTL.toString()],
    ]);

    // Ensure subscriber record exists (create if first login)
    const existing = await redis(["EXISTS", `sub:${normalised}`]);
    if (!existing) {
      const now = new Date().toISOString();
      await redisPipeline([
        [
          "HSET", `sub:${normalised}`,
          "email", normalised,
          "plan", "free",
          "status", "active",
          "industries", "",
          "states", "",
          "createdAt", now,
          "lastLoginAt", "",
          "leadsDelivered", "0",
        ],
        ["SADD", "sub:index", normalised],
      ]);
    }

    // Send magic link email
    const magicLink = `${BASE_URL}/api/subscriber?token=${token}`;

    await sendEmail(
      normalised,
      "Your EntityPing login link",
      `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
          <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
        </div>

        <div style="padding: 32px 0;">
          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Click the button below to log into your EntityPing dashboard. This link expires in 10 minutes.</p>

          <a href="${magicLink}" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; margin: 8px 0 16px;">Log In to Dashboard</a>

          <p style="font-size: 14px; line-height: 1.6; color: #64748b; margin: 0;">If you didn't request this, you can safely ignore this email.</p>
        </div>

        <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
          <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
        </div>
      </div>
      `
    );

    return res.status(200).json({ success: true, message: "Magic link sent" });
  } catch (err) {
    console.error("Magic link error:", err.message);
    return res.status(500).json({ error: "Failed to send login link" });
  }
}

// ---------------------------------------------------------------------------
// GET ?token= — Verify magic link and create session
// ---------------------------------------------------------------------------

async function handleVerify(req, res) {
  try {
    const { token } = req.query;

    const email = await redis(["GET", `sub:token:${token}`]);
    if (!email) {
      // Token expired or invalid — redirect to dashboard with error
      return res.redirect(302, `${BASE_URL}/dashboard?error=expired`);
    }

    // Delete used token (one-time use)
    await redis(["DEL", `sub:token:${token}`]);

    // Create session
    const sessionId = crypto.randomBytes(32).toString("hex");
    const now = new Date().toISOString();

    await redisPipeline([
      ["SET", `sub:session:${sessionId}`, email, "EX", SESSION_TTL.toString()],
      ["HSET", `sub:${email}`, "lastLoginAt", now],
    ]);

    setSessionCookie(res, sessionId);

    // Redirect to dashboard
    return res.redirect(302, `${BASE_URL}/dashboard`);
  } catch (err) {
    console.error("Token verify error:", err.message);
    return res.redirect(302, `${BASE_URL}/dashboard?error=server`);
  }
}

// ---------------------------------------------------------------------------
// GET — Dashboard data (authed)
// ---------------------------------------------------------------------------

async function handleDashboard(req, res) {
  const sub = await getSubscriber(req);
  if (!sub) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    // Fetch delivery history
    const deliveries = await redis([
      "ZREVRANGE", `sub:deliveries:${sub.email}`, "0", "29", "WITHSCORES",
    ]);

    const deliveryLog = [];
    if (deliveries) {
      for (let i = 0; i < deliveries.length; i += 2) {
        try {
          const entry = JSON.parse(deliveries[i]);
          entry._score = deliveries[i + 1];
          deliveryLog.push(entry);
        } catch (e) {
          // skip malformed
        }
      }
    }

    // Parse plan details
    const planDetails = getPlanDetails(sub.plan);

    return res.status(200).json({
      subscriber: {
        email: sub.email,
        plan: sub.plan,
        status: sub.status,
        industries: sub.industries ? sub.industries.split(",").filter(Boolean) : [],
        states: sub.states ? sub.states.split(",").filter(Boolean) : [],
        createdAt: sub.createdAt,
        lastLoginAt: sub.lastLoginAt,
        leadsDelivered: parseInt(sub.leadsDelivered) || 0,
      },
      planDetails,
      deliveries: deliveryLog,
    });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    return res.status(500).json({ error: "Failed to load dashboard" });
  }
}

// ---------------------------------------------------------------------------
// PUT — Update subscriber preferences
// ---------------------------------------------------------------------------

async function handleUpdate(req, res) {
  const sub = await getSubscriber(req);
  if (!sub) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { industries, states } = req.body || {};
    const updates = ["updatedAt", new Date().toISOString()];

    if (industries !== undefined) {
      const val = Array.isArray(industries) ? industries.join(",") : industries;
      updates.push("industries", val);
    }
    if (states !== undefined) {
      const val = Array.isArray(states) ? states.join(",") : states;
      updates.push("states", val);
    }

    await redis(["HSET", `sub:${sub.email}`, ...updates]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update error:", err.message);
    return res.status(500).json({ error: "Failed to update preferences" });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlanDetails(plan) {
  const plans = {
    free: {
      name: "Free Sample",
      leads: 25,
      industries: 1,
      price: 0,
      features: ["25 sample leads", "Grade-A only"],
    },
    starter: {
      name: "Starter",
      leads: 200,
      industries: 3,
      price: 39,
      features: ["200 leads/month", "3 industries", "Daily CSV", "Grade-A only"],
    },
    growth: {
      name: "Growth",
      leads: 600,
      industries: 8,
      price: 99,
      features: ["600 leads/month", "8 industries", "All grades", "Priority delivery by 7 AM"],
    },
    pro: {
      name: "Pro",
      leads: -1,
      industries: 16,
      price: 249,
      features: ["Unlimited leads", "All 16 industries", "Priority delivery", "Dedicated support", "CRM-ready CSV"],
    },
  };
  return plans[plan] || plans.free;
}

async function sendEmail(to, subject, html) {
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    throw new Error(`Resend error: ${emailRes.status} ${err}`);
  }

  return emailRes.json();
}

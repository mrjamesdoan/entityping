const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // Timing-safe comparison
  const a = Buffer.from(password);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid password" });
  }

  // Set HttpOnly cookie, 7-day expiry
  res.setHeader(
    "Set-Cookie",
    `ep_admin=${secret}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
  );
  return res.status(200).json({ success: true });
};

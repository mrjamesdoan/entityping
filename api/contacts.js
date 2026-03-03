const crypto = require("crypto");
const { redis, redisPipeline, isAuthed, unauthorized } = require("./lib/redis");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (!isAuthed(req)) return unauthorized(res);

  if (req.method === "GET") {
    return handleList(req, res);
  } else if (req.method === "POST") {
    return handleCreate(req, res);
  }
  return res.status(405).json({ error: "Method not allowed" });
};

async function handleList(req, res) {
  try {
    const status = req.query?.status;
    let ids;

    if (status) {
      ids = await redis(["SMEMBERS", `contacts:status:${status}`]);
    } else {
      // Get all contact IDs sorted by most recently updated
      ids = await redis(["ZREVRANGE", "contacts:index", "0", "199"]);
    }

    if (!ids || ids.length === 0) {
      return res.status(200).json([]);
    }

    // Fetch each contact's data
    const pipeline = ids.map((id) => ["HGETALL", `contact:${id}`]);
    const results = await redisPipeline(pipeline);

    const contacts = results
      .map((r) => {
        if (!r.result || r.result.length === 0) return null;
        // HGETALL returns flat array: [key, value, key, value, ...]
        const obj = {};
        const arr = r.result;
        for (let i = 0; i < arr.length; i += 2) {
          obj[arr[i]] = arr[i + 1];
        }
        return obj;
      })
      .filter(Boolean);

    return res.status(200).json(contacts);
  } catch (err) {
    console.error("Contacts list error:", err.message);
    return res.status(500).json({ error: "Failed to list contacts" });
  }
}

async function handleCreate(req, res) {
  try {
    const { name, email, company, status, industry, vertical, source, notes } =
      req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check for duplicate
    const existingId = await redis(["GET", `contacts:email:${email}`]);
    if (existingId) {
      const existing = await redis(["HGETALL", `contact:${existingId}`]);
      const obj = {};
      for (let i = 0; i < existing.length; i += 2) {
        obj[existing[i]] = existing[i + 1];
      }
      return res.status(200).json({ contact: obj, existing: true });
    }

    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const ts = Date.now();
    const contactStatus = status || "new";

    await redisPipeline([
      [
        "HSET", `contact:${id}`,
        "id", id,
        "name", name || "",
        "email", email,
        "company", company || "",
        "status", contactStatus,
        "source", source || "manual",
        "industry", industry || "",
        "vertical", vertical || "",
        "createdAt", now,
        "updatedAt", now,
        "notes", notes || "",
      ],
      ["ZADD", "contacts:index", ts.toString(), id],
      ["SADD", `contacts:status:${contactStatus}`, id],
      ["SET", `contacts:email:${email}`, id],
    ]);

    return res.status(201).json({
      contact: {
        id, name: name || "", email, company: company || "",
        status: contactStatus, source: source || "manual",
        industry: industry || "", vertical: vertical || "",
        createdAt: now, updatedAt: now, notes: notes || "",
      },
      existing: false,
    });
  } catch (err) {
    console.error("Contact create error:", err.message);
    return res.status(500).json({ error: "Failed to create contact" });
  }
}

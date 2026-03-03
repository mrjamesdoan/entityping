// Unified contacts endpoint — list, create, get by ID, and update
// GET  /api/contacts           → list all (optional ?status= filter)
// POST /api/contacts           → create new contact
// GET  /api/contacts?id=X      → get single contact + events
// PUT  /api/contacts?id=X      → update contact fields
// Merges former contacts.js + contacts/[id].js into a single serverless function

const crypto = require("crypto");
const { redis, redisPipeline, isAuthed, unauthorized } = require("./_lib/redis");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (!isAuthed(req)) return unauthorized(res);

  const id = req.query?.id;

  // Single-contact operations (when ?id= is present)
  if (id) {
    if (req.method === "GET") return handleGet(req, res, id);
    if (req.method === "PUT") return handleUpdate(req, res, id);
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Collection operations
  if (req.method === "GET") return handleList(req, res);
  if (req.method === "POST") return handleCreate(req, res);
  return res.status(405).json({ error: "Method not allowed" });
};

// ---------------------------------------------------------------------------
// List contacts
// ---------------------------------------------------------------------------

async function handleList(req, res) {
  try {
    const status = req.query?.status;
    let ids;

    if (status) {
      ids = await redis(["SMEMBERS", `contacts:status:${status}`]);
    } else {
      ids = await redis(["ZREVRANGE", "contacts:index", "0", "199"]);
    }

    if (!ids || ids.length === 0) {
      return res.status(200).json([]);
    }

    const pipeline = ids.map((id) => ["HGETALL", `contact:${id}`]);
    const results = await redisPipeline(pipeline);

    const contacts = results
      .map((r) => {
        if (!r.result || r.result.length === 0) return null;
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

// ---------------------------------------------------------------------------
// Create contact
// ---------------------------------------------------------------------------

async function handleCreate(req, res) {
  try {
    const { name, email, company, status, industry, vertical, source, notes } =
      req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

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

// ---------------------------------------------------------------------------
// Get single contact + events
// ---------------------------------------------------------------------------

async function handleGet(req, res, id) {
  try {
    const raw = await redis(["HGETALL", `contact:${id}`]);
    if (!raw || raw.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const contact = {};
    for (let i = 0; i < raw.length; i += 2) {
      contact[raw[i]] = raw[i + 1];
    }

    // Get events (most recent first, last 100)
    const eventsRaw = await redis([
      "ZREVRANGE", `contact:${id}:events`, "0", "99", "WITHSCORES",
    ]);

    const events = [];
    if (eventsRaw) {
      for (let i = 0; i < eventsRaw.length; i += 2) {
        try {
          const evt = JSON.parse(eventsRaw[i]);
          evt._score = eventsRaw[i + 1];
          events.push(evt);
        } catch (e) {
          // skip malformed events
        }
      }
    }

    return res.status(200).json({ contact, events });
  } catch (err) {
    console.error("Contact get error:", err.message);
    return res.status(500).json({ error: "Failed to get contact" });
  }
}

// ---------------------------------------------------------------------------
// Update contact
// ---------------------------------------------------------------------------

async function handleUpdate(req, res, id) {
  try {
    const existing = await redis(["HGETALL", `contact:${id}`]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const contact = {};
    for (let i = 0; i < existing.length; i += 2) {
      contact[existing[i]] = existing[i + 1];
    }

    const { name, company, status, industry, notes } = req.body || {};
    const now = new Date().toISOString();
    const ts = Date.now();
    const updates = ["updatedAt", now];
    const pipeline = [];

    if (name !== undefined) updates.push("name", name);
    if (company !== undefined) updates.push("company", company);
    if (industry !== undefined) updates.push("industry", industry);

    // Status change
    if (status && status !== contact.status) {
      updates.push("status", status);
      pipeline.push(["SREM", `contacts:status:${contact.status}`, id]);
      pipeline.push(["SADD", `contacts:status:${status}`, id]);
      pipeline.push([
        "ZADD", `contact:${id}:events`, ts.toString(),
        JSON.stringify({
          type: "status_changed",
          timestamp: now,
          data: { oldStatus: contact.status, newStatus: status },
        }),
      ]);
    }

    // Notes
    if (notes !== undefined && notes !== contact.notes) {
      updates.push("notes", notes);
      if (notes.trim()) {
        pipeline.push([
          "ZADD", `contact:${id}:events`, ts.toString(),
          JSON.stringify({
            type: "note_added",
            timestamp: now,
            data: { note: notes },
          }),
        ]);
      }
    }

    pipeline.unshift(["HSET", `contact:${id}`, ...updates]);
    pipeline.push(["ZADD", "contacts:index", ts.toString(), id]);

    await redisPipeline(pipeline);

    // Return updated contact
    const updatedRaw = await redis(["HGETALL", `contact:${id}`]);
    const updated = {};
    for (let i = 0; i < updatedRaw.length; i += 2) {
      updated[updatedRaw[i]] = updatedRaw[i + 1];
    }

    return res.status(200).json({ contact: updated });
  } catch (err) {
    console.error("Contact update error:", err.message);
    return res.status(500).json({ error: "Failed to update contact" });
  }
}

const { redis, isAuthed, unauthorized } = require("./lib/redis");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthed(req)) return unauthorized(res);

  try {
    const raw = await redis([
      "ZREVRANGE", "submissions:log", "0", "99", "WITHSCORES",
    ]);

    const submissions = [];
    if (raw) {
      for (let i = 0; i < raw.length; i += 2) {
        try {
          const sub = JSON.parse(raw[i]);
          sub._score = raw[i + 1];
          submissions.push(sub);
        } catch (e) {
          // skip malformed
        }
      }
    }

    return res.status(200).json(submissions);
  } catch (err) {
    console.error("Submissions error:", err.message);
    return res.status(500).json({ error: "Failed to fetch submissions" });
  }
};

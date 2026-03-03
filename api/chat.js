const { redis, redisPipeline, isAuthed, unauthorized } = require("./_lib/redis");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const GROQ_MODEL = "qwen/qwen3-32b";

// Email regex for detecting emails in user messages
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const SYSTEM_PROMPT = `You are a lead specialist on the EntityPing team. You help website visitors understand the product, answer questions, and guide them toward trying the free sample or subscribing. You are a real person on the team — never say you are an AI, assistant, bot, or chatbot. If asked, you're part of the EntityPing sales team.

## About EntityPing
EntityPing delivers targeted business leads daily from 7 data sources: state business filings, industry directories, permits & licences, Google Maps, public records, SOS databases, and business registries. Leads are aggregated, classified into 16 industries, quality-graded (A/B/C), and delivered as clean CSV files.

## Coverage
- **State Filings**: Florida, Texas, Georgia, Colorado, New York, California — new LLC, Corp, and DBA registrations within 24 hours of filing
- **Industry Directories**: Tile & Flooring, Automotive, Restaurants, Healthcare, and 12+ more verticals
- **Permits & Licences**: Contractors, Food & Bev, Healthcare — captured at the moment of certification
- **50,000+ leads** currently in the database, growing daily

## Pricing (monthly)
- **Starter — $39/mo**: 200 leads/month, 3 industries, daily CSV, Grade-A only. $0.20/lead.
- **Growth — $99/mo** (most popular): 600 leads/month, 8 industries, all grades, priority delivery by 7 AM. $0.17/lead.
- **Pro — $249/mo**: Unlimited leads, all 16 industries, priority delivery, dedicated support, CRM-ready CSV. Pennies per lead.
- Annual billing saves 17%.
- All plans: 7-day money-back guarantee, no contracts, cancel anytime.

## What Each Lead Includes
Business name, owner name, full address, entity type (LLC/Corp/DBA), industry classification (16 categories), quality grade (A/B/C), filing date, phone number.

## Quality Grades
- **A**: Phone + address + recent filing
- **B**: Address + verified owner
- **C**: Filing data only

## Key Advantages vs Competitors
- vs ZoomInfo ($15K+/yr): 99% cheaper, fresher data (<24h vs weekly), new business filings
- vs Apollo.io ($49/mo): Better freshness (<24h vs monthly), permit/licence data, quality grading
- Free trial: 25 free Grade-A leads (no credit card)

## Your Behaviour
- Be conversational, helpful, and concise. Keep responses under 3 sentences unless explaining something complex.
- Ask qualifying questions naturally: What industry are they in? What do they sell? How many leads do they need?
- When you understand their needs, recommend a specific plan and explain why it fits.
- Always guide toward the free sample: "Want to see the data for yourself? I can send you 25 free leads — just drop your email."
- Never make up information. If you don't know something, say so and offer to connect them with hello@entityping.com.
- Do NOT use markdown headers or bullet points in responses — keep it natural chat style.
- Be brief. This is a chat widget, not an essay.
- CRITICAL RULE about sending samples: You can ONLY send a sample when the user has EXPLICITLY typed their email address in the conversation. If they ask for a sample but have NOT given you their email yet, you MUST ask for it first. NEVER assume you know their email. NEVER use the [SEND_SAMPLE] tag unless you see an actual email address (like name@domain.com) in their messages.
- When a user HAS provided their email address AND wants a free sample, include this exact tag in your response: [SEND_SAMPLE:their@email.com] — replacing with the actual email they typed. After including the tag, confirm the sample is on its way.

/no_think`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET = return chat logs (admin only)
  if (req.method === "GET") {
    if (!isAuthed(req)) return unauthorized(res);
    try {
      const logs = await redis(["ZREVRANGE", "chat:logs", "0", "199", "WITHSCORES"]);
      if (!logs || logs.length === 0) return res.status(200).json([]);
      const entries = [];
      for (let i = 0; i < logs.length; i += 2) {
        try { const e = JSON.parse(logs[i]); e.score = parseInt(logs[i + 1]); entries.push(e); } catch {}
      }
      return res.status(200).json(entries);
    } catch (err) {
      console.error("Chat logs error:", err.message);
      return res.status(500).json({ error: "Failed to fetch chat logs" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }

    // Limit conversation length to prevent abuse (last 20 messages)
    const trimmedMessages = messages.slice(-20);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...trimmedMessages,
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq API error:", groqRes.status, errText);
      return res.status(502).json({ error: "Chat service temporarily unavailable" });
    }

    const data = await groqRes.json();
    let reply = data.choices?.[0]?.message?.content || "I'm sorry, I couldn't process that. Please try again.";
    // Strip Qwen thinking tags
    reply = reply.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    // Check for SEND_SAMPLE tag and trigger sample email
    const sampleMatch = reply.match(/\[SEND_SAMPLE:([^\]]+)\]/);
    if (sampleMatch) {
      const sampleEmail = sampleMatch[1].trim();
      reply = reply.replace(/\[SEND_SAMPLE:[^\]]+\]\s*/g, "").trim();
      // Fire and forget — trigger sample send
      triggerSampleEmail(sampleEmail).catch(err =>
        console.error("Sample send from chat failed:", err.message)
      );
    }

    // Log conversation to Redis sorted set for dashboard review
    try {
      const lastUserMsg = trimmedMessages.filter(m => m.role === "user").pop();
      if (lastUserMsg) {
        const ts = Date.now();
        const logEntry = JSON.stringify({
          id: `chat-${ts}`,
          timestamp: new Date().toISOString(),
          userMessage: lastUserMsg.content,
          assistantReply: reply,
          messageCount: trimmedMessages.length,
          sampleSent: sampleMatch ? sampleMatch[1].trim() : null,
        });
        await redisPipeline([
          ["ZADD", "chat:logs", ts.toString(), logEntry],
        ]);
      }
    } catch (logErr) {
      // Non-fatal — don't let logging break the chat
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Trigger sample email by calling the sample endpoint logic directly
async function triggerSampleEmail(email) {
  // Call our own sample API internally via HTTP
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://entityping.com";
  const res = await fetch(`${baseUrl}/api/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name: "", industry: "Chat Widget" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sample API error: ${res.status} ${text}`);
  }
}

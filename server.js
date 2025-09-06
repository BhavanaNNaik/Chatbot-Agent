import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import session from 'express-session';
import { db } from './db.js';

dotenv.config();
const app = express();
app.use(express.json());

// Setup session 
app.use(session({
  secret: 'stanbot_secret_key',
  resave: false,
  saveUninitialized: true
}));

// Serve frontend
app.use(express.static('public'));

// MEMORY EXTRACTION WITH CONTRADICTION HANDLING
async function extractMemoryLLM(message, userId) {
  try {
   
    const ambiguous = /\bor\b|\bmaybe\b|\bpossibly\b/i.test(message);
    if (ambiguous) return { skipped: true, facts: {} };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        messages: [
          {
            role: 'system',
            content: `
Extract only clear, unambiguous facts from the USER's message.
Always map them to structured keys. Examples:
- "My favorite color is blue" -> {"favorite_color":"blue"}
- "I live in Delhi" -> {"location":"Delhi"}
- "My pet is Kia" -> {"pet":"Kia"}
- "I like anime" -> {"hobby":"anime"}
Return JSON only. If uncertain, vague, or multiple options (e.g., "red or blue"), return {}.
`
          },
          { role: 'user', content: message }
        ],
        temperature: 0
      })
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    let facts = {};
    try { facts = JSON.parse(raw); } catch { console.warn("Could not parse JSON facts."); }

    const contradictions = [];
    // Save facts dynamically
    for (const [key, value] of Object.entries(facts)) {
      const [existing] = await db.query(
        `SELECT memory_value FROM memories WHERE user_id = ? AND memory_key = ?`,
        [userId, key]
      );

      if (existing.length && existing[0].memory_value !== value) {
        contradictions.push({ key, old: existing[0].memory_value, new: value });
        // Update to the latest value
        await db.query(
          `UPDATE memories SET memory_value = ? WHERE user_id = ? AND memory_key = ?`,
          [value, userId, key]
        );
      } else {
        await db.query(
          `INSERT INTO memories (user_id, memory_key, memory_value)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)`,
          [userId, key, value]
        );
      }
    }

    return { contradictions, facts };
  } catch (err) {
    console.error("Memory extraction error:", err.message);
    return { contradictions: [], facts: {} };
  }
}

// TONE DETECTION
function detectTone(message) {
  const lower = message.toLowerCase();
  if (lower.includes("sad") || lower.includes("depressed") || lower.includes("upset")) return "empathetic and supportive";
  if (lower.includes("happy") || lower.includes("excited") || lower.includes("great")) return "cheerful and enthusiastic";
  if (lower.includes("angry") || lower.includes("mad") || lower.includes("frustrated")) return "calm and understanding";
  if (lower.includes("roast") || lower.includes("joke") || lower.includes("funny")) return "sarcastic and witty";
  return "friendly and helpful";
}

// CHAT ENDPOINT 
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Session-based userId
    if (!req.session.userId) req.session.userId = `user_${Date.now()}`;
    const userId = req.session.userId;

    //Extract facts & update memory
    const { contradictions, facts } = await extractMemoryLLM(message, userId);

    //Load latest memory
    const [rows] = await db.query(
      `SELECT memory_key, memory_value FROM memories WHERE user_id = ?`,
      [userId]
    );
    const userFacts = Object.fromEntries(rows.map(r => [r.memory_key, r.memory_value]));

    //Handle "What's my name?" queries
    if (/what(?:'s| is) my name/i.test(message)) {
      const name = userFacts.name;
      const reply = name ? `Your name is ${name}!` : "I don’t think you’ve told me your name yet.";
      return res.json({ reply });
    }

    //Build memory context
    const relevantFacts = [];
    if (userFacts.name) relevantFacts.push(`Your name is ${userFacts.name}`);
    if (userFacts.favorite_color) relevantFacts.push(`Your favorite color is ${userFacts.favorite_color}`);
    if (userFacts.hobby) relevantFacts.push(`You enjoy ${userFacts.hobby}`);
    if (userFacts.location) relevantFacts.push(`You live in ${userFacts.location}`);

    const memoryContext = relevantFacts.length
      ? `Facts about the user: ${relevantFacts.join(", ")}.`
      : "";

    const contradictionContext = contradictions.length
      ? "Also, note there was a change in the following user info: " +
        contradictions.map(c => `${c.key} was "${c.old}", now "${c.new}"`).join("; ") + "."
      : "";

    const tone = detectTone(message);

    // Generate LLM reply 
    let reply = "No reply (check logs)";
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.MODEL,
          messages: [
            {
              role: 'system',
              content: `
You are Stan Bot — a friendly virtual companion.
Always say your name is Stan Bot.
Be ${tone}.

${memoryContext} ${contradictionContext}

Rules:
- If the user asks about YOUR identity, always answer: "I am Stan Bot, a friendly virtual companion."
- Use USER’s facts naturally.
- Never confuse USER’s facts with your own identity.
- For greetings or small talk, keep replies short and natural.
- Mention contradictions gracefully if present.
`
            },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        })
      });

      const data = await response.json();
      if (data.error) reply = `Error: ${data.error.message}`;
      else if (data.choices && data.choices.length > 0) {
        reply = data.choices[0].message?.content || data.choices[0].text || reply;
      }

    } catch (err) {
      console.warn("API request failed, using fallback reply:", err.message);
      const userName = userFacts.name || "there";
      const hobby = userFacts.hobby ? `, and it seems you enjoy ${userFacts.hobby} as a hobby` : "";
      reply = `I am Stan Bot, a friendly virtual companion. Your name is ${userName}${hobby}. How can I assist you today?`;
    }

    return res.json({ reply });

  } catch (err) {
    console.error("Error in /api/chat:", err);
    return res.status(500).json({ error: err.message });
  }
});

//SERVER START 
app.listen(process.env.PORT || 3000, () =>
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3000}`)
);

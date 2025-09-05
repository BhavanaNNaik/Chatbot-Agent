import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { db } from './db.js';   // MySQL connection

dotenv.config();
const app = express();
app.use(express.json());

// Serve frontend
app.use(express.static('public'));

// ------------------ MEMORY EXTRACTION WITH CONTRADICTION HANDLING ------------------
async function extractMemoryLLM(message, userId) {
  try {
    // Skip ambiguous inputs
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
Extract only clear, unambiguous facts from the user message.
Map to structured keys. Examples:
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

// ------------------ TONE DETECTION ------------------
function detectTone(message) {
  const lower = message.toLowerCase();
  if (lower.includes("sad") || lower.includes("depressed") || lower.includes("upset")) return "empathetic and supportive";
  if (lower.includes("happy") || lower.includes("excited") || lower.includes("great")) return "cheerful and enthusiastic";
  if (lower.includes("angry") || lower.includes("mad") || lower.includes("frustrated")) return "calm and understanding";
  if (lower.includes("roast") || lower.includes("joke") || lower.includes("funny")) return "sarcastic and witty";
  return "friendly and helpful";
}

// ------------------ CHAT ENDPOINT ------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Detect ambiguous input first
    if (/\bor\b|\bmaybe\b|\bpossibly\b/i.test(message)) {
      return res.json({ reply: "I noticed some ambiguity in what you said. Could you clarify it for me?" });
    }

    // Extract facts & check contradictions
    const { contradictions } = await extractMemoryLLM(message, userId);

    // Load all memories for user
    const [rows] = await db.query(
      `SELECT memory_key, memory_value FROM memories WHERE user_id = ?`,
      [userId]
    );
    const userFacts = Object.fromEntries(rows.map(r => [r.memory_key, r.memory_value]));

    // Build memory context dynamically for all facts
    const relevantFacts = [];
    for (const [key, value] of Object.entries(userFacts)) {
      relevantFacts.push(`${key}: ${value}`);
    }
    const memoryContext = relevantFacts.length ? `Previously you told me: ${relevantFacts.join(", ")}.` : "";

    // Add contradictions context
    const contradictionContext = contradictions.length
      ? "Also, note there was a change in the following info: " +
        contradictions.map(c => `${c.key} was "${c.old}", now updated to "${c.new}"`).join("; ") + "."
      : "";

    const tone = detectTone(message);

    // Generate reply
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
- Recall all confirmed facts dynamically when relevant.
- Mention contradictions gracefully if present.
- Ask for clarification only for ambiguous inputs (e.g., "red or blue").
- Respond naturally for greetings or small talk.
`
          },
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    let reply = "No reply (check logs)";
    if (data.error) reply = `Error: ${data.error.message}`;
    else if (data.choices && data.choices.length > 0) {
      reply = data.choices[0].message?.content || data.choices[0].text || reply;
    }

    return res.json({ reply });

  } catch (err) {
    console.error("Error in /api/chat:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------ SERVER START ------------------
app.listen(process.env.PORT || 3000, () =>
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3000}`)
);

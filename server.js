import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { db } from './db.js';   // 👈 MySQL connection from db.js

dotenv.config();
const app = express();
app.use(express.json());

// Serve frontend
app.use(express.static('public'));

// ------------------ MEMORY EXTRACTION (via LLM) ------------------
async function extractMemoryLLM(message, userId) {
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
            content:
              "Extract any user facts from the following message and return JSON only. " +
              "Example: {\"name\":\"Kishan\",\"favorite_color\":\"blue\"}. " +
              "If no facts, return {}."
          },
          { role: 'user', content: message }
        ],
        temperature: 0
      })
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    console.log("LLM extraction raw:", raw);

    let facts;
    try {
      facts = JSON.parse(raw);
    } catch {
      facts = {};
    }

    for (const [key, value] of Object.entries(facts)) {
      await db.query(
        `INSERT INTO memories (user_id, memory_key, memory_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)`,
        [userId, key, value]
      );
    }
  } catch (err) {
    console.error("Memory extraction error:", err.message);
  }
}

// ------------------ TONE DETECTION ------------------
function detectTone(message) {
  const lower = message.toLowerCase();

  if (lower.includes("sad") || lower.includes("depressed") || lower.includes("upset")) {
    return "empathetic and supportive";
  }
  if (lower.includes("happy") || lower.includes("excited") || lower.includes("great")) {
    return "cheerful and enthusiastic";
  }
  if (lower.includes("angry") || lower.includes("mad") || lower.includes("frustrated")) {
    return "calm and understanding";
  }
  if (lower.includes("roast") || lower.includes("joke") || lower.includes("funny")) {
    return "sarcastic and witty";
  }

  // default
  return "friendly and helpful";
}

// ------------------ CHAT ENDPOINT ------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Step A: Extract + Save facts
    await extractMemoryLLM(message, userId);

    // Step B: Load stored memories
    const [rows] = await db.query(
      `SELECT memory_key, memory_value FROM memories WHERE user_id = ?`,
      [userId]
    );
    const facts =
      rows.map(r => `${r.memory_key}: ${r.memory_value}`).join(', ') || "No memories yet";

    // Step C: Detect tone
    const tone = detectTone(message);

    // Step D: Get response from OpenRouter
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
            content:
              `You are Stan Bot. Be ${tone}. Remember these facts about the user: ${facts}. ` +
              `If asked, recall them consistently.`
          },
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    console.log("OpenRouter chat raw:", JSON.stringify(data, null, 2));

    const reply =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      'No reply (check logs)';

    res.json({ reply });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------ SERVER START ------------------
app.listen(process.env.PORT || 3000, () =>
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3000}`)
);

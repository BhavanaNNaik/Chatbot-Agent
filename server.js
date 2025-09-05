import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { db } from './db.js';   

dotenv.config();
const app = express();
app.use(express.json());

// Serve frontend (public/index.html)
app.use(express.static('public'));

//  MEMORY EXTRACTION
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
            content: "Extract any user facts from the following message and return JSON only. Example: {\"name\":\"Kishan\",\"favorite_color\":\"blue\"}. If no facts, return {}."
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



//CHAT ENDPOINT
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Step A: Extract + Save facts using LLM
    await extractMemoryLLM(message, userId);

    // Step B: Load stored memories
    const [rows] = await db.query(
      `SELECT memory_key, memory_value FROM memories WHERE user_id = ?`,
      [userId]
    );
    const facts = rows.map(r => `${r.memory_key}: ${r.memory_value}`).join(', ') || "No memories yet";

    // Step C: Call OpenRouter for actual reply
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        messages: [
          { role: 'system', content: `You are Stan Bot. Remember these facts about the user: ${facts}. Answer consistently.` },
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No reply (check logs)';

    res.json({ reply });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: err.message });
  }
});

//SERVER START
app.listen(process.env.PORT, () =>
  console.log(`Server running on http://localhost:${process.env.PORT}`)
);

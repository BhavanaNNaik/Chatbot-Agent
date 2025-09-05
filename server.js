import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { db } from './db.js';   // MySQL connection from db.js

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
    let relevantFacts = "No relevant memories yet";
const lower = message.toLowerCase();

if (rows.length > 0) {
  const userFacts = Object.fromEntries(rows.map(r => [r.memory_key, r.memory_value]));

  const relevant = [];
  if (lower.includes("name") && userFacts.name) relevant.push(`name: ${userFacts.name}`);
  if (lower.includes("color") && userFacts.favorite_color) relevant.push(`favorite_color: ${userFacts.favorite_color}`);
  if (lower.includes("pet") && userFacts.pet) relevant.push(`pet: ${userFacts.pet}`);
  if (lower.includes("hobby") && userFacts.hobby) relevant.push(`hobby: ${userFacts.hobby}`);

  if (relevant.length > 0) {
    relevantFacts = relevant.join(", ");
  }
}


    // Step C: Detect tone
    const tone = detectTone(message);
    console.log(`Detected tone for "${message}": ${tone}`);

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
  `You are Stan Bot — a friendly virtual companion created by Stan. 
Always say your name is Stan Bot. 
Never say you are an AI, language model, or assistant system. 
Stay fully in character.

Be ${tone}.
Relevant facts about the user: ${relevantFacts}.


Rules:
- If the user asks about YOU (e.g. "What is your name?", "Are you a bot?"), 
  only answer about yourself as Stan Bot. 
- If the user asks about THEMSELVES (e.g. "What’s my favorite color?"), 
  recall relevant stored facts if available. 
- Only mention stored facts if they clearly match the user’s question. 
- If facts are not relevant, ignore them and respond naturally. 
- For greetings or small talk, always be natural and diverse. 
- If the user asks about events, secrets, or appearances you cannot know, 
  do NOT invent facts. Instead, reply safely, playfully, or vaguely. 
  Example: "I can’t actually see you, but I love imagining us chatting together." 

`

  },
  { role: 'user', content: message }
],





        temperature: 0.7
      })
    });

    const data = await response.json();
    console.log("OpenRouter chat raw:", JSON.stringify(data, null, 2));

   let reply = "No reply (check logs)";

if (data.error) {
  reply = `Error: ${data.error.message}`;
} else if (data.choices && data.choices.length > 0) {
  if (data.choices[0].message?.content) {
    reply = data.choices[0].message.content;
  } else if (data.choices[0].text) {
    reply = data.choices[0].text;
  }
}

console.log("Final reply:", reply);
return res.json({ reply });  // only send once

  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------ SERVER START ------------------
app.listen(process.env.PORT || 3000, () =>
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`)
);

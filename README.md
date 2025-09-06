# Conversational Chatbot Agent

## Overview   
It implements a **human-like chatbot** with long-term memory, context-aware responses, and empathetic tone adaptation. The chatbot remembers user details, adapts its responses over time, and maintains identity consistency while avoiding hallucinations.  

---

## Objective  
- Deliver natural and engaging conversations.  
- Adapt personality and tone based on input.  
- Store and recall user-specific information across sessions.  
- Ensure identity consistency and safe, grounded answers.  


## Features
- Long-Term Memory Recall: Stores facts per user (MySQL).
- Tone Detection & Adaptation: Empathetic, cheerful, calm, or witty based on input.
- Personalization: Remembers hobbies, preferences, and past chats.
- Contradiction Handling: Detects when facts change and updates memory gracefully.
- Hallucination Resistance: Deflects safely when asked about impossible or unknown events.
- Small-Talk Variety: Randomized greetings for naturalness.
- Identity Consistency: Always stays in character as *Stan Bot*.

---

## Tech Stack
- **Backend:** Node.js + Express  
- **Database:** MySQL
- **LLM API:** OpenRouter.ai
  

---

## Setup Instructions

### 1. Clone Repository  
```bash
git clone https://github.com/BhavanaNNaik/Chatbot-Agent.git
cd stan-bot

2. Install Dependencies
npm install

3. Configure Environment
Create .env file:

PORT=3000
OPENROUTER_API_KEY=your_api_key_here
MODEL=openai/gpt-4o-mini  # or gemini-2.5-flash
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=stanbot

4. Set Up Database
CREATE DATABASE stanbot;
USE stanbot;

CREATE TABLE memories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  memory_key VARCHAR(100) NOT NULL,
  memory_value VARCHAR(255) NOT NULL,
  UNIQUE KEY unique_memory (user_id, memory_key)
);

5. Start the Server
npm start

Access at: http://localhost:3000


->Usage

Start chatting with Stan Bot.

Example prompts:

“Hi, my name is Alex.” → Bot remembers your name.

“I love football.” → Bot recalls this in future sessions.

“I’m feeling sad today.” → Bot adapts empathetic tone.

Try switching sessions to test memory recall.

->Test Cases & Validation

Memory Recall: Bot remembers name & preferences.

Tone Adaptation: Bot adapts to moods (“sad”, “happy”).

Personalization Over Time: Brings up hobbies in later chats.

Naturalness: Diverse greetings & responses.

Identity Consistency: Always answers as Stan Bot.

Hallucination Resistance: Avoids fabricating false memories.

Contradiction Handling: Updates memory when facts change.





- GitHub: [Chatbot-Agent](https://github.com/BhavanaNNaik/Chatbot-Agent)  
- Video Demo: [Watch Video](https://drive.google.com/file/d/1xVEwWGr6AIbS-yDH8VRJQ8V2Umth8CfO/preview)




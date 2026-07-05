import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in your .env file.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log('Connected to Supabase.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const memoryStore = new Map();

async function loadHistory(conversationId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('conversations')
      .select('messages')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) {
      console.error('Supabase load error:', error.message);
      return [];
    }
    return data?.messages || [];
  }
  return memoryStore.get(conversationId) || [];
}

async function saveHistory(conversationId, messages) {
  if (supabase) {
    const { error } = await supabase
      .from('conversations')
      .upsert({ id: conversationId, messages, updated_at: new Date().toISOString() });
    if (error) console.error('Supabase save error:', error.message);
  } else {
    memoryStore.set(conversationId, messages);
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId = 'default', systemPrompt } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing "message" string in request body.' });
    }

    const history = await loadHistory(conversationId);
    const messages = [...history, { role: 'user', content: message }];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt || 'You are a helpful, honest assistant.',
      messages,
    });

    const replyText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const updatedMessages = [...messages, { role: 'assistant', content: replyText }];
    await saveHistory(conversationId, updatedMessages);

    res.json({ reply: replyText });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong talking to Claude.', details: err.message });
  }
});

app.get('/api/history/:conversationId', async (req, res) => {
  const history = await loadHistory(req.params.conversationId);
  res.json({ messages: history });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

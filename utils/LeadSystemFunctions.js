import axios from 'axios';
import { OpenAI } from 'openai';

export async function inviaDatiErroreChiamata(numeroTelefono, motivoErrore, type, transcript) {
  try {
    const response = await axios.post(type && type == "bludental" ? 'https://leadsystembluedental-production.up.railway.app/api/webhook-elevenlabs-sql-errore-chiamata' : 'https://leadsystembluedental-production.up.railway.app/api/webhook-elevenlabs-errore-chiamata', {
      Numero_Telefono: numeroTelefono,
      Motivo_Errore: motivoErrore,
      Transcript: transcript
    });
    console.log('Risposta dal server:', response.data);
  } catch (error) {
    console.error('Errore durante l\'invio dei dati:', error);
  }
}

export async function analizzaTrascrizione(transcript) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `
          Analizza la seguente trascrizione e valuta se la conversazione si è conclusa in maniera naturale o se si è interrotta prima della fine.
          Rispondi solo con "SI" o "NO", non aggiungere altro. Rispondi con la parola "SI" se la conversazione si è conclusa in maniera naturale, altrimenti rispondi con la parola "NO".
          Se l'ultimo messaggio è inviato dall'utente e non dall'agente, rispondi con la parola "SI".
          ` 
        },
        { role: 'user', content: transcript }
      ],
      max_tokens: 1000,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Errore durante l'analisi della trascrizione:", error);
    throw error;
  }
} 

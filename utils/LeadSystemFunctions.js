import axios from 'axios';

export async function inviaDatiErroreChiamata(numeroTelefono, motivoErrore, type) {
  try {
    const response = await axios.post(type && type == "bluedental" ? 'https://leadsystembluedental-production.up.railway.app/api/webhook-elevenlabs-sql-errore-chiamata' : 'https://leadsystembluedental-production.up.railway.app/api/webhook-elevenlabs-errore-chiamata', {
      Numero_Telefono: numeroTelefono,
      Motivo_Errore: motivoErrore
    });
    console.log('Risposta dal server:', response.data);
  } catch (error) {
    console.error('Errore durante l\'invio dei dati:', error);
  }
}

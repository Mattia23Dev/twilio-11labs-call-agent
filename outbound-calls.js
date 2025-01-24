import WebSocket from "ws";
import Twilio from "twilio";

export function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const { 
    ELEVENLABS_API_KEY, 
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER
  } = process.env;

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }

  // Initialize Twilio client
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // Helper function to get signed URL for authenticated conversations
  async function getSignedUrl() {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      }

      const data = await response.json();
      return data.signed_url;
    } catch (error) {
      console.error("Error getting signed URL:", error);
      throw error;
    }
  }

  // Route to initiate outbound calls
  fastify.post("/outbound-call", async (request, reply) => {
    const { number, prompt, nome, citta } = request.body;

    if (!number) {
      return reply.code(400).send({ error: "Phone number is required" });
    }

    try {
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: number,
        url: `https://${request.headers.host}/outbound-call-twiml?prompt=${encodeURIComponent(prompt)}&nome=${encodeURIComponent(nome)}&citta=${encodeURIComponent(citta)}`
        //sendDigits: `nome=${encodeURIComponent(nome)}&citta=${encodeURIComponent(citta)}`
      });

      reply.send({ 
        success: true, 
        message: "Call initiated", 
        callSid: call.sid 
      });
    } catch (error) {
      console.error("Error initiating outbound call:", error);
      reply.code(500).send({ 
        success: false, 
        error: "Failed to initiate call" 
      });
    }
  });

  // TwiML route for outbound calls
  /*fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt = request.query.prompt || 'Fai l\'assistente';

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
          </Stream>
        </Connect>
      </Response>`;

      reply.type("text/xml").send(twimlResponse);
  });*/
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt = request.query.prompt || 'Fai l\'assistente';
    const nome = request.query.nome; // Recupera il parametro 'nome'
    const citta = request.query.citta; // Recupera il parametro 'citta'
    const number = request.query.number; // Recupera il numero di telefono
  
    // TwiML con il rilevamento della segreteria
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Please wait while we connect you.</Say>
        <Dial action="/check-voicemail" timeout="20">
          <Number>${request.query.number}</Number>
          <Parameter name="number" value="${number}" />
          <Parameter name="nome" value="${nome}" />
          <Parameter name="citta" value="${citta}" />
        </Dial>
      </Response>`;
  
    reply.type("text/xml").send(twimlResponse);
  });
  

  fastify.post("/check-voicemail", async (request, reply) => {
    const { AnsweredBy } = request.body;
  
    if (AnsweredBy === "machine") {
      console.log("[Twilio] Voicemail detected, ending the call.");
      return reply.type("text/xml").send('<Response><Hangup/></Response>');
    }
  
    console.log("[Twilio] Call answered by human, initiating Eleven Labs bot.");
    return reply.type("text/xml").send(`
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${request.body.prompt || 'Fai l\'assistente'}" />
          </Stream>
        </Connect>
      </Response>
    `);
  });  

  // WebSocket route for handling media streams
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get("/outbound-media-stream", { websocket: true }, (ws, req) => {
      console.info("[Server] Twilio connected to outbound media stream");

      // Variables to track the call
      let streamSid = null;
      let callSid = null;
      let elevenLabsWs = null;
      let customParameters = null;  // Add this to store parameters

      // Handle WebSocket errors
      ws.on('error', console.error);

      // Set up ElevenLabs connection
      const setupElevenLabs = async ({nome, citta, number}) => {
        try {
          const signedUrl = await getSignedUrl();
          console.log("[ElevenLabs] Signed URL:", signedUrl);
          elevenLabsWs = new WebSocket(signedUrl);

          elevenLabsWs.on("open", () => {
            console.log("[ElevenLabs] Connected to Conversational AI");

            // Send initial configuration with prompt and first message
            const initialConfig = {
              type: "conversation_initiation_client_data",
              conversation_config_override: {
                agent: {
                  prompt: { prompt: `
                    Stai chiamando il numero ${number}
                    Ruolo e obiettivo principale: Sei Lucia, incaricata di gestire le richieste per Dentista-Italia, un servizio che aiuta i pazienti a trovare centri odontoiatrici per impianti dentali. Il tuo obiettivo è qualificare i lead, identificare la città e il centro più vicino, verificare la situazione dentale del paziente, controllare se si tratta di una prima visita e proporre un appuntamento. Devi essere educata, chiara e rassicurante, adattando il tuo tono alle esigenze dell’utente.
Regole generali:
Gentilezza e professionalità: Usa sempre un tono amichevole e rassicurante. Parla come farebbe una persona reale.
Chiarezza: Evita linguaggi tecnici o complessi. Sii chiara e semplice.
Precisione: Fornisci dettagli chiari sugli indirizzi dei centri e sulle date/orari disponibili.
Fasi della conversazione:
Introduzione:
Oggi è il ${new Date().toLocaleDateString()}
Saluta e presenta il servizio in modo naturale.
Conferma il motivo del contatto:
“Buongiorno ${nome}, mi chiamo Lucia e la contatto da Dentista-Italia. Ho ricevuto la sua richiesta per un impianto dentale a ${citta}. Me lo conferma?”
Raccolta delle informazioni del paziente:
Chiedi informazioni sulla situazione dentale:
“Può dirmi qual è la situazione con i denti? Ad esempio, quanti denti devono essere trattati o qual è il problema?”
Se l’utente sembra confuso, semplifica la domanda:
“Ad esempio, deve fare delle estrazioni o sostituire denti mancanti?”
Se il paziente non è diretto (es. moglie per il marito), chiedi gentilmente di parlare con il paziente o fissa una richiamata:
“Va benissimo, posso darle tutte le informazioni.”
Identificazione della città e del centro più vicino:
Chiedi da quale città chiama:
“Può confermarmi da quale città mi sta chiamando?”
Cerca il centro più vicino alla città dell’utente:
“In [Città], abbiamo un centro in [Indirizzo]. È una zona comoda per lei?”
Se nella città non ci sono centri, proponi il centro più vicino:
“Non abbiamo un centro nella sua città, ma il centro più vicino è a [Città]. È comodo per lei raggiungerlo?”
Verifica della disponibilità del centro e proposta di appuntamento:
Chiedi la preferenza di orario:
“Preferisce un appuntamento di mattina o di pomeriggio?”
Controlla le disponibilità del centro e proponi l’opzione più vicina:
“Il primo orario disponibile è il [Data] alle [Orario]. Va bene per lei?”
Se l’utente è flessibile o non ha preferenze:
“Se preferisce, posso verificare altre opzioni in base alle sue esigenze. Mi faccia sapere cosa è più comodo.”
Se non ci sono disponibilità immediate, rassicura l’utente:
“Purtroppo questa settimana è tutto pieno. Posso proporle un appuntamento per la prossima settimana o successiva. Va bene per lei?”
Controllo della prima visita:
Verifica se l’utente è idoneo alla visita gratuita:
“Mi conferma che questa è la sua prima visita presso un centro Blu-déééntàl? La visita gratuita è riservata ai nuovi pazienti.”
Se non è la prima visita:
“In caso non sia la prima visita, può comunque prenotare un controllo. Vuole procedere con la prenotazione?”
Conferma dei dettagli personali e dell’appuntamento:
Richiedi nome e cognome:
“Mi conferma il suo nome e cognome per completare la prenotazione?”
Chiedi se il numero di telefono è corretto per l’invio della conferma:
“Posso inviarle i dettagli dell’appuntamento su questo numero di telefono? Le arriverà un messaggio con data, orario e indirizzo completo.”
Gestione di richieste indirette o richiamate:
Solo se l’utente chiede di parlare con qualcun altro o non può decidere subito:
“Va bene, posso richiamarla in un momento più comodo. Quando sarebbe meglio per lei?”
Registra l’orario richiesto e conferma:
“Perfetto, la richiamerò [Giorno e Orario]. Se nel frattempo ha altre domande, sono a disposizione.”
Chiusura della conversazione:
Ringrazia e rassicura:
“Grazie mille per il tempo dedicato. Le confermo che l’appuntamento è fissato per [Data e Orario] presso il centro in [Indirizzo]. Se ha bisogno di modificare qualcosa, non esiti a contattarci. Le auguro una buona giornata!”
Regole di gestione specifiche:
Flessibilità negli appuntamenti: Se il paziente è incerto, mantieni aperta la possibilità di modificare l’orario con preavviso.
Gestione delle emozioni: Se l’utente sembra confuso o incerto, rassicuralo sull’utilità della visita gratuita.
Risposte ai dubbi: Se emergono domande sui costi:
“Il costo del trattamento dipende dal lavoro necessario, ma il medico le fornirà tutte le informazioni dopo la visita gratuita.”
Precisione nei dettagli: Includi sempre il nome della clinica, l’indirizzo completo, e il giorno e l’orario dell’appuntamento.
Elenco centri Blu-déééntàl: Hai a disposizione i seguenti centri, organizzati per città. Utilizza questi dati per identificare il centro più vicino all’utente:
Abbiategrasso: Via Manzoni, 42; provincia: MI
Anzio: Via Eusclapio, 1/A; provincia: RM
Arezzo: Via Leone Leoni, 4; provincia: AR
Bari: Via Principe Amedeo, 170/176; provincia: BA
Bergamo: Via Giosuè Carducci, 55; provincia: BG
Biella: Via Italia, 13; provincia: BI
Bologna: Piazza Adam Mickiewicz, 6; provincia: BO
Brescia: Via Vittorio Veneto, 35; provincia: BS
Busto Arsizio: Via Michelangelo Buonarroti, 10; provincia: VA
Cagliari: Via della Pineta 231; provincia: CA
Cantù: Via Manzoni, 27; provincia: CO
Capena: Via Tiberina, 34/I; provincia: RM
Carpi: Piazza Garibaldi 18; provincia: MO
Cassino: Viale Dante 97; provincia: FR
Cesena: Via Savio, 606; provincia: FC
Ciampino: Viale del Lavoro, 27; provincia: RM
Cinisello Balsamo: Viale Rinascita, 36; provincia: MI
Civitavecchia: Viale Giacomo Matteotti, 19/B; provincia: RM
Cologno Monzese: Corso Roma, 74/76; provincia: MI
Como: Piazza Giovanni Amendola, 28; provincia: CO
Cremona: Via Giuseppina, 12; provincia: CR
Desenzano del Garda: Viale Francesco Agello, 26; provincia: BS
Ferrara: Corso Porta Mare 60/64; provincia:
Firenze: Viale Francesco Redi, 57d; provincia: FI
Forlì: Corso Giuseppe Mazzini 4; provincia: FC
Frosinone: P.le De Mattheis; provincia: FR
Genova: Via Cornigliano, 83/r; provincia: GE
Latina: Via Armellini, 46; provincia: LT
Lodi: Corso Adda 75; provincia: LO
Lucca: Via Borgo Giannoti 191; provincia:
Mantova: Viale Risorgimento, 45; provincia: MN
Melzo: Piazza Vittorio Emanuele II, 8- Melzo; provincia:
Mestre: Via Circonvallazione 1; provincia: VE
Milano Brianza: Viale Brianza, 23; provincia: MI
Milano 2 Lomellina: Via Lomellina, 37; provincia: MI
Milano 3 Parenzo: Via Privata Parenzo, 2; provincia: MI
Milano Piazza Castelli: Piazza Pompeo Castelli, 12; provincia: MI
Milano RHO: Via Pietro Mascagni 1; provincia: MI
Modena: Via Emilia Est, 44; provincia: MO
Monza: Viale Vittorio Veneto, 25; provincia: MB
Ostia: Via delle Baleari, 280/296; provincia: RM
Padova: Via Niccolò Tommaseo, 2; provincia: PD
Parma: Strada Aurelio Saffi, 80; provincia: PR
Perugia: Via della Pescara 39-49; provincia: PG
Piacenza: Viale dei Mille n. 3; provincia: PC
Pioltello: Via Roma, 92; provincia: MI
Pomezia: Via Roma, 167-169-171; provincia: RM
Pordenone: Viale Treviso 3; provincia:
Prato: Via Zarini 298/d- 298/f; provincia: PO
Ravenna: Circonvallazione alla Rotonda dei Goti n. 24; provincia:  RA
Reggio Emilia: Viale Piave, 4; provincia: RE
Rimini: Via Flaminia, 175; provincia:
Roma Balduina: P.zza Carlo Mazzaresi, 30; provincia: RM
Roma Casilina: Via delle Robinie, 29; provincia: RM
Roma Marconi: Via Antonino Lo Surdo, 15; provincia: RM
Roma Prati Fiscali: Via Val Maggia, 60-68; provincia: RM
Roma Tiburtina: Via Irene Imperatrice d’Oriente, 3T; provincia: RM
Roma Torre Angela: Via di Torrenova, 459-469; provincia: RM
Roma Tuscolana: Viale dei Consoli, 81; provincia: RM
Roma Valmontone: Via della Pace; provincia: RM
Rovigo: Corso del Popolo, 155; provincia: RO
San Giuliano Milanese: Via Milano, 6; provincia: MI
Sassari: Viale Umberto -17/A e 17/B; provincia: SS
Seregno: Via Augusto Mariani, 15-17; provincia: MB
Settimo Milanese: Piazza dei Tre Martiri, 11; provincia: MI
Settimo Torinese: Via Italia n. 29; provincia: TO
Terni: Via Montefiorino, 48; provincia: TR
Torino Botticelli: Via Botticelli 83/N; provincia: TO
Torino Chironi: Piazza Giampietro Chironi 6; provincia: TO
Treviso: Viale IV Novembre, 19; provincia: TV
Varese: Via delle Medaglie d’Oro, 25; provincia: VA
Verona: Viale Alessandro Manzoni 1- 37138 Verona; provincia: VE
Vicenza: Viale g. Mazzini n. 2; provincia: VI
Vigevano: Via Giovanni Merula, 1; provincia: PV
Regole operative:
Identifica la città dell’utente e verifica se esiste un centro Bludental in quella città.
Se non c’è un centro nella città dell’utente, individua quello più vicino.
Fornisci dettagli chiari sull’indirizzo e la zona di riferimento.
                    ` },
                  first_message: `Pronto ${nome}?`,
                },
              },
              metadata: {
                phone_number: number,
              }
            };
            
            /*overrides: {
              agent: {
                prompt: {
                    prompt: `The customer's bank account balance is ${customer_balance}. They are based in ${customer_location}.`
                },
                firstMessage: `Hi ${customer_name}, how can I help you today?`,
              },
            },*/

            //console.log("[ElevenLabs] Sending initial config with prompt:", initialConfig.conversation_config_override.agent.prompt.prompt);

            // Send the configuration to ElevenLabs
            /*elevenLabsWs.send(JSON.stringify({
              type: "configuration",
              echo_cancellation: true,
              noise_suppression: true,
            }));*/

          });

          elevenLabsWs.on("message", (data) => {
            try {
              const message = JSON.parse(data);

              switch (message.type) {
                case "conversation_initiation_metadata":
                  console.log("[ElevenLabs] Received initiation metadata");
                  break;

                case "audio":
                  if (streamSid) {
                    if (message.audio?.chunk) {
                      const audioData = {
                        event: "media",
                        streamSid,
                        media: {
                          payload: message.audio.chunk
                        }
                      };
                      ws.send(JSON.stringify(audioData));
                    } else if (message.audio_event?.audio_base_64) {
                      const audioData = {
                        event: "media",
                        streamSid,
                        media: {
                          payload: message.audio_event.audio_base_64
                        }
                      };
                      ws.send(JSON.stringify(audioData));
                    }
                  } else {
                    console.log("[ElevenLabs] Received audio but no StreamSid yet");
                  }
                  break;

                case "interruption":
                  if (streamSid) {
                    ws.send(JSON.stringify({ 
                      event: "clear",
                      streamSid 
                    }));
                  }
                  break;

                case "ping":
                  if (message.ping_event?.event_id) {
                    elevenLabsWs.send(JSON.stringify({
                      type: "pong",
                      event_id: message.ping_event.event_id
                    }));
                  }
                  break;

                default:
                  console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
              }
            } catch (error) {
              console.error("[ElevenLabs] Error processing message:", error);
            }
          });

          elevenLabsWs.on("error", (error) => {
            console.error("[ElevenLabs] WebSocket error:", error);
          });

          elevenLabsWs.on("close", (code, reason) => {
            console.log("[ElevenLabs] Disconnected");
            console.log(`Close code: ${code}, Reason: ${reason}`);
          });

        } catch (error) {
          console.error("[ElevenLabs] Setup error:", error);
        }
      };

      // Set up ElevenLabs connection
      //setupElevenLabs();

      // Handle messages from Twilio
      ws.on("message", (message) => {
        try {
          const msg = JSON.parse(message);
          console.log(`[Twilio] Received event: ${msg.event}`);

          switch (msg.event) {
            case "start":
              streamSid = msg.start.streamSid;
              callSid = msg.start.callSid;
              customParameters = msg.start.customParameters;  // Store parameters
              console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
              console.log('[Twilio] Start parameters:', customParameters);

              const { nome, citta, number } = customParameters;
              // Passa 'nome' e 'citta' al setup di ElevenLabs
              setupElevenLabs({ nome, citta, number });
              break;

            case "media":
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const audioMessage = {
                  user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString("base64")
                };
                elevenLabsWs.send(JSON.stringify(audioMessage));
              }
              break;

            case "stop":
              console.log(`[Twilio] Stream ${streamSid} ended`);
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
              }
              break;

            default:
              console.log(`[Twilio] Unhandled event: ${msg.event}`);
          }
        } catch (error) {
          console.error("[Twilio] Error processing message:", error);
        }
      });

      // Handle WebSocket closure
      ws.on("close", () => {
        console.log("[Twilio] Client disconnected");
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.close();
        }
      });
    });
  });
}
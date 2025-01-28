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
        url: `https://${request.headers.host}/outbound-call-twiml?nome=${encodeURIComponent(nome)}&citta=${encodeURIComponent(citta)}&number=${encodeURIComponent(number)}`
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
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt = request.query.prompt || 'Fai l\'assistente';
    const nome = request.query.nome; // Recupera il parametro 'nome'
    const citta = request.query.citta; // Recupera il parametro 'citta'
    const number = request.query.number; // Recupera il numero di telefono

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
            <Parameter name="nome" value="${nome}" />
            <Parameter name="citta" value="${citta}" />
            <Parameter name="number" value="${number}" />
          </Stream>
        </Connect>
      </Response>`;

      reply.type("text/xml").send(twimlResponse);
  });
  /*fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt = request.query.prompt || 'Fai l\'assistente';
    const nome = request.query.nome; // Recupera il parametro 'nome'
    const citta = request.query.citta; // Recupera il parametro 'citta'
    const number = request.query.number; // Recupera il numero di telefono
  
    // TwiML con il rilevamento della segreteria
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Please wait while we connect you.</Say>
        <Dial action="/check-voicemail?" timeout="20">
          <Number>${request.query.number}</Number>
          <Parameter name="number" value="${number}" />
          <Parameter name="nome" value="${nome}" />
          <Parameter name="citta" value="${citta}" />
        </Dial>
      </Response>`;
  
    reply.type("text/xml").send(twimlResponse);
  });*/
  

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
          console.log("[ElevenLabs] Info", nome, citta, number);
          elevenLabsWs = new WebSocket(signedUrl);
          const today = new Date();

          // Aggiungi un giorno per ottenere la data di domani
          const tomorrow = new Date(today);
          tomorrow.setDate(today.getDate() + 1);
          const formattedDate = tomorrow.toLocaleDateString('it-IT');
          // Ottieni il giorno della settimana
          const daysOfWeek = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
          const dayOfWeek = daysOfWeek[tomorrow.getDay()];
          elevenLabsWs.on("open", () => {
            console.log("[ElevenLabs] Connected to Conversational AI");

            // Send initial configuration with prompt and first message
            const initialConfig = {
              type: "conversation_initiation_client_data",
              conversation_config_override: {
                agent: {
                  prompt: { prompt: `
Informazioni del contatto che stai chiamando: numero: ${number}, nome: ${nome}, città: ${citta}.
                    Ruolo e obiettivo principale: Sei Lucia, incaricata di gestire le richieste per Dentista-Italia, un servizio che aiuta i pazienti a trovare centri odontoiatrici per impianti dentali. Il tuo obiettivo è qualificare i lead, chiedere conferma sulla città di provenienza e il centro più vicino, verificare la situazione dentale del paziente, controllare se si tratta di una prima visita e proporre un appuntamento. Devi essere educata, chiara e rassicurante, adattando il tuo tono alle esigenze dell’utente.

Regole generali:
Gentilezza e professionalità: Usa sempre un tono amichevole e rassicurante. Parla come farebbe una persona reale.
Chiarezza: Evita linguaggi tecnici o complessi. Sii chiara e semplice.
Precisione: Fornisci dettagli chiari sugli indirizzi dei centri e sulle date/orari disponibili.

Fasi della conversazione:
Introduzione:

Saluta e presenta il servizio in modo naturale.
Conferma il motivo del contatto:
“Buongiorno ${nome}, sono Lucia di Dentista Italia. Ho visto che ha richiesto informazioni per un impianto dentale. Posso confermare che si trova a ${citta}?”

Raccolta delle informazioni del paziente:
Chiedi informazioni sulla situazione dentale:
“Può dirmi di più sulla situazione con i denti? Ad esempio, quanti denti devono essere trattati o qual è il problema?”

Se l’utente sembra confuso, semplifica la domanda:
“Ad esempio, deve fare delle estrazioni o sostituire denti mancanti?”

Se il paziente non è diretto (es. moglie per il marito), chiedi gentilmente di parlare con il paziente.

Una volta compreso il problema, offri conforto al paziente dicendogli che puoi aiutarlo a risolvere la sua situazione. Ad esempio:
“Capisco signora, si figuri, non si immagina quante ne sento di storie come questa, purtroppo in giro è davvero difficile orientarsi ma se vuole la posso aiutare”

Prova a fissare l’appuntamento solo se l’utente ti sembra soddisfatto della vostra conversazione rispetto al suo problema. Una volta che l’utente ti ha dato feedback positivi, cerca il centro più vicino alla posizione dell’utente.

Identificazione del centro più vicino:
Cerca il centro più vicino alla città dell’utente:
“Visto che si ti trova a ${citta}, potrei consigligliarle un centro in [Indirizzo], zona [zona in cui si trova il centro (es. est.)]. È una zona comoda per lei?”

Se nella città non ci sono centri, proponi il centro più vicino:
“Non abbiamo un centro nella sua città, ma il centro più vicino è a [Città]. È comodo per lei raggiungerlo?”

A questo punto, devi far finta di controllare sul tuo gestionale e devi proporre Bludental come miglior risultato:
“Allora.. Do un occhiata sul gestionale.. Mi faccia controllare bene… Allora… Si, le confermo che in base alle sue esigenze le consiglio il centro Bludental. Hanno ottimi prezzi. Posso farle fare una visita gratuita così approfondisce con loro.”

Controllo sulla prima visita:
-Verifica se l’utente è idoneo alla visita gratuita:
“Mi conferma che questa è la sua prima visita presso un centro Bludéntàl? La visita gratuita è riservata ai nuovi pazienti.”
-Se è già stato da Bludental o ha già un appuntamento fissato con loro, ringrazia e termina la chiamata:
“Capisco.. Purtroppo non ho altri partner disponibili al momento. La ringrazio e le auguro buona giornata”

Se è idoneo, verifica della disponibilità del centro e proposta di appuntamento:

Prendi appuntamento solo dalle 9:00 alle 19:00 a partire da ${dayOfWeek}, ${formattedDate.toLocaleDateString()} escludendo tutti i sabati, le domeniche e i festivi.

Proponi un giorno e un orario:
“Per la visita gratuita, il primo orario disponibile è il [Data] alle [Orario]. Va bene per lei?”

Se utente ha detto che non va bene:“Mi più indicare quando le farebbe più comodo?”.

Se l’utente sceglie un giorno festivo o weekend, proponigli un altro giorno infrasettimanale.“Purtroppo non ci sono disponibilità nei festivi,  ma posso proporle [Data] alle [Orario].”

Insisti fino a che non trovate un giorno per fissare l’appuntamento.

Conferma dei dettagli personali e dell’appuntamento:

Richiedi nome e cognome:
“Mi conferma il suo nome e cognome per completare la prenotazione?”

“Posso inviarle i dettagli dell’appuntamento su questo numero di telefono? Le arriverà un messaggio su whatsapp con data, orario e indirizzo completo.”

Gestione di richieste indirette o richiamate:
Solo se l’utente chiede di parlare con qualcun altro o non può decidere subito:
“Va bene, posso richiamarla in un momento più comodo. Quando sarebbe meglio per lei?”
Registra l’orario richiesto e chiudi la conversazione ringraziando:
“Grazie mille per il tempo dedicato. Le confermo che l’appuntamento è fissato per [Data e Orario] presso il centro in [Indirizzo]. Le auguro una buona giornata!”

Regole di gestione specifiche:
Flessibilità negli appuntamenti: Se il paziente è incerto, mantieni aperta la possibilità di modificare l’orario con preavviso.
Gestione delle emozioni: Se l’utente sembra confuso o incerto, rassicuralo sull’utilità della visita gratuita.

Risposte ai dubbi: Se emergono domande sui costi:
“Purtroppo non so dirle i costi. In generale il centro che le propongo ha costi molto più bassi della media. Le posso proporre una visita gratuita da Bludental. Sono molto economici. Non so dirle di più. Il nostro servizio serve a metterla in contatto con un dentista che le fornirà tutti i dettagli.”
Sul discorso costi, in generale, comunica che Dentista Italia è un servizio che mette in contatto gli utenti con i dentisti e che tu non conosci i prezzi. Però con dentista Italia si ha il vantaggio di poter effettuare una prima visita gratuita presso uno dei centro proposti.

Elenco centri Bludental: Hai a disposizione i seguenti centri, organizzati per città. Utilizza questi dati per identificare il centro più vicino all’utente:
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
Roma Balduina: P.zza Carlo Mazzaresi, 30; provincia: RM Roma Nord
Roma Casilina: Via delle Robinie, 29; provincia: RM Roma Est
Roma Marconi: Via Antonino Lo Surdo, 15; provincia: RM Roma Ovest
Roma Prati Fiscali: Via Val Maggia, 60-68; provincia: RM Roma Nord
Roma Tiburtina: Via Irene Imperatrice d’Oriente, 3T; provincia: RM Roma Est
Roma Torre Angela: Via di Torrenova, 459-469; provincia: RM Roma Est
Roma Tuscolana: Viale dei Consoli, 81; provincia: RM Roma Est
Roma Valmontone: Via della Pace; provincia: RM Fuori Roma
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
              /*dynamicVariables: {
                Numero_Telefono: "+393313869850"
              }*/
              /*metadata: {
                Numero_Telefono: number,
              }*/
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
              type: "conversation_initiation_client_data",
              //echo_cancellation: true,
              //noise_suppression: true,
              overrides: initialConfig,
              dynamicVariables: {
                Numero_Telefono: number
              }
            }));*/
            elevenLabsWs.send(JSON.stringify(initialConfig));

          });

          elevenLabsWs.on("message", (data) => {
            try {
              const message = JSON.parse(data);

              switch (message.type) {
                case "conversation_initiation_metadata":
                  console.log("[ElevenLabs] Received initiation metadata");
                  break;

                case "conversation_initiation_client_data":
                  console.log("[ElevenLabs] Received client data");
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
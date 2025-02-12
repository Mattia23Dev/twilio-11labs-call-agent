import WebSocket from "ws";
import Twilio from "twilio";
import { getPromptBludental, getPromptDentistaItalia } from "./prompts.js";

export function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const { 
    ELEVENLABS_API_KEY, 
    ELEVENLABS_AGENT_ID,
    ELEVENLABS_AGENT_ID_BLUDENTAL,
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
  async function getSignedUrl({type}) {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${type && type == "bludental" ? ELEVENLABS_AGENT_ID_BLUDENTAL : ELEVENLABS_AGENT_ID}`,
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

  // Funzione per determinare il saluto in base all'ora
  function getSaluto() {
    const oraAttuale = new Date().getHours();
    return oraAttuale >= 16 ? "Buonasera" : "Buongiorno";
  }
  function getGiorno() {
    const today = new Date();
    let tomorrow = new Date(today);

    // Aggiungi giorni finché non è un giorno feriale (lunedì-venerdì)
    do {
      tomorrow.setDate(tomorrow.getDate() + 1);
    } while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6); // 0 è domenica, 6 è sabato

    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const formattedDate = tomorrow.toLocaleDateString('it-IT', options);
    console.log(formattedDate)
    return formattedDate;
  }
  function getGiornoFormattato() {
    const today = new Date();
    let tomorrow = new Date(today);
  
    // Aggiungi giorni finché non è un giorno feriale (lunedì-venerdì)
    do {
      tomorrow.setDate(tomorrow.getDate() + 1);
    } while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6); // 0 è domenica, 6 è sabato
  
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const formattedDate = tomorrow.toLocaleDateString('it-IT', options);
    const formattedDateNumeric = tomorrow.toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    console.log(formattedDate);
    console.log(formattedDateNumeric);
    return formattedDateNumeric;
  }
  function estraiNomeCompleto(nomeCompleto) {
    const parti = nomeCompleto.split(" ");
    return parti[0];
  }
  // Route to initiate outbound calls
  fastify.post("/outbound-call", async (request, reply) => {
    const { number, prompt, nome, citta, type } = request.body;

    if (!number) {
      return reply.code(400).send({ error: "Phone number is required" });
    }

    try {
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: number,
        url: `https://${request.headers.host}/outbound-call-twiml?nome=${encodeURIComponent(nome)}&citta=${encodeURIComponent(citta)}&number=${encodeURIComponent(number)}&type=${type}`
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
    const type = request.query.type; // Recupera il tipo di chiamata

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
            <Parameter name="nome" value="${nome}" />
            <Parameter name="citta" value="${citta}" />
            <Parameter name="number" value="${number}" />
            <Parameter name="type" value="${type}" />
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

  // Mappa per tenere traccia delle connessioni WebSocket attive
  const activeConnections = new Map();

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
      const setupElevenLabs = async ({nome, citta, number, type, callSid}) => {
        try {
          const signedUrl = await getSignedUrl({type});
          console.log("[ElevenLabs] CallSid:", callSid);
          console.log("[ElevenLabs] Info", nome, citta, number);
          elevenLabsWs = new WebSocket(signedUrl);
          const today = new Date();

          // Aggiungi un giorno per ottenere la data di domani
          const tomorrow = new Date(today);
          tomorrow.setDate(today.getDate() + 1);

          const options = { weekday: 'long', day: 'numeric', month: 'long' };
          const formattedDate = tomorrow.toLocaleDateString('it-IT', options);
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
                    ${type && type == "bludental" ? getPromptBludental(number, nome, citta, callSid) : getPromptDentistaItalia(number, nome, citta, callSid)}
                    ` },
                  first_message: `Si Pronto?, ehm parlo con ${nome}?`,
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
                
                case "user_transcript":
                    console.log("[ElevenLabs] User transcript received:", message);
                    if (message?.user_transcription_event?.user_transcript?.includes("segnale acustico")) {
                      console.log("[ElevenLabs] User transcript Dobbiamo chiudere la chiamata:", message);
                      console.log(`[Twilio] Attempting to retrieve connection with CallSid: ${callSid}`);
                      const ws = activeConnections.get(callSid);
                      if (ws) {
                        ws.close();
                        activeConnections.delete(callSid);
                        console.log("[Twilio] Call ended due to specific transcript");
                        
                        // Chiudi il WebSocket di ElevenLabs se è aperto
                        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                          elevenLabsWs.close();
                          console.log("[ElevenLabs] WebSocket closed due to specific transcript");
                        }
                      } else {
                        console.log("[Twilio] Call not found for CallSid:", callSid);
                      }
                    }
                    break;
            
                case "agent_response":
                    console.log("[ElevenLabs] Agent response received:", message);
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
          //console.log(`[Twilio] Received event: ${msg.event}`);

          switch (msg.event) {
            case "start":
              streamSid = msg.start.streamSid;
              callSid = msg.start.callSid;
              customParameters = msg.start.customParameters;  // Store parameters
              console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
              console.log('[Twilio] Start parameters:', customParameters);

              // Aggiungi la connessione attiva alla mappa prima di chiamare setupElevenLabs
              console.log(`[Twilio] Adding connection to activeConnections with CallSid: ${callSid}`);
              activeConnections.set(callSid, ws);
              console.log("activeConnections", activeConnections);

              const { nome, citta, number, type } = customParameters;
              console.log("callSid", callSid);
              // Passa 'nome' e 'citta' al setup di ElevenLabs
              setupElevenLabs({ nome, citta, number, type, callSid });
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
              console.log(`[Twilio] Unhandled event: ${msg}`);
          }
        } catch (error) {
          console.error("[Twilio] Error processing message:", error);
        }
      });

      // Handle WebSocket closure
      ws.on("close", () => {
        console.log("[Twilio] Client disconnected");
        activeConnections.delete(callSid); // Rimuovi la connessione dalla mappa
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.close();
        }
      });
    });
  });

  // Nuovo endpoint per chiudere la chiamata
  fastify.post("/end-call", async (request, reply) => {
    const { callSid } = request.body;
    console.log("[Twilio] Ending call with CallSid:", callSid);
    if (!callSid) {
      return reply.code(400).send({ error: "CallSid is required" });
    }

    const ws = activeConnections.get(callSid);

    if (ws) {
      ws.close();
      activeConnections.delete(callSid);
      console.log("[Twilio] Call ended");
      return reply.send({ success: true, message: "Call ended" });
    } else {
      return reply.code(404).send({ error: "Call not found" });
    }
  });
}
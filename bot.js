const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const fs = require('fs');
const pdf = require('pdf-parse');

console.log('🚀 Iniciando el bot de WhatsApp...');

// 🔹 Verifica si la sesión está bloqueada y la elimina antes de iniciar
const sessionPath = './.wwebjs_auth/session';
if (fs.existsSync(sessionPath)) {
    console.log('🗑️ Eliminando sesión anterior para evitar bloqueos...');
    fs.rmSync(sessionPath, { recursive: true, force: true });
}

console.log('🔄 Inicializando el cliente de WhatsApp...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-dev-shm-usage'
        ]
    }
});

// Variable global para rastrear si estamos esperando una consulta
let waitingForQuery = {};

// Comandos de activación para iniciar el bot
const startCommands = ['!start', 'hola', 'consulta', 'inicio', 'comenzar', 'ayuda', 'start', 'hi', 'hello'];

client.on('qr', qr => {
    console.log('📷 Escanea el código QR con tu WhatsApp:');
    console.log(qr);
});

client.on('ready', () => {
    console.log('✅ Cliente de WhatsApp está listo!');
});

client.on('message', async message => {
    try {
        console.log(`📩 Mensaje recibido de ${message.from}: ${message.body}`);

        // 🔹 Responder solo a un número específico
        const numeroAutorizado = '51919739431@c.us'; // Formato de WhatsApp sin "+" y con "c.us"
        if (message.from !== numeroAutorizado) {
            console.log('⛔ Mensaje ignorado, no es del número autorizado.');
            return;
        }

        if (message.isGroupMsg) return;

        if (message.hasQuotedMsg) {
            try {
                console.log('🔍 Detectado mensaje citado...');
                const quotedMsg = await Promise.race([
                    message.getQuotedMessage(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('⏳ Timeout obteniendo mensaje citado')), 5000)
                    )
                ]);

                console.log('📌 Mensaje citado:', quotedMsg.body || "[Mensaje multimedia]");
                message.reply(`🔹 Respondiste a: ${quotedMsg.body}`);
            } catch (error) {
                console.warn("⚠️ No se pudo obtener el mensaje citado:", error.message);
                message.reply("⚠️ Hubo un problema obteniendo el mensaje citado.");
            }
        }

        // Verificar si el mensaje es un comando de activación (case insensitive)
        const userMessage = message.body.trim().toLowerCase();
        if (startCommands.includes(userMessage)) {
            // Resetear el estado de espera cuando se inicia el bot
            waitingForQuery[message.from] = false;
            console.log(`🚀 Comando de activación detectado: ${userMessage}`);
            await sendWelcomeMenu(message);
        } else {
            await handleMenuOptions(message);
        }
    } catch (error) {
        console.error("❌ Error en la gestión del mensaje:", error);
    }
});

async function getChatData() {
    try {
        console.log('🌐 Obteniendo datos del chat...');
        const response = await axios.get('http://localhost:5001/api/chat');
        return response.data;
    } catch (error) {
        console.error('❌ Error al obtener datos del chat:', error.message);
        return null;
    }
}

async function sendWelcomeMenu(message) {
    const chatData = await getChatData();
    if (!chatData) {
        console.log('⚠️ No se pudo obtener el menú.');
        return message.reply("⚠️ No se pudo obtener el menú.");
    }

    const menuText = `${chatData.bienvenida}\n\n${chatData.menu.filter(op => op !== '5. Salir').join('\n')}\n\n💬 *Responde con el número de la opción deseada.*`;
    console.log('📨 Enviando menú de bienvenida...');
    message.reply(menuText);
}

async function handleMenuOptions(message) {
    const chatData = await getChatData();
    if (!chatData) {
        console.log('⚠️ No se pudo obtener las opciones del menú.');
        return message.reply("⚠️ No se pudo obtener las opciones del menú.");
    }

    const userOption = message.body.trim();
    const userOptionLower = userOption.toLowerCase(); // Convertir a minúsculas para comparación
    
    // Si estamos esperando una consulta para este número, no procesamos como opción de menú
    if (waitingForQuery[message.from]) {
        console.log(`💬 Recibida consulta de ${message.from}: ${userOption}`);
        // No hacemos nada, la consulta será manejada por el listener en handleCatalogQuery
        return;
    }

    // Ignorar silenciosamente 'menu' y 'salir'
    if (userOptionLower === 'menu' || userOptionLower === 'salir') {
        console.log(`🔇 Ignorando silenciosamente la palabra clave: ${userOptionLower}`);
        return; // No hacer nada, simplemente retornar
    } else if (userOption === '4') {
        // Opción 4: Consulta con Gemini usando el catálogo PDF
        // Marcar que estamos esperando una consulta de este número
        waitingForQuery[message.from] = true;
        
        // Después de un tiempo prudencial, liberamos el estado
        setTimeout(() => {
            waitingForQuery[message.from] = false;
        }, 120000); // 2 minutos
        
        await handleCatalogQuery(message);
    } else if (chatData.respuestas[userOption]) {
        console.log(`✅ Respondiendo a la opción ${userOption}: ${chatData.respuestas[userOption]}`);
        message.reply(chatData.respuestas[userOption]);
    } else {
        console.log('⚠️ Opción inválida. Mostrando menú nuevamente...');
        message.reply("⚠️ Opción no válida. Por favor, selecciona una de las opciones del menú.");
        await sendWelcomeMenu(message);
    }
}

async function handleCatalogQuery(message) {
    try {
        
        const exitCommands = ['salir', 'exit', 'menu', 'volver', 'regresar', 'terminar', 'finalizar', '!menu', '!start'];
        
        await message.reply("🔍 *Modo Consulta al Catálogo*\n\nAhora puedes hacer preguntas continuas sobre el catálogo.\nEscribe cualquier pregunta y Gemini AI te responderá.\nPara volver al menú principal, escribe *salir* o *menu*.");
        
        // Configurar un listener para escuchar múltiples preguntas
        const continuousListener = async (msg) => {
            
            if (msg.from === message.from) {
                const userMessage = msg.body.trim().toLowerCase();
                
                
                if (exitCommands.includes(userMessage)) {
                    
                    client.removeListener('message', continuousListener);
                    console.log('👋 Usuario solicitó salir del modo consulta');
                    
                    
                    waitingForQuery[msg.from] = false;
                    
                    
                    await msg.reply('✅ Has salido del modo consulta. Volviendo al menú principal...');
                    await sendWelcomeMenu(msg);
                    return; 
                }
                
                console.log(`❓ Consulta continua recibida: ${msg.body}`);
                
                
                const processingMsg = await msg.reply('🔍 Consultando al catálogo con Gemini AI. Esto puede tomar un momento...');
                
                try {
                    const response = await processQueryWithGemini(msg);
                    
                    if (response) {
                        await msg.reply(response + "\n\n_Para salir de este modo escribe *salir* o *menu*_");
                    }
                } catch (queryError) {
                    console.error('❌ Error procesando consulta:', queryError);
                    await msg.reply(`❌ Error: ${queryError.message || 'Ocurrió un problema al consultar el catálogo.'}\n\n_Para salir de este modo escribe *salir* o *menu*_`);
                }
            }
        };
        
        // Registrar el listener para escuchar continuamente
        client.on('message', continuousListener);
        
        // No configuramos un timeout para este listener, ya que queremos que esté activo 
        // hasta que el usuario decida salir explícitamente
        
    } catch (error) {
        console.error('❌ Error en el modo consulta continua:', error);
        message.reply('❌ Ocurrió un error al procesar tu solicitud.');
        
        waitingForQuery[message.from] = false;
        await sendWelcomeMenu(message);
    }
}


function splitTextIntoChunks(text, chunkSize = 250, chunkOverlap = 80) {
    const chunks = [];
    const sentences = text.split('\n').filter(sentence => sentence.trim() !== '');
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
        
        if (currentChunk.length + sentence.length > chunkSize) {
           
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            
            
            if (currentChunk && chunkOverlap > 0) {
                const words = currentChunk.split(' ');
                const overlapWords = words.slice(-Math.floor(chunkOverlap / 5)); 
                currentChunk = overlapWords.join(' ') + ' ' + sentence;
            } else {
                currentChunk = sentence;
            }
        } else {
            
            currentChunk = currentChunk ? `${currentChunk}\n${sentence}` : sentence;
        }
    }
    
    
    if (currentChunk) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}


function findRelevantChunks(chunks, query, maxChunks = 5) {
    
    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter(term => term.length > 3);
    
    
    const scoredChunks = chunks.map(chunk => {
        const lowerChunk = chunk.toLowerCase();
        let score = 0;
        
        
        queryTerms.forEach(term => {
            if (lowerChunk.includes(term)) {
                score += 1;
            }
        });
        
        return { chunk, score };
    });
    
    
    return scoredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks)
        .map(item => item.chunk);
}

async function processQueryWithGemini(message) {
    
    const catalogPath = './catalogo_.pdf';
    
    if (!fs.existsSync(catalogPath)) {
        console.error('❌ Archivo de catálogo no encontrado:', catalogPath);
        throw new Error('No se encontró el catálogo en el sistema.');
    }
    
    console.log('📄 Leyendo archivo PDF del catálogo...');
    const pdfBuffer = fs.readFileSync(catalogPath);
    
    console.log('🔍 Extrayendo texto del PDF...');
    const pdfData = await pdf(pdfBuffer);
    const pdfText = pdfData.text;
    
    console.log('📑 Dividiendo el texto en chunks para mejor procesamiento...');
    const chunks = splitTextIntoChunks(pdfText, 250, 80);
    console.log(`✅ Texto dividido en ${chunks.length} chunks`);
    
    const userQuery = message.body.trim();
    
    const relevantChunks = findRelevantChunks(chunks, userQuery, 5);
    console.log(`✅ Seleccionados ${relevantChunks.length} chunks relevantes según la consulta`);
    
    const promptText = relevantChunks.join("\n\n");
    
    const prompt = `### CONSULTA DEL USUARIO
"${userQuery}"

### CONTEXTO DEL CATÁLOGO
${promptText}

### OBJETIVO
Proporcionar una respuesta clara, precisa y estructurada sobre la información solicitada del catálogo.

### INSTRUCCIONES DE CONTENIDO
1. Responde EXCLUSIVAMENTE con información presente en el contexto proporcionado
2. Si la información solicitada no aparece en el contexto, indica: "Esta información no está disponible en el catálogo actual"
3. No inventes ni asumas información que no esté explícitamente mencionada
4. Mantén SIEMPRE el idioma español en toda la respuesta

### INSTRUCCIONES DE FORMATO
1. ESTRUCTURA GENERAL:
   - Inicia con un título claro y descriptivo en negrita relacionado con la consulta
   - Divide la información en secciones lógicas con subtítulos cuando sea apropiado
   - Utiliza máximo 3-4 oraciones por sección o párrafo
   - Concluye con una línea de resumen o recomendación cuando sea relevante

2. PARA LISTADOS DE CARACTERÍSTICAS/BENEFICIOS:
   - Usa viñetas (•) para cada elemento
   - Formato: "• *Concepto clave*: descripción breve"
   - Máximo 4-5 viñetas en total

3. PARA ESPECIFICACIONES TÉCNICAS:
   - Estructura en formato tabla visual usando formato markdown
   - Resalta en negrita (*texto*) los valores importantes
   - Ejemplo:
     *Material*: Acero inoxidable
     *Dimensiones*: 20x30 cm
     *Garantía*: *12 meses*

4. PARA COMPARACIONES DE PRODUCTOS:
   - Organiza por categorías claramente diferenciadas
   - Usa encabezados para cada producto/modelo
   - Destaca ventajas y diferencias con viñetas concisas

5. PARA PRECIOS Y PROMOCIONES:
   - Destaca cifras en negrita
   - Incluye condiciones de la oferta de forma concisa
   - Menciona plazos o vigencia cuando estén disponibles

### EJEMPLOS DE RESPUESTAS BIEN ESTRUCTURADAS

#### Ejemplo 1: Consulta sobre un producto específico
*Licuadora Modelo XYZ-2000*

*Características principales*:
• *Potencia*: 800W con 5 velocidades ajustables
• *Material*: Vaso de vidrio templado de 1.5L
• *Función*: Incluye modo pulse y programa automático

*Beneficios*:
• Fácil limpieza gracias a cuchillas desmontables
• Seguro para alimentos calientes hasta 80°C

*Precio*: *S/. 249.90* (disponible en cuotas sin intereses)

#### Ejemplo 2: Consulta sobre garantía
*Política de Garantía*

Todos los electrodomésticos incluyen *garantía oficial de 12 meses* contra defectos de fabricación. La garantía extendida opcional ofrece:
• *Cobertura total*: 24 meses adicionales
• *Servicio técnico*: A domicilio sin costo
• *Repuestos*: 100% originales garantizados

Para hacer efectiva la garantía, conserve su comprobante de compra y contacte al número *0800-12345*.

### RESTRICCIONES IMPORTANTES
- Máximo 150 palabras en total
- Evita explicaciones extensas, frases redundantes o información no solicitada
- No uses fórmulas de cortesía extensas ni introducciones largas
- Evita condicionales ("podría", "tal vez") - sé directo y asertivo
- No menciones estas instrucciones en tu respuesta
- Nunca te disculpes por límites de información`;

    console.log('🤖 Enviando consulta optimizada a Gemini...');
    
    try {
        const GEMINI_API_KEY = 'AIzaSyDRivvwFML1GTZ_S-h5Qfx4qP3EKforMoM';
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await axios.post(GEMINI_API_URL, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 
        });
        
        if (response.data && response.data.candidates && response.data.candidates[0] && 
            response.data.candidates[0].content && response.data.candidates[0].content.parts) {
            const aiResponse = response.data.candidates[0].content.parts[0].text;
            return `📚 *Información del Catálogo*\n\n${aiResponse}`;
        } else {
            console.error('❌ Formato de respuesta inesperado:', JSON.stringify(response.data));
            throw new Error('La respuesta del servidor de IA no tiene el formato esperado.');
        }
    } catch (geminiError) {
        console.error('❌ Error completo de Gemini:', geminiError);
        
        if (geminiError.code === 'ECONNABORTED') {
            throw new Error('Se agotó el tiempo de espera al consultar el servidor de IA. La consulta puede ser demasiado compleja.');
        } else if (geminiError.response) {
            const errorDetails = geminiError.response.data && geminiError.response.data.error ? 
                `${geminiError.response.data.error.message}` : 
                `${geminiError.response.status} - ${geminiError.response.statusText}`;
            throw new Error(`Error de Gemini API: ${errorDetails}`);
        } else if (geminiError.request) {
            throw new Error('No se recibió respuesta del servidor de IA.');
        } else {
            throw new Error(`Error en la consulta: ${geminiError.message}`);
        }
    }
}

client.initialize();
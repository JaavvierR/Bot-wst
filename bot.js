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
        const numeroAutorizado = '51992198356@c.us'; // Formato de WhatsApp sin "+" y con "c.us"
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

        if (message.body === '!start') {
            // Resetear el estado de espera cuando se inicia el bot
            waitingForQuery[message.from] = false;
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
    
    // Si estamos esperando una consulta para este número, no procesamos como opción de menú
    if (waitingForQuery[message.from]) {
        console.log(`💬 Recibida consulta de ${message.from}: ${userOption}`);
        // No hacemos nada, la consulta será manejada por el listener en handleCatalogQuery
        return;
    }

    if (userOption === '4') {
        // Opción 4: Consulta con Ollama usando el catálogo PDF
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
        await message.reply("🔍 Has seleccionado la opción de consulta al catálogo. Por favor, escribe tu pregunta sobre el catálogo.");
        
        // Configurar un listener temporal para la pregunta del usuario
        const listener = async (msg) => {
            if (msg.from === message.from) {
                // Eliminar el listener después de recibir el mensaje
                client.removeListener('message', listener);
                
                console.log(`❓ Pregunta recibida: ${msg.body}`);
                
                // Enviar mensaje de procesamiento
                const processingMsg = await msg.reply('🔍 Consultando al catálogo con IA. Esto puede tomar un momento...');
                
                try {
                    const response = await processQueryWithOllama(msg);
                    // Solo si hay respuesta exitosa, la enviamos
                    if (response) {
                        await msg.reply(response);
                    }
                    // No enviamos el menú automáticamente después de responder
                } catch (queryError) {
                    console.error('❌ Error procesando consulta:', queryError);
                    await msg.reply(`❌ Error: ${queryError.message || 'Ocurrió un problema al consultar el catálogo.'}`);
                }
                
                // No reiniciamos automáticamente el menú para permitir más consultas
                // Mantenemos el estado waitingForQuery[msg.from] = true para seguir aceptando consultas
            }
        };
        
        client.on('message', listener);
        
        // Establecer un timeout para eliminar el listener si no se recibe respuesta
        setTimeout(() => {
            client.removeListener('message', listener);
            console.log('⌛ Tiempo de espera agotado para recibir la consulta');
        }, 60000); // 1 minuto
        
    } catch (error) {
        console.error('❌ Error en la opción de catálogo:', error);
        message.reply('❌ Ocurrió un error al procesar tu solicitud.');
    }
}

// Función para dividir el texto en chunks según los parámetros dados
function splitTextIntoChunks(text, chunkSize = 250, chunkOverlap = 80) {
    const chunks = [];
    const sentences = text.split('\n').filter(sentence => sentence.trim() !== '');
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
        // Si agregar esta oración excedería el tamaño del chunk
        if (currentChunk.length + sentence.length > chunkSize) {
            // Guardar el chunk actual
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            
            // Iniciar un nuevo chunk, incluyendo overlap del anterior si existe
            if (currentChunk && chunkOverlap > 0) {
                const words = currentChunk.split(' ');
                const overlapWords = words.slice(-Math.floor(chunkOverlap / 5)); // Aproximación para obtener palabras de overlap
                currentChunk = overlapWords.join(' ') + ' ' + sentence;
            } else {
                currentChunk = sentence;
            }
        } else {
            // Agregar la oración al chunk actual
            currentChunk = currentChunk ? `${currentChunk}\n${sentence}` : sentence;
        }
    }
    
    // Agregar el último chunk si no está vacío
    if (currentChunk) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}

// Función para encontrar los chunks más relevantes según la consulta
function findRelevantChunks(chunks, query, maxChunks = 5) {
    // Convertir consulta y chunks a minúsculas para búsqueda case-insensitive
    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter(term => term.length > 3);
    
    // Calcular relevancia de cada chunk
    const scoredChunks = chunks.map(chunk => {
        const lowerChunk = chunk.toLowerCase();
        let score = 0;
        
        // Verificar cuántas palabras de la consulta aparecen en el chunk
        queryTerms.forEach(term => {
            if (lowerChunk.includes(term)) {
                score += 1;
            }
        });
        
        return { chunk, score };
    });
    
    // Ordenar por relevancia y tomar los más relevantes
    return scoredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks)
        .map(item => item.chunk);
}

async function processQueryWithOllama(message) {
    // Ruta al archivo del catálogo
    const catalogPath = './catalogo_.pdf';
    
    // Verificar que el archivo existe
    if (!fs.existsSync(catalogPath)) {
        console.error('❌ Archivo de catálogo no encontrado:', catalogPath);
        throw new Error('No se encontró el catálogo en el sistema.');
    }
    
    console.log('📄 Leyendo archivo PDF del catálogo...');
    // Leer y procesar el PDF
    const pdfBuffer = fs.readFileSync(catalogPath);
    
    console.log('🔍 Extrayendo texto del PDF...');
    const pdfData = await pdf(pdfBuffer);
    const pdfText = pdfData.text;
    
    // Implementar text splitter para dividir el texto en chunks manejables
    console.log('📑 Dividiendo el texto en chunks para mejor procesamiento...');
    const chunks = splitTextIntoChunks(pdfText, 250, 80);
    console.log(`✅ Texto dividido en ${chunks.length} chunks`);
    
    // Preparar prompt para Ollama con la consulta del usuario
    const userQuery = message.body.trim();
    
    // Usar la función de búsqueda de chunks relevantes
    const relevantChunks = findRelevantChunks(chunks, userQuery, 5);
    console.log(`✅ Seleccionados ${relevantChunks.length} chunks relevantes según la consulta`);
    
    // Crear un prompt que incluye la consulta y los chunks relevantes
    const promptText = relevantChunks.join("\n\n");
    
    // Prompt mejorado para respuestas en español y más concisas
    const prompt = `Responde a esta pregunta sobre el catálogo: "${userQuery}"
    
Contenido relevante del catálogo:
${promptText}

INSTRUCCIONES:
1. Responde SIEMPRE en español
2. Sé breve y conciso, máximo 3-4 oraciones
3. Céntrate solo en la información esencial y relevante
4. Si no encuentras la respuesta en el catálogo, indica claramente que esa información no está disponible`;
    
    console.log('🤖 Verificando conexión con Ollama...');
    
    // Verificar si Ollama está disponible
    try {
        // Intento de conexión con timeout reducido para verificar
        await axios.get('http://localhost:11434/api/version', { 
            timeout: 2000 
        });
        
        console.log('✅ Conexión con Ollama establecida correctamente');
    } catch (connectionError) {
        throw new Error('No se pudo conectar con el servidor de IA (Ollama). Verifica que esté en funcionamiento.');
    }
    
    console.log('🤖 Enviando consulta a Ollama...');
    
    try {
        // Llamar a la API de Ollama con timeout extendido
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: 'deepseek-r1:1.5b',
            prompt: prompt,
            stream: false
        }, {
            timeout: 210000 // 3.5 minutos
        });
        
        // Verificar que la respuesta tenga el formato esperado
        if (response.data && response.data.response) {
            const aiResponse = response.data.response;
            return `📚 *Respuesta sobre el catálogo*\n\n${aiResponse}`;
        } else {
            throw new Error('La respuesta del servidor de IA no tiene el formato esperado.');
        }
    } catch (ollamaError) {
        // Manejo específico de errores de Ollama
        if (ollamaError.code === 'ECONNABORTED') {
            throw new Error('Se agotó el tiempo de espera al consultar el servidor de IA. La consulta puede ser demasiado compleja.');
        } else if (ollamaError.code === 'ECONNREFUSED') {
            throw new Error('No se pudo conectar con el servidor de IA (Ollama). Verifica que esté en funcionamiento.');
        } else if (ollamaError.response) {
            throw new Error(`Error del servidor de IA: ${ollamaError.response.status} - ${ollamaError.response.statusText}`);
        } else if (ollamaError.request) {
            throw new Error('No se recibió respuesta del servidor de IA.');
        } else {
            throw new Error(`Error en la consulta: ${ollamaError.message}`);
        }
    }
}

client.initialize();
const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const axios = require('axios');
const fs = require('fs');

console.log('🚀 Iniciando el bot de WhatsApp...');

// 🔹 Elimina la sesión anterior si existe
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

        if (message.body === '!start') {
            await sendWelcomeMenu(message);
        } else {
            await handleMenuOptions(message);
        }
    } catch (error) {
        console.error("❌ Error en la gestión del mensaje:", error);
    }
});

// 🔹 Obtener los datos del chat desde la API
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

// 🔹 Enviar el menú de bienvenida con botones
async function sendWelcomeMenu(message) {
    const chatData = await getChatData();
    if (!chatData) {
        console.log('⚠️ No se pudo obtener el menú.');
        return message.reply("⚠️ No se pudo obtener el menú.");
    }

    console.log('📨 Enviando menú de bienvenida...');

    // Enviar mensaje de texto plano del menú
    message.reply(chatData.bienvenida + "\n\n" + chatData.menu);

    // Crear botones dinámicos
    const botones = chatData.botones.map(opcion => ({
        id: opcion.id,
        body: opcion.text
    }));

    const buttonMessage = new Buttons(
        'Selecciona una opción:',
        botones,
        'Menú Principal',
        'Elige una opción'
    );

    await client.sendMessage(message.from, buttonMessage);
}

// 🔹 Manejar la respuesta del usuario
async function handleMenuOptions(message) {
    const chatData = await getChatData();
    if (!chatData) {
        console.log('⚠️ No se pudo obtener las opciones del menú.');
        return message.reply("⚠️ No se pudo obtener las opciones del menú.");
    }

    const userOption = message.body.trim();

    if (chatData.respuestas[userOption]) {
        console.log(`✅ Respondiendo a la opción ${userOption}: ${chatData.respuestas[userOption]}`);
        message.reply(chatData.respuestas[userOption]);
    } else {
        console.log('⚠️ Opción inválida. Mostrando menú nuevamente...');
        message.reply(chatData.error);
        await sendWelcomeMenu(message);
    }
}

client.initialize();

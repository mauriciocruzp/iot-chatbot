import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
//import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'
import mqtt from 'mqtt'
import dotenv from 'dotenv'

dotenv.config()

const PORT = process.env.PORT ?? 8080

const DEVICE_TOPIC = '/petfeeder/esp32-001/command'

const mqttClient = mqtt.connect({
    host: process.env.MQTT_HOST,
    port: process.env.MQTT_PORT,
    protocol: 'mqtts',
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
})


mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker')
    /* mqttClient.subscribe('bot', (err) => {
        if (err) {
            return console.error('Failed to subscribe to topic "bot"', err)
        }
        console.log('Subscribed to topic "bot"')
    }) */
})

mqttClient.on('error', (err) => {
    console.error('MQTT connection error', err)
})

mqttClient.on('message', (topic, message) => {
    console.log(`Received message on topic ${topic}: ${message}`)
})

const discordFlow = addKeyword('doc').addAnswer(
    ['You can see the documentation here', '📄 https://builderbot.app/docs \n', 'Do you want to continue? *yes*'].join(
        '\n'
    ),
    { capture: true },
    async (ctx, { gotoFlow, flowDynamic }) => {
        if (ctx.body.toLocaleLowerCase().includes('yes')) {
            return gotoFlow(registerFlow)
        }
        await flowDynamic('Thanks!')
        return
    }
)

const welcomeFlow = addKeyword(['hi', 'hello', 'hola'])
    .addAnswer(`🙌 Hello welcome to this *Chatbot*`)
    .addAnswer(
        [
            'I share with you the following links of interest about the project',
            '👉 *doc* to view the documentation',
        ].join('\n'),
        { delay: 800, capture: true },
        async (ctx, { fallBack }) => {
            if (!ctx.body.toLocaleLowerCase().includes('doc')) {
                return fallBack('You should type *doc*')
            }
            return
        },
        [discordFlow]
    )

const dispenseFlow = addKeyword(['Dispensar', 'dispensar'])
    .addAction(async (_, { flowDynamic }) => {
        await flowDynamic('Dispensando...')
        mqttClient.publish(DEVICE_TOPIC, 'DISPENSE', async (err) => {
            if (err) {
                console.error(`Failed to publish message to topic "${DEVICE_TOPIC}"`, err)
            } else {
                console.log(`Message published to topic "${DEVICE_TOPIC}"`)
                await flowDynamic('Dispensado correctamente')
            }
        })
    })


const registerFlow = addKeyword(utils.setEvent('REGISTER_FLOW'))
    .addAnswer(`What is your name?`, { capture: true }, async (ctx, { state }) => {
        await state.update({ name: ctx.body })
    })
    .addAnswer('What is your age?', { capture: true }, async (ctx, { state }) => {
        await state.update({ age: ctx.body })
    })
    .addAction(async (_, { flowDynamic, state }) => {
        await flowDynamic(`${state.get('name')}, thanks for your information!: Your age: ${state.get('age')}`)
    })

const fullSamplesFlow = addKeyword(['samples', utils.setEvent('SAMPLES')])
    .addAnswer(`💪 I'll send you a lot files...`)
    .addAnswer(`Send image from Local`, { media: join(process.cwd(), 'assets', 'sample.png') })
    .addAnswer(`Send video from URL`, {
        media: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYTJ0ZGdjd2syeXAwMjQ4aWdkcW04OWlqcXI3Ynh1ODkwZ25zZWZ1dCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LCohAb657pSdHv0Q5h/giphy.mp4',
    })
    .addAnswer(`Send audio from URL`, { media: 'https://cdn.freesound.org/previews/728/728142_11861866-lq.mp3' })
    .addAnswer(`Send file from URL`, {
        media: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    })

const main = async () => {
    const adapterFlow = createFlow([welcomeFlow, registerFlow, fullSamplesFlow, dispenseFlow])

    const adapterProvider = createProvider(Provider, {
        version: [2, 3000, 1027934701],
        name: 'bot',
        sessionPath: './bot_sessions',
        headless: true,
        devtools: false,
        useChrome: true,
        debug: false,
        logQR: true,
        browserWS: '',
        browserArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        puppeteerOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser'
        },
        disableWelcome: true,
        updatesLog: false,
        autoClose: 0,
        createPathFileToken: false,
    })
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    adapterProvider.server.get(
        '/v1/blacklist/list',
        handleCtx(async (bot, req, res) => {
            const blacklist = bot.blacklist.getList()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', blacklist }))
        })
    )

    // Endpoint para servir el QR code
    adapterProvider.server.get('/v1/qr', (req, res) => {
        const qrPath = join(process.cwd(), 'bot.qr.png')
        if (existsSync(qrPath)) {
            const qrImage = readFileSync(qrPath)
            res.writeHead(200, { 'Content-Type': 'image/png' })
            return res.end(qrImage)
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        return res.end('QR code not found')
    })

    httpServer(+PORT)
}

main()

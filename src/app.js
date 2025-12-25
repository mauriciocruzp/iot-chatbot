import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'
import mqtt from 'mqtt'
import dotenv from 'dotenv'
import express from 'express'

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
})

mqttClient.on('error', (err) => {
    console.error('MQTT connection error', err)
})

const dispenseFlow = addKeyword(['Dispensar', 'dispensar'])
    .addAction(async (_, { flowDynamic }) => {
        await flowDynamic('Dispensando...')
        const payload = {
            "command": "DISPENSE"
        }
        mqttClient.publish(DEVICE_TOPIC, JSON.stringify(payload), async (err) => {
            if (err) {
                console.error(`Failed to publish message to topic "${DEVICE_TOPIC}"`, err)
            } else {
                console.log(`Message published to topic "${DEVICE_TOPIC}"`)
                await flowDynamic('Dispensado correctamente')
            }
        })
    })

const main = async () => {
    const adapterFlow = createFlow([dispenseFlow])

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

    httpServer(3008)

    const expressApp = express()
    expressApp.get('/', (req, res) => {
        const qrPath = join(process.cwd(), 'bot.qr.png')
        if (existsSync(qrPath)) {
            const qrImage = readFileSync(qrPath)
            res.setHeader('Content-Type', 'image/png')
            return res.send(qrImage)
        }
        res.status(404).send('QR code not found')
    })

    expressApp.listen(PORT, '0.0.0.0', () => {
        console.log(`Express server running on port ${PORT}`)
    })

}

main()

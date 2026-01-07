import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createBot, createProvider, createFlow, addKeyword } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'
import mqtt from 'mqtt'
import dotenv from 'dotenv'
import express from 'express'

dotenv.config()

const PORT = process.env.PORT ?? 8080
const TOKEN = process.env.TOKEN ?? 'abc123'

const DEVICE_TOPIC = '/petfeeder/esp32-001/command'

const DEVICE_STATUS_TOPIC = '/petfeeder/esp32-001/status'

const mqttClient = mqtt.connect({
    host: process.env.MQTT_HOST,
    port: process.env.MQTT_PORT,
    protocol: 'mqtts',
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
})

mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker')
    mqttClient.subscribe(DEVICE_STATUS_TOPIC, (err) => {
        if (err) {
            console.error(`Failed to subscribe to topic "${DEVICE_STATUS_TOPIC}"`, err)
        } else {
            console.log(`Subscribed to topic "${DEVICE_STATUS_TOPIC}"`)
        }
    })
})

mqttClient.on('error', (err) => {
    console.error('MQTT connection error', err)
})

let providerInstance = null
const userPhoneNumbers = new Set()

const dispenseFlow = addKeyword(['Dispensar', 'dispensar'])
    .addAction(async (ctx) => {
        const phoneNumber = ctx.from
        if (phoneNumber) {
            userPhoneNumbers.add(phoneNumber)
            console.log(`User phone number stored: ${phoneNumber}`)
        }

        const payload = {
            "action": "DISPENSE",
            "token": TOKEN
        }

        mqttClient.publish(DEVICE_TOPIC, JSON.stringify(payload), async (err) => {
            if (err) {
                console.error(`Failed to publish message to topic "${DEVICE_TOPIC}"`, err)
            } else {
                console.log(`Message published to topic "${DEVICE_TOPIC}"`)
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

    providerInstance = adapterProvider

    const adapterDB = new Database()

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    httpServer(3008)

    mqttClient.on('message', async (topic, message) => {
        if (topic === DEVICE_STATUS_TOPIC) {
            try {
                const status = JSON.parse(message)
                console.log(`Estado del dispositivo: ${status.status}`)

                const messageText = `Estado del dispositivo: ${status.status}`

                if (userPhoneNumbers.size > 0 && providerInstance && providerInstance.vendor) {
                    for (const phoneNumber of userPhoneNumbers) {
                        try {
                            await providerInstance.sendMessage(phoneNumber, messageText, {})
                            console.log(`Message sent to ${phoneNumber}`)
                        } catch (error) {
                            console.error(`Failed to send message to ${phoneNumber}:`, error)
                        }
                    }
                } else if (!providerInstance?.vendor) {
                    console.log('Provider vendor not ready yet, skipping message send')
                }
            } catch (error) {
                console.error('Error processing MQTT message:', error)
            }
        }
    })

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

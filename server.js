const http = require('http')
const fs   = require('fs')
const { WebSocketServer } = require('ws')

const html = fs.readFileSync(__dirname + '/index.html')

// ── HTTP: serve index.html for every request ──────────────────────────────
const server = http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})

// ── WebSocket relay ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server })

let broadcaster = null   // the casting client
let mimeType    = null   // codec string sent by broadcaster
let initChunk   = null   // first binary chunk (contains codec init data)
const viewers   = new Set()

wss.on('connection', ws => {
  ws.on('error', () => ws.terminate())

  ws.on('message', (data, isBinary) => {
    // ── Binary: video chunk from broadcaster → relay to all viewers ────
    if (isBinary) {
      if (!initChunk) initChunk = Buffer.from(data) // cache for late joiners
      viewers.forEach(v => v.readyState === 1 && v.send(data, { binary: true }))
      return
    }

    // ── Text: control messages ─────────────────────────────────────────
    const msg = JSON.parse(data)

    switch (msg.type) {
      case 'start':
        broadcaster   = ws
        ws.isCaster   = true
        mimeType      = msg.mimeType
        initChunk     = null
        // notify viewers that were already waiting
        viewers.forEach(v => v.readyState === 1 &&
          v.send(JSON.stringify({ type: 'live', mimeType })))
        console.log(`[cast]  started  codec=${mimeType}`)
        break

      case 'watch':
        viewers.add(ws)
        if (mimeType) {
          // send codec info + init segment so late joiners can start decoding
          ws.send(JSON.stringify({ type: 'live', mimeType }))
          if (initChunk) ws.send(initChunk, { binary: true })
        } else {
          ws.send(JSON.stringify({ type: 'waiting' }))
        }
        console.log(`[view]  joined   viewers=${viewers.size}`)
        break
    }
  })

  ws.on('close', () => {
    if (ws.isCaster) {
      broadcaster = mimeType = initChunk = null
      viewers.forEach(v => v.readyState === 1 &&
        v.send(JSON.stringify({ type: 'ended' })))
      console.log('[cast]  stopped')
    } else {
      viewers.delete(ws)
      console.log(`[view]  left     viewers=${viewers.size}`)
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`\n  Screencast  →  http://localhost:${PORT}`)
  console.log(`  Share link  →  http://localhost:${PORT}?watch\n`)
})

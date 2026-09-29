import type { Express, NextFunction, Request, Response } from 'express'
import { parseSymbols } from '../lib/utils.js'
import { IBKR_CONFIG } from './config.js'
import { AGENT_CONFIG } from '../agent/config.js'
import { getAgentSnapshot, runAgentCycle, startAgent, stopAgent } from '../agent/loop.js'
import { sendDailySessionReport } from '../agent/report.js'
import { nyCalendarDate } from '../agent/marketHours.js'
import { cancelOrder, connectBroker, getAccountSnapshot, getBrokerStatus, getOpenOrders, getPositions } from './ibkr.js'
import { BrokerRequestError, confirmProposal, createProposal, getOrderLimits } from './service.js'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * The API has open CORS for the public screener, so any website could otherwise make the
 * user's browser POST to localhost and place orders. Only same-machine, local-origin calls pass.
 */
function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '') || !isLocalOrigin(req.get('origin'))) {
    res.status(403).json({ error: 'El broker solo acepta pedidos desde esta máquina.' })
    return
  }
  next()
}

function sendError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Error inesperado con IB.'
  res.status(error instanceof BrokerRequestError ? 400 : 502).json({ error: message })
}

export function registerBrokerRoutes(app: Express): void {
  if (!IBKR_CONFIG.enabled) {
    app.get('/api/broker/status', (_req, res) => {
      res.json({ enabled: false })
    })
    app.get('/api/agent/status', (_req, res) => {
      res.json({ enabled: false, running: false, paperOnly: true })
    })
    return
  }

  connectBroker()
  app.use('/api/broker', localOnly)

  app.get('/api/broker/status', async (_req, res) => {
    try {
      res.json({ enabled: true, ...(await getBrokerStatus()), limits: getOrderLimits() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/broker/positions', async (_req, res) => {
    try {
      res.json({ data: await getPositions() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/broker/orders', async (_req, res) => {
    try {
      res.json({ data: await getOpenOrders() })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/broker/proposals', async (req, res) => {
    const symbol = parseSymbols(String(req.body?.symbol ?? ''))[0]
    if (!symbol) {
      res.status(400).json({ error: 'Indicá un símbolo válido.' })
      return
    }
    try {
      res.json(await createProposal(symbol, Number(req.body?.budgetUsd)))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/broker/proposals/:id/confirm', async (req, res) => {
    try {
      res.json(await confirmProposal(String(req.params.id)))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.delete('/api/broker/orders/:id', async (req, res) => {
    const orderId = Number(req.params.id)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'Order id inválido.' })
      return
    }
    try {
      await cancelOrder(orderId)
      res.json({ ok: true })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.use('/api/agent', localOnly)

  app.get('/api/agent/status', async (_req, res) => {
    try {
      const broker = await getBrokerStatus()
      res.json({ ...(await getAgentSnapshot(broker)), enabled: AGENT_CONFIG.enabled && IBKR_CONFIG.enabled })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/agent/start', async (_req, res) => {
    try {
      const started = startAgent()
      if ('error' in started) {
        res.status(400).json(started)
        return
      }
      await runAgentCycle({ ignoreHours: true })
      const broker = await getBrokerStatus()
      res.json(await getAgentSnapshot(broker))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/agent/stop', async (_req, res) => {
    try {
      stopAgent()
      const broker = await getBrokerStatus()
      res.json(await getAgentSnapshot(broker))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/agent/run', async (_req, res) => {
    try {
      if (!AGENT_CONFIG.enabled) {
        res.status(400).json({ error: 'El agente está apagado. Poné AGENT_ENABLED=true en el .env local.' })
        return
      }
      await runAgentCycle({ ignoreHours: true })
      const broker = await getBrokerStatus()
      res.json(await getAgentSnapshot(broker))
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/agent/report', async (_req, res) => {
    try {
      const snapshot = await getAccountSnapshot()
      const mailed = await sendDailySessionReport(nyCalendarDate(), snapshot, { force: true })
      const broker = await getBrokerStatus()
      res.json({ ...mailed, ...(await getAgentSnapshot(broker)) })
    } catch (error) {
      sendError(res, error)
    }
  })
}

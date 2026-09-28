import type { Express, NextFunction, Request, Response } from 'express'
import { parseSymbols } from '../lib/utils.js'
import { IBKR_CONFIG } from './config.js'
import { cancelOrder, connectBroker, getBrokerStatus, getOpenOrders, getPositions } from './ibkr.js'
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
}

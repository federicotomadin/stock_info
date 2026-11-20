export type BrokerOrderId = number | string

export interface BrokerStatus {
  connected: boolean
  account: string | null
  paper: boolean
  tradingAllowed: boolean
  reason: string | null
  provider?: 'ibkr' | 'alpaca'
  recentErrors: Array<{
    at: string
    reqId: number | null
    code: number
    message: string
    informational: boolean
  }>
}

export interface AccountSnapshot {
  account: string
  netLiquidation: number | null
  cash: number | null
}

export interface ExecutionFill {
  execId: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  time: string
  sessionDate: string
}

export interface OpenOrderRow {
  orderId: BrokerOrderId
  parentId: BrokerOrderId | null
  symbol: string
  action: string
  orderType: string
  quantity: number
  limitPrice: number | null
  stopPrice: number | null
  status: string | null
}
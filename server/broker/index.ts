import { BROKER_PROVIDER } from './config.js'
import * as alpaca from './alpaca.js'
import * as ibkr from './ibkr.js'

const impl = BROKER_PROVIDER === 'alpaca' ? alpaca : ibkr

export type { AccountSnapshot, BrokerOrderId, BrokerStatus, ExecutionFill, OpenOrderRow } from './types.js'

export const connectBroker = impl.connectBroker
export const getBrokerStatus = impl.getBrokerStatus
export const getAccountSnapshot = impl.getAccountSnapshot
export const getPositions = impl.getPositions
export const getOpenOrders = impl.getOpenOrders
export const getExecutionsSince = impl.getExecutionsSince
export const placeBracketOrder = impl.placeBracketOrder
export const modifyStopOrder = impl.modifyStopOrder
export const placeProtectiveStop = impl.placeProtectiveStop
export const placeMarketSell = impl.placeMarketSell
export const cancelOrder = impl.cancelOrder
export { toTickerSymbol } from './symbols.js'
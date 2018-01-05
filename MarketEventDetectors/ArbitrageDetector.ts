declare const CONFIG;

import { EventEmitter } from "events";
import IBroker, { OPEN_ORDER_EVENTS } from "../Brokers/IBroker";
import IOrderEventEmitter from "../MarketDataEventEmitters/IOrderEventEmitter";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import Order, { OrderSide } from "../Models/Order";
import Tick from "../Models/Tick";
import TriangularArbitrage from "../Models/TriangularArbitrage";
import OpenOrdersStatusDetector, { UPDATE_ORDER_STATUS_EVENTS } from "./OpenOrdersStatusDetector";

type TickListener = (tick: Tick) => void;
type OrderListener = (order: Order) => void;

/**
 * - Subscribe to order books
 * - Subscribe to ticks
 *
 * on tick:
 *  - check gap with other pairs using ticks
 *  - recheck using order book
 *  - define quantity and rates
 *  - lock
 *  - trade
 *  - unlock
 */
export default class ArbitrageDetector extends EventEmitter {

    public static readonly ARBITRAGE_OPPORTUNITY_EVENT: string = "ARBITRAGE_OPPORTUNITY_EVENT";
    public readonly currentlyAnalysedMarket: Map<string, boolean> = new Map();

    constructor(private broker: IBroker,
                private filledOrdersEmitter: OpenOrdersStatusDetector,
                private ticksEmitter: ITickEventEmitter) {
        super();
        this.startDetection();
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.logEvents();
        }
    }

    /**
     * on tick:
     *  - check gap with other pairs using ticks
     *  - recheck using order book
     *  - define quantity and rates
     *  - lock
     *  - trade
     *  - unlock
     */
    private startDetection(): void {

        this.ticksEmitter.on("TICK", async (tick: Tick) => {

            if (this.currentlyAnalysedMarket.has(tick.marketCurrency)) {
                return;
            }
            // lock analysis
            this.currentlyAnalysedMarket.set(tick.marketCurrency, true);

            switch (CONFIG.PIVOT_MARKET) {
                case "BTC-ETH":
                    this.detect_BTC_ETH_Arbitrage(tick.marketCurrency);
                    this.detect_ETH_BTC_Arbitrage(tick.marketCurrency);
                case "BTC-USDT":
                    this.detect_BTC_USDT_Arbitrage(tick.marketCurrency);
                    this.detect_USDT_BTC_Arbitrage(tick.marketCurrency);
                case "USDT-ETH":
                    this.detect_USDT_ETH_Arbitrage(tick.marketCurrency);
                    this.detect_ETH_USDT_Arbitrage(tick.marketCurrency);
            }
            // unlock analysis
            this.currentlyAnalysedMarket.delete(tick.marketCurrency);
        });
    }

    /**
     * BTC -> ETH -> BTC
     * BUY X WITH BTC -> SELL X FOR ETH -> SELL ETH FOR BTC
     */
    private async detect_BTC_ETH_Arbitrage(coin) {

        let BTC_X_TICKER: Tick;
        let ETH_X_TICKER: Tick;
        let BTC_ETH_TICKER: Tick;

        // If one request throws an error, skip the coin and move on
        [BTC_X_TICKER, ETH_X_TICKER, BTC_ETH_TICKER] = await Promise.all([`BTC-${coin}`, `ETH-${coin}`, `BTC-ETH`]
                                                        .map((marketName) => this.getTickerPromise(marketName)));

        const BTC_X_BID = BTC_X_TICKER.bid;
        const BTC_X_ASK = BTC_X_TICKER.ask;

        const ETH_X_BID = ETH_X_TICKER.bid;
        const ETH_X_ASK = ETH_X_TICKER.ask;

        const BTC_ETH_BID = BTC_ETH_TICKER.bid;
        const BTC_ETH_ASK = BTC_ETH_TICKER.ask;

        // FORMULA:  COIN1 -> COIN2 -> COIN1
        // if can buy X for COIN1, sell X for COIN2 and get more COIN1 when CONVERTING COIN2 
        // if COIN2 BID converted to COIN1 > value in COIN1 ASK
        // BUY X IN COIN1 -> SELL X IN COIN2 -> BUY/SELL COIN2 IN COIN1         
        // 1 UNIT BUY IN COIN1 < 1 UNIT

        /**
         * BTC -> ETH -> BTC
         * BUY X WITH BTC -> SELL X FOR ETH -> SELL ETH FOR BTC
         */
        if ((ETH_X_BID * BTC_ETH_BID) > BTC_X_ASK) {

            const grossPercentageWin = ( ( ( ETH_X_BID * BTC_ETH_BID ) - BTC_X_ASK )  / BTC_X_ASK ) * 100;
            if (grossPercentageWin < CONFIG.MIN_PROFIT_PERCENTAGE) {
                return;
            }

            // TODO: CONTINUE HERE
            // Calculate quantity to buy
            const qtyToBuyInCOIN = CONFIG.MIN_QTY_TO_TRADE["BTC-"+coin];
            const qtyToBuyInBTC = qtyToBuyInCOIN * BTC_X_ASK;

            // Generate quotes

            const opportunity = {
                id: Date.now(), 
                baseCoin: "BTC",
                coin: coin,
                pairToBuy: `BTC-${coin}`,
                pairToSell: `ETH-${coin}`,
                pairToConvert: `BTC-ETH`,
                convertOrderType: `SELL`,
                rateToBuy: BTC_X_ASK,
                qtyToBuy: qtyToBuyInCOIN,
                qtyToBuyInBasecoin: qtyToBuyInBTC,
                potentialGrossPercentageWin: grossPercentageWin,
                potentialNetPercentageWin: netPercentageWin,
                potentialGrossBasecoinWin: grossBTCWin,
                potentialNetBasecoinWin: netBTCWin
            }

            return opportunity;
        }

    }

    private getTickerPromise(marketName: string): Promise<Tick> {
        return new Promise((resolve, reject) => {
            this.ticksEmitter.once(marketName, (tick: Tick) => {
                resolve(tick);
            });
        });
    }

    private logEvents(): void {
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.on(ArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, (order: Order) => {
                console.log(`\n--- OUTASKED ORDER --- \nOrderID: ${order.id}\n` +
                                `Quantity:${order.quantity} @ Rate:${order.rate}\n`);
            });
        }
    }

}

import * as CONFIG from "./../Config/CONFIG";

import { EventEmitter } from "events";
import IBroker, { OPEN_ORDER_EVENTS } from "../Brokers/IBroker";
import IOrderBookEventEmitter from "../MarketDataEventEmitters/IOrderBookEventEmitter";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import Order, { OrderSide, OrderTimeEffect, OrderType } from "../Models/Order";
import OrderBook from "../Models/OrderBook";
import Quote from "../Models/Quote";
import Tick from "../Models/Tick";

import TriangularArbitrage from "../Models/TriangularArbitrage";

import OpenOrdersStatusDetector, { UPDATE_ORDER_STATUS_EVENTS } from "./OpenOrdersStatusDetector";

import IAccountManager from "../Services/IAccountManager";

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
export default class TriangularArbitrageDetectorTick extends EventEmitter {

    public static readonly ARBITRAGE_OPPORTUNITY_EVENT: string = "ARBITRAGE_OPPORTUNITY_EVENT";
    public readonly currentlyAnalysedMarket: Map<string, boolean> = new Map();

    constructor(private broker: IBroker,
                private accountManager: IAccountManager,
                private filledOrdersEmitter: OpenOrdersStatusDetector,
                private ticksEmitter: ITickEventEmitter,
                private orderBookEmitter: IOrderBookEventEmitter) {
        super();
        // this.startDetection();
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.logEvents();
        }
    }

    public async detect(currency: string, pivotMarket: string): Promise<void> {

            // if (this.currentlyAnalysedMarket.has(currency)) {
            //     return;
            // }
            // // lock analysis
            // this.currentlyAnalysedMarket.set(currency, true);
            let balances: Map<string, number>;

            // try {
            //     balances = await this.accountManager.getBalances();
            // } catch (ex) {
            //     // unlock analysis
            //     this.currentlyAnalysedMarket.delete(currency);
            //     return;
            // }

            switch (pivotMarket) {
                case "BTC-ETH":
                    await this.detect_BTC_ETH_Arbitrage(currency, balances);
                    break;
                case "USDT-BTC":
                    await this.detect_USDT_BTC_Arbitrage(currency, balances);
                    break;
                case "USDT-ETH":
                    await this.detect_USDT_ETH_Arbitrage(currency, balances);
                    break;
            }
            // // unlock analysis
            // this.currentlyAnalysedMarket.delete(currency);
    }

    /**
     * BTC -> ETH -> BTC
     * BUY X WITH BTC -> SELL X FOR ETH -> SELL ETH FOR BTC
     * OR
     * ETH -> BTC -> ETH
     * BUY X WITH ETH -> SELL X FOR BTC -> BUY ETH WITH BTC
     */
    private async detect_BTC_ETH_Arbitrage(coin: string, balances: Map<string, number>): Promise<void> {

        let BTC_X_TICK: Tick;
        let ETH_X_TICK: Tick;
        let BTC_ETH_TICK: Tick;

        try {
            // If one request throws an error, skip the coin and move on
            [BTC_X_TICK, ETH_X_TICK, BTC_ETH_TICK] =
            await Promise.all([`BTC-${coin}`, `ETH-${coin}`, `BTC-ETH`]
                            .map((marketName) => this.getTicker(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [BTC-ETH]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        const BTC_X_BID = BTC_X_TICK.bid;
        const BTC_X_ASK = BTC_X_TICK.ask;

        const ETH_X_BID = ETH_X_TICK.bid;
        const ETH_X_ASK = ETH_X_TICK.ask;

        const BTC_ETH_BID = BTC_ETH_TICK.bid;
        const BTC_ETH_ASK = BTC_ETH_TICK.ask;

        // FORMULA:  COIN1 -> COIN2 -> COIN1
        // if can buy X for COIN1, sell X for COIN2 and get more COIN1 when CONVERTING COIN2
        // if COIN2 BID converted to COIN1 > value in COIN1 ASK
        // BUY X IN COIN1 -> SELL X IN COIN2 -> BUY/SELL COIN2 IN COIN1
        // 1 UNIT BUY IN COIN1 < 1 UNIT

        /**
         * BTC -> ETH -> BTC
         * BUY X WITH BTC -> SELL X FOR ETH -> SELL ETH FOR BTC
         */
        const btcTrianglePercentageProfit = ( (ETH_X_BID / BTC_X_ASK) * BTC_ETH_BID - 1 ) * 100;
        const ethTrianglePercentageProfit = ( (BTC_X_BID / ETH_X_ASK) / BTC_ETH_ASK - 1 ) * 100;
        // console.log(`BTC Triangle: ${btcTrianglePercentageProfit}%`);
        // console.log(`ETH Triangle: ${ethTrianglePercentageProfit}%`);
        if (btcTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {

            // Test
            // console.log(`[BTC-${coin}] \n` +
            // `Bid: ${JSON.stringify(BTC_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_X_ORDERBOOK.asks[0])}`);
            // console.log(`[ETH-${coin}] \n` +
            // `Bid: ${JSON.stringify(ETH_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(ETH_X_ORDERBOOK.asks[0])}`);
            // console.log(`[BTC-ETH] \n` +
            // `Bid: ${JSON.stringify(BTC_ETH_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_ETH_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const ethQtyToSell: number = (qtyToSell * ETH_X_BID);

            // Generate quotes
            const buyQuote = new Quote(`BTC-${coin}`, BTC_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`ETH-${coin}`, ETH_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`BTC-ETH`, BTC_ETH_BID, ethQtyToSell, OrderSide.SELL,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "BTC-ETH", btcTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

        }

        if (ethTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {
           /**
            * ETH -> BTC -> ETH
            * BUY X WITH ETH -> SELL X FOR BTC -> BUY ETH WITH BTC
            */

            // Test
            // console.log(`[BTC-${coin}] \n` +
            // `Bid: ${JSON.stringify(BTC_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_X_ORDERBOOK.asks[0])}`);
            // console.log(`[ETH-${coin}] \n` +
            // `Bid: ${JSON.stringify(ETH_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(ETH_X_ORDERBOOK.asks[0])}`);
            // console.log(`[BTC-ETH] \n` +
            // `Bid: ${JSON.stringify(BTC_ETH_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_ETH_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const ethQtyToBuy: number = (qtyToSell * BTC_X_BID) / BTC_ETH_ASK;

            // Generate quotes
            const buyQuote = new Quote(`ETH-${coin}`, ETH_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`BTC-${coin}`, BTC_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`BTC-ETH`, BTC_ETH_BID, ethQtyToBuy, OrderSide.BUY,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "BTC-ETH", ethTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
       }

    }

    /**
     * BTC -> USDT -> BTC
     * BUY X WITH BTC -> SELL X FOR USDT -> BUY BTC WITH USDT
     * OR
     * USDT -> BTC -> USDT
     * BUY X WITH USDT -> SELL X FOR BTC -> SELL BTC FOR USDT
     */
    private async detect_USDT_BTC_Arbitrage(coin: string, balances: Map<string, number>): Promise<void> {

        let BTC_X_TICK: Tick;
        let USDT_X_TICK: Tick;
        let USDT_BTC_TICK: Tick;

        try {
            // If one request throws an error, skip the coin and move on
            [BTC_X_TICK, USDT_X_TICK, USDT_BTC_TICK] =
            await Promise.all([`BTC-${coin}`, `USDT-${coin}`, `USDT-BTC`]
                            .map((marketName) => this.getTicker(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [BTC-USDT]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        const BTC_X_BID = BTC_X_TICK.bid;
        const BTC_X_ASK = BTC_X_TICK.ask;

        const USDT_X_BID = USDT_X_TICK.bid;
        const USDT_X_ASK = USDT_X_TICK.ask;

        const USDT_BTC_BID = USDT_BTC_TICK.bid;
        const USDT_BTC_ASK = USDT_BTC_TICK.ask;

        // FORMULA:  COIN1 -> COIN2 -> COIN1
        // if can buy X for COIN1, sell X for COIN2 and get more COIN1 when CONVERTING COIN2
        // if COIN2 BID converted to COIN1 > value in COIN1 ASK
        // BUY X IN COIN1 -> SELL X IN COIN2 -> BUY/SELL COIN2 IN COIN1
        // 1 UNIT BUY IN COIN1 < 1 UNIT

        /**
         * BTC -> USDT -> BTC
         * BUY X WITH BTC -> SELL X FOR USDT -> BUY BTC WITH USDT
         */
        const btcTrianglePercentageProfit = ( (USDT_X_BID / BTC_X_ASK) / USDT_BTC_ASK - 1 ) * 100;
        const usdtTrianglePercentageProfit = ( (BTC_X_BID / USDT_X_ASK) * USDT_BTC_BID - 1 ) * 100;
        // console.log(`BTC Triangle: ${btcTrianglePercentageProfit}%`);
        // console.log(`ETH Triangle: ${usdtTrianglePercentageProfit}%`);
        if (btcTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {

            // Test
            // console.log(`[BTC-${coin}] \n` +
            // `Bid: ${JSON.stringify(BTC_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-${coin}] \n` +
            // `Bid: ${JSON.stringify(USDT_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-BTC] \n` +
            // `Bid: ${JSON.stringify(USDT_BTC_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_BTC_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const btcQtyToBuy: number = (qtyToSell * USDT_X_BID) / USDT_BTC_ASK;

            // const btcQtyNeeded = qtyToBuy * BTC_X_ASK;
            // const xQtyNeeded = qtyToBuy;
            // const ethQtyNeeded = ethQtyToConvert;

            // if (btcQtyNeeded <= balances.get("BTC") ||
            //     ethQtyNeeded <= balances.get("ETH") ||
            //     xQtyNeeded <= balances.get(coin)) {
            //         console.log("INSUFICIENT BALANCES TO EXECUTE TRIANGULAR ARBITRAGE");
            //         return;
            // }

            // Generate quotes
            const buyQuote = new Quote(`BTC-${coin}`, BTC_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`USDT-${coin}`, USDT_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`USDT-BTC`, USDT_BTC_BID, btcQtyToBuy, OrderSide.BUY,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "USDT-BTC", btcTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

        }

        if (usdtTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {
           /**
            * USDT -> BTC -> USDT
            * BUY X WITH USDT -> SELL X FOR BTC -> SELL BTC FOR USDT
            */

            // Test
            // console.log(`[BTC-${coin}] \n` +
            // `Bid: ${JSON.stringify(BTC_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(BTC_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-${coin}] \n` +
            // `Bid: ${JSON.stringify(USDT_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-BTC] \n` +
            // `Bid: ${JSON.stringify(USDT_BTC_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_BTC_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const btcQuantityToSell: number = qtyToSell * BTC_X_BID;

            // const btcQtyNeeded = btcQtyToConvert;
            // const xQtyNeeded = qtyToBuy;
            // const ethQtyNeeded = qtyToBuy * USDT_X_ASK;

            // if (btcQtyNeeded <= balances.get("BTC") ||
            //     ethQtyNeeded <= balances.get("ETH") ||
            //     xQtyNeeded <= balances.get(coin)) {
            //         console.log("INSUFICIENT BALANCES TO EXECUTE TRIANGULAR ARBITRAGE");
            //         return;
            // }

            // Generate quotes
            const buyQuote = new Quote(`USDT-${coin}`, USDT_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`BTC-${coin}`, BTC_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`USDT-BTC`, USDT_BTC_BID, btcQuantityToSell, OrderSide.SELL,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "USDT-BTC", usdtTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
       }

    }

    /**
     * ETH -> USDT -> ETH
     * BUY X WITH ETH -> SELL X FOR USDT -> BUY ETH WITH USDT
     * OR
     * USDT -> ETH -> USDT
     * BUY X WITH USDT -> SELL X FOR ETH -> SELL ETH FOR USDT
     */
    private async detect_USDT_ETH_Arbitrage(coin: string, balances: Map<string, number>): Promise<void> {

        let USDT_X_TICK: Tick;
        let ETH_X_TICK: Tick;
        let USDT_ETH_TICK: Tick;

        try {
            // If one request throws an error, skip the coin and move on
            [USDT_X_TICK, ETH_X_TICK, USDT_ETH_TICK] =
            await Promise.all([`USDT-${coin}`, `ETH-${coin}`, `USDT-ETH`]
                            .map((marketName) => this.getTicker(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [BTC-USDT]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        const USDT_X_BID = USDT_X_TICK.bid;
        const USDT_X_ASK = USDT_X_TICK.ask;

        const ETH_X_BID = ETH_X_TICK.bid;
        const ETH_X_ASK = ETH_X_TICK.ask;

        const USDT_ETH_BID = USDT_ETH_TICK.bid;
        const USDT_ETH_ASK = USDT_ETH_TICK.ask;

        // FORMULA:  COIN1 -> COIN2 -> COIN1
        // if can buy X for COIN1, sell X for COIN2 and get more COIN1 when CONVERTING COIN2
        // if COIN2 BID converted to COIN1 > value in COIN1 ASK
        // BUY X IN COIN1 -> SELL X IN COIN2 -> BUY/SELL COIN2 IN COIN1
        // 1 UNIT BUY IN COIN1 < 1 UNIT

        /**
         * ETH -> USDT -> ETH
         * BUY X WITH ETH -> SELL X FOR USDT -> BUY ETH WITH USDT
         */
        const ethTrianglePercentageProfit = ( (USDT_X_BID / ETH_X_ASK) / USDT_ETH_ASK - 1 ) * 100;
        const usdtTrianglePercentageProfit = ( (ETH_X_BID / USDT_X_ASK) * USDT_ETH_BID - 1 ) * 100;
        // console.log(`BTC Triangle: ${btcTrianglePercentageProfit}%`);
        // console.log(`ETH Triangle: ${usdtTrianglePercentageProfit}%`);
        if (ethTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {

            // Test
            // console.log(`[ETH-${coin}] \n` +
            // `Bid: ${JSON.stringify(ETH_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(ETH_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-${coin}] \n` +
            // `Bid: ${JSON.stringify(USDT_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-ETH] \n` +
            // `Bid: ${JSON.stringify(USDT_ETH_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_ETH_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const ethQtyToBuy: number = (qtyToSell * USDT_X_BID) / USDT_ETH_ASK;

            // const btcQtyNeeded = qtyToBuy * ETH_X_ASK;
            // const xQtyNeeded = qtyToBuy;
            // const ethQtyNeeded = ethQtyToConvert;

            // if (btcQtyNeeded <= balances.get("BTC") ||
            //     ethQtyNeeded <= balances.get("ETH") ||
            //     xQtyNeeded <= balances.get(coin)) {
            //         console.log("INSUFICIENT BALANCES TO EXECUTE TRIANGULAR ARBITRAGE");
            //         return;
            // }

            // Generate quotes
            const buyQuote = new Quote(`ETH-${coin}`, ETH_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`USDT-${coin}`, USDT_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`USDT-ETH`, USDT_ETH_BID, ethQtyToBuy, OrderSide.BUY,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "USDT-ETH", ethTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

        }

        if (usdtTrianglePercentageProfit > CONFIG.BITTREX.MIN_PROFIT_PERCENTAGE) {
           /**
            * USDT -> BTC -> USDT
            * BUY X WITH USDT -> SELL X FOR BTC -> SELL BTC FOR USDT
            */

            // Test
            // console.log(`[ETH-${coin}] \n` +
            // `Bid: ${JSON.stringify(ETH_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(ETH_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-${coin}] \n` +
            // `Bid: ${JSON.stringify(USDT_X_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_X_ORDERBOOK.asks[0])}`);
            // console.log(`[USDT-ETH] \n` +
            // `Bid: ${JSON.stringify(USDT_ETH_ORDERBOOK.bids[0])} \n` +
            // `Ask: ${JSON.stringify(USDT_ETH_ORDERBOOK.asks[0])}`);

            const qtyToBuy: number = CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK;
            const qtyToSell: number = qtyToBuy;
            const ethQuantityToSell: number = qtyToSell * ETH_X_BID;

            // const btcQtyNeeded = btcQtyToConvert;
            // const xQtyNeeded = qtyToBuy;
            // const ethQtyNeeded = qtyToBuy * USDT_X_ASK;

            // if (btcQtyNeeded <= balances.get("BTC") ||
            //     ethQtyNeeded <= balances.get("ETH") ||
            //     xQtyNeeded <= balances.get(coin)) {
            //         console.log("INSUFICIENT BALANCES TO EXECUTE TRIANGULAR ARBITRAGE");
            //         return;
            // }

            // Generate quotes
            const buyQuote = new Quote(`USDT-${coin}`, USDT_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`ETH-${coin}`, ETH_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`USDT-ETH`, USDT_ETH_BID, ethQuantityToSell, OrderSide.SELL,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "USDT-BTC", usdtTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote);

            this.emit(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
       }

    }

    private getTicker(marketName: string): Promise<Tick> {
        return this.ticksEmitter.getTicker(marketName);
    }

    private getOrderBook(marketName: string): Promise<OrderBook> {
        return this.orderBookEmitter.getOrderBook(marketName);
    }

    private logEvents(): void {
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            // this.on(TriangularArbitrageDetectorTick.ARBITRAGE_OPPORTUNITY_EVENT,
            //         (triangularArbitrage: TriangularArbitrage) => {
            //         console.log(`\n--- TRIANGULAR ARBITRAGE [${triangularArbitrage.buyQuote.marketName}] -> ` +
            //                                                 `[${triangularArbitrage.sellQuote.marketName}] -> ` +
            //                                                 `[${triangularArbitrage.convertQuote.marketName}] ---  \n` +
            //                     `GAP: ${triangularArbitrage.gapPercentage}% \nMAX QTY: ${triangularArbitrage.maxQtyToArbitrage} \n` +
            //                     `TRADE QTY: ${triangularArbitrage.buyQuote.quantity * triangularArbitrage.buyQuote.rate} \n`);
            //         // TEST
            //         // console.log(triangularArbitrage.buyQuote);
            //         // console.log(triangularArbitrage.sellQuote);
            //         // console.log(triangularArbitrage.convertQuote);
            // });
        }
    }

}

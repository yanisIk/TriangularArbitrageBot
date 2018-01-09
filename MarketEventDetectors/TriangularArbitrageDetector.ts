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
export default class TriangularArbitrageDetector extends EventEmitter {

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

        let BTC_X_ORDERBOOK: OrderBook;
        let ETH_X_ORDERBOOK: OrderBook;
        let BTC_ETH_ORDERBOOK: OrderBook;

        try {
            // If one request throws an error, skip the coin and move on
            [BTC_X_ORDERBOOK, ETH_X_ORDERBOOK, BTC_ETH_ORDERBOOK] =
            await Promise.all([`BTC-${coin}`, `ETH-${coin}`, `BTC-ETH`]
                            .map((marketName) => this.getOrderBook(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [BTC-ETH]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        if (!BTC_X_ORDERBOOK.bids || !BTC_X_ORDERBOOK.asks ||
            !ETH_X_ORDERBOOK.bids || !ETH_X_ORDERBOOK.asks ||
            !BTC_ETH_ORDERBOOK.bids || !BTC_ETH_ORDERBOOK.asks) {
                // console.error("!!! CORRUPTED ORDERBOOK 1!!!");
                return;
        }

        if (!BTC_X_ORDERBOOK.bids[0] || !BTC_X_ORDERBOOK.asks[0] ||
            !ETH_X_ORDERBOOK.bids[0] || !ETH_X_ORDERBOOK.asks[0] ||
            !BTC_ETH_ORDERBOOK.bids[0] || !BTC_ETH_ORDERBOOK.asks[0]) {
                // console.error("!!! CORRUPTED ORDERBOOK 2!!!");
                return;
        }

        let BTC_X_BID = BTC_X_ORDERBOOK.bids[0].Rate;
        let BTC_X_ASK = BTC_X_ORDERBOOK.asks[0].Rate;
        let BTC_X_ASK_QTY = BTC_X_ORDERBOOK.asks[0].Quantity;
        let BTC_X_BID_QTY = BTC_X_ORDERBOOK.bids[0].Quantity;

        let ETH_X_BID = ETH_X_ORDERBOOK.bids[0].Rate;
        let ETH_X_ASK = ETH_X_ORDERBOOK.asks[0].Rate;
        let ETH_X_BID_QTY = ETH_X_ORDERBOOK.bids[0].Quantity;
        let ETH_X_ASK_QTY = ETH_X_ORDERBOOK.asks[0].Quantity;

        let BTC_ETH_BID = BTC_ETH_ORDERBOOK.bids[0].Rate;
        let BTC_ETH_ASK = BTC_ETH_ORDERBOOK.asks[0].Rate;
        let BTC_ETH_BID_QTY = BTC_ETH_ORDERBOOK.bids[0].Quantity;
        let BTC_ETH_ASK_QTY = BTC_ETH_ORDERBOOK.asks[0].Quantity;

        // Check quantities and reset bid or ask to the one with 'legit' quantity
        if ((BTC_X_ASK_QTY * BTC_X_ASK) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK) {
            BTC_X_ASK = BTC_X_ORDERBOOK.asks[1].Rate;
            BTC_X_ASK_QTY = BTC_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((BTC_X_BID_QTY * BTC_X_BID) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_BID) {
            BTC_X_BID = BTC_X_ORDERBOOK.bids[1].Rate;
            BTC_X_BID_QTY = BTC_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((ETH_X_ASK_QTY * ETH_X_ASK) < CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_ASK) {
            ETH_X_ASK = ETH_X_ORDERBOOK.asks[1].Rate;
            ETH_X_ASK_QTY = ETH_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((ETH_X_BID_QTY * ETH_X_BID) < CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_BID) {
            ETH_X_BID = ETH_X_ORDERBOOK.bids[1].Rate;
            ETH_X_BID_QTY = ETH_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((BTC_ETH_ASK_QTY * BTC_ETH_ASK) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_ETH_ASK) {
            BTC_ETH_ASK = BTC_ETH_ORDERBOOK.asks[1].Rate;
            BTC_ETH_ASK_QTY = BTC_ETH_ORDERBOOK.asks[1].Quantity;
        }
        if ((BTC_ETH_BID_QTY * BTC_ETH_BID) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_ETH_BID) {
            BTC_ETH_BID = BTC_ETH_ORDERBOOK.bids[1].Rate;
            BTC_ETH_BID_QTY = BTC_ETH_ORDERBOOK.bids[1].Quantity;
        }

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = BTC_X_ASK_QTY < ETH_X_BID_QTY ? BTC_X_ASK_QTY : ETH_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = BTC_ETH_BID_QTY / BTC_X_BID;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_BTC_QUANTITY / BTC_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
            const qtyToSell: number = qtyToBuy;
            const ethQtyToSell: number = (qtyToSell * ETH_X_BID);

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
            const sellQuote = new Quote(`ETH-${coin}`, ETH_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`BTC-ETH`, BTC_ETH_BID, ethQtyToSell, OrderSide.SELL,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "BTC-ETH", btcTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * BTC_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = ETH_X_ASK_QTY < BTC_X_BID_QTY ? ETH_X_ASK_QTY : BTC_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = BTC_ETH_ASK_QTY / BTC_X_ASK;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_ETH_QUANTITY / ETH_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
            const qtyToSell: number = qtyToBuy;
            const ethQtyToBuy: number = (qtyToSell * BTC_X_BID) / BTC_ETH_ASK;

            // const btcQtyNeeded = btcQtyToConvert;
            // const xQtyNeeded = qtyToBuy;
            // const ethQtyNeeded = qtyToBuy * ETH_X_ASK;

            // if (btcQtyNeeded <= balances.get("BTC") ||
            //     ethQtyNeeded <= balances.get("ETH") ||
            //     xQtyNeeded <= balances.get(coin)) {
            //         console.log("INSUFICIENT BALANCES TO EXECUTE TRIANGULAR ARBITRAGE");
            //         return;
            // }

            // Generate quotes
            const buyQuote = new Quote(`ETH-${coin}`, ETH_X_ASK, qtyToBuy, OrderSide.BUY,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const sellQuote = new Quote(`BTC-${coin}`, BTC_X_BID, qtyToSell, OrderSide.SELL,
                                        OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
            const convertQuote = new Quote(`BTC-ETH`, BTC_ETH_BID, ethQtyToBuy, OrderSide.BUY,
                                            OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);

            const triangle = new TriangularArbitrage(coin, "BTC-ETH", ethTrianglePercentageProfit,
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * ETH_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
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

        let BTC_X_ORDERBOOK: OrderBook;
        let USDT_X_ORDERBOOK: OrderBook;
        let USDT_BTC_ORDERBOOK: OrderBook;

        try {
            // If one request throws an error, skip the coin and move on
            [BTC_X_ORDERBOOK, USDT_X_ORDERBOOK, USDT_BTC_ORDERBOOK] =
            await Promise.all([`BTC-${coin}`, `USDT-${coin}`, `USDT-BTC`]
                            .map((marketName) => this.getOrderBook(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [USDT-BTC]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        if (!BTC_X_ORDERBOOK.bids || !BTC_X_ORDERBOOK.asks ||
            !USDT_X_ORDERBOOK.bids || !USDT_X_ORDERBOOK.asks ||
            !USDT_BTC_ORDERBOOK.bids || !USDT_BTC_ORDERBOOK.asks) {
                // console.error("!!! CORRUPTED ORDERBOOK 1!!!");
                return;
        }

        if (!BTC_X_ORDERBOOK.bids[0] || !BTC_X_ORDERBOOK.asks[0] ||
            !USDT_X_ORDERBOOK.bids[0] || !USDT_X_ORDERBOOK.asks[0] ||
            !USDT_BTC_ORDERBOOK.bids[0] || !USDT_BTC_ORDERBOOK.asks[0]) {
                // console.error("!!! CORRUPTED ORDERBOOK 2!!!");
                return;
        }

        let BTC_X_BID = BTC_X_ORDERBOOK.bids[0].Rate;
        let BTC_X_ASK = BTC_X_ORDERBOOK.asks[0].Rate;
        let BTC_X_ASK_QTY = BTC_X_ORDERBOOK.asks[0].Quantity;
        let BTC_X_BID_QTY = BTC_X_ORDERBOOK.bids[0].Quantity;

        let USDT_X_BID = USDT_X_ORDERBOOK.bids[0].Rate;
        let USDT_X_ASK = USDT_X_ORDERBOOK.asks[0].Rate;
        let USDT_X_BID_QTY = USDT_X_ORDERBOOK.bids[0].Quantity;
        let USDT_X_ASK_QTY = USDT_X_ORDERBOOK.asks[0].Quantity;

        let USDT_BTC_BID = USDT_BTC_ORDERBOOK.bids[0].Rate;
        let USDT_BTC_ASK = USDT_BTC_ORDERBOOK.asks[0].Rate;
        let USDT_BTC_BID_QTY = USDT_BTC_ORDERBOOK.bids[0].Quantity;
        let USDT_BTC_ASK_QTY = USDT_BTC_ORDERBOOK.asks[0].Quantity;

        if ((BTC_X_ASK_QTY * BTC_X_ASK) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK) {
            BTC_X_ASK = BTC_X_ORDERBOOK.asks[1].Rate;
            BTC_X_ASK_QTY = BTC_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((BTC_X_BID_QTY * BTC_X_BID) < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_BID) {
            BTC_X_BID = BTC_X_ORDERBOOK.bids[1].Rate;
            BTC_X_BID_QTY = BTC_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((USDT_X_ASK_QTY * USDT_X_ASK) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK) {
            USDT_X_ASK = USDT_X_ORDERBOOK.asks[1].Rate;
            USDT_X_ASK_QTY = USDT_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((USDT_X_BID_QTY * USDT_X_BID) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_BID) {
            USDT_X_BID = USDT_X_ORDERBOOK.bids[1].Rate;
            USDT_X_BID_QTY = USDT_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((USDT_BTC_ASK_QTY * USDT_BTC_ASK) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_BTC_ASK) {
            USDT_BTC_ASK = USDT_BTC_ORDERBOOK.asks[1].Rate;
            USDT_BTC_ASK_QTY = USDT_BTC_ORDERBOOK.asks[1].Quantity;
        }
        if ((USDT_BTC_BID_QTY * USDT_BTC_BID) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_BTC_BID) {
            USDT_BTC_BID = USDT_BTC_ORDERBOOK.bids[1].Rate;
            USDT_BTC_BID_QTY = USDT_BTC_ORDERBOOK.bids[1].Quantity;
        }

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = BTC_X_ASK_QTY < USDT_X_BID_QTY ? BTC_X_ASK_QTY : USDT_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = USDT_BTC_ASK_QTY / USDT_X_ASK;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_BTC_QUANTITY / BTC_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_BTC_QUANTITY / BTC_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
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
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * BTC_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = USDT_X_ASK_QTY < BTC_X_BID_QTY ? USDT_X_ASK_QTY : BTC_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = USDT_BTC_BID_QTY / BTC_X_BID;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_USDT_QUANTITY / USDT_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
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
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * USDT_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
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

        let ETH_X_ORDERBOOK: OrderBook;
        let USDT_X_ORDERBOOK: OrderBook;
        let USDT_ETH_ORDERBOOK: OrderBook;

        try {
            // If one request throws an error, skip the coin and move on
            [ETH_X_ORDERBOOK, USDT_X_ORDERBOOK, USDT_ETH_ORDERBOOK] =
            await Promise.all([`ETH-${coin}`, `USDT-${coin}`, `USDT-ETH`]
                            .map((marketName) => this.getOrderBook(marketName)));

        } catch (ex) {
            // console.error(`ORDERBOOK RECEPTION ERROR, SKIPPING DETECTION ${coin} in [USDT-ETH]`);
            if (ex.message !== "URL request error") {
                console.error(ex);
            }
            return;
        }

        if (!ETH_X_ORDERBOOK.bids || !ETH_X_ORDERBOOK.asks ||
            !USDT_X_ORDERBOOK.bids || !USDT_X_ORDERBOOK.asks ||
            !USDT_ETH_ORDERBOOK.bids || !USDT_ETH_ORDERBOOK.asks) {
                // console.error("!!! CORRUPTED ORDERBOOK 1!!!");
                return;
        }

        if (!ETH_X_ORDERBOOK.bids[0] || !ETH_X_ORDERBOOK.asks[0] ||
            !USDT_X_ORDERBOOK.bids[0] || !USDT_X_ORDERBOOK.asks[0] ||
            !USDT_ETH_ORDERBOOK.bids[0] || !USDT_ETH_ORDERBOOK.asks[0]) {
                // console.error("!!! CORRUPTED ORDERBOOK 2!!!");
                return;
        }

        let ETH_X_BID = ETH_X_ORDERBOOK.bids[0].Rate;
        let ETH_X_ASK = ETH_X_ORDERBOOK.asks[0].Rate;
        let ETH_X_ASK_QTY = ETH_X_ORDERBOOK.asks[0].Quantity;
        let ETH_X_BID_QTY = ETH_X_ORDERBOOK.bids[0].Quantity;

        let USDT_X_BID = USDT_X_ORDERBOOK.bids[0].Rate;
        let USDT_X_ASK = USDT_X_ORDERBOOK.asks[0].Rate;
        let USDT_X_BID_QTY = USDT_X_ORDERBOOK.bids[0].Quantity;
        let USDT_X_ASK_QTY = USDT_X_ORDERBOOK.asks[0].Quantity;

        let USDT_ETH_BID = USDT_ETH_ORDERBOOK.bids[0].Rate;
        let USDT_ETH_ASK = USDT_ETH_ORDERBOOK.asks[0].Rate;
        let USDT_ETH_BID_QTY = USDT_ETH_ORDERBOOK.bids[0].Quantity;
        let USDT_ETH_ASK_QTY = USDT_ETH_ORDERBOOK.asks[0].Quantity;

        if ((ETH_X_ASK_QTY * ETH_X_ASK) < CONFIG.BITTREX.MIN_BTC_QUANTITY / ETH_X_ASK) {
            ETH_X_ASK = ETH_X_ORDERBOOK.asks[1].Rate;
            ETH_X_ASK_QTY = ETH_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((ETH_X_BID_QTY * ETH_X_BID) < CONFIG.BITTREX.MIN_BTC_QUANTITY / ETH_X_BID) {
            ETH_X_BID = ETH_X_ORDERBOOK.bids[1].Rate;
            ETH_X_BID_QTY = ETH_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((USDT_X_ASK_QTY * USDT_X_ASK) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK) {
            USDT_X_ASK = USDT_X_ORDERBOOK.asks[1].Rate;
            USDT_X_ASK_QTY = USDT_X_ORDERBOOK.asks[1].Quantity;
        }
        if ((USDT_X_BID_QTY * USDT_X_BID) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_BID) {
            USDT_X_BID = USDT_X_ORDERBOOK.bids[1].Rate;
            USDT_X_BID_QTY = USDT_X_ORDERBOOK.bids[1].Quantity;
        }
        if ((USDT_ETH_ASK_QTY * USDT_ETH_ASK) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_ETH_ASK) {
            USDT_ETH_ASK = USDT_ETH_ORDERBOOK.asks[1].Rate;
            USDT_ETH_ASK_QTY = USDT_ETH_ORDERBOOK.asks[1].Quantity;
        }
        if ((USDT_ETH_BID_QTY * USDT_ETH_BID) < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_ETH_BID) {
            USDT_ETH_BID = USDT_ETH_ORDERBOOK.bids[1].Rate;
            USDT_ETH_BID_QTY = USDT_ETH_ORDERBOOK.bids[1].Quantity;
        }

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = ETH_X_ASK_QTY < USDT_X_BID_QTY ? ETH_X_ASK_QTY : USDT_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = USDT_ETH_ASK_QTY / USDT_X_ASK;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_ETH_QUANTITY / ETH_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_ETH_QUANTITY / ETH_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
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
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * ETH_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);

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

            // Calculate X quantity to arbitrage
            let maxQtyToArbitrage: number = USDT_X_ASK_QTY < ETH_X_BID_QTY ? USDT_X_ASK_QTY : ETH_X_BID_QTY;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);
            const maxQtyToConvert: number = USDT_ETH_BID_QTY / ETH_X_BID;
            // console.log(`-MAX QTY TO CONVERT: ${maxQtyToConvert}`);
            maxQtyToArbitrage = maxQtyToConvert < maxQtyToArbitrage ? maxQtyToConvert : maxQtyToArbitrage;
            // console.log(`-MAX QTY TO ARBITRAGE: ${maxQtyToArbitrage}`);

            // if (maxQtyToArbitrage < CONFIG.BITTREX.MIN_USDT_QUANTITY / USDT_X_ASK) {
            //     return;
            // }

            let qtyToBuy: number = CONFIG.BITTREX.MAX_USDT_QUANTITY / USDT_X_ASK;
            // console.log(`-QTY TO BUY: ${qtyToBuy}`);
            if (qtyToBuy > maxQtyToArbitrage) {
                qtyToBuy = maxQtyToArbitrage;
            }
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
                                                    buyQuote, sellQuote, convertQuote, maxQtyToArbitrage * USDT_X_ASK);

            this.emit(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT, triangle);
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
            this.on(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT,
                    (triangularArbitrage: TriangularArbitrage) => {
                    console.log(`\n--- TRIANGULAR ARBITRAGE [${triangularArbitrage.buyQuote.marketName}] -> ` +
                                                            `[${triangularArbitrage.sellQuote.marketName}] -> ` +
                                                            `[${triangularArbitrage.convertQuote.marketName}] ---  \n` +
                                `GAP: ${triangularArbitrage.gapPercentage}% \nMAX QTY: ${triangularArbitrage.maxQtyToArbitrage} \n` +
                                `TRADE QTY: ${triangularArbitrage.buyQuote.quantity * triangularArbitrage.buyQuote.rate} \n`);
                    // TEST
                    // console.log(triangularArbitrage.buyQuote);
                    // console.log(triangularArbitrage.sellQuote);
                    // console.log(triangularArbitrage.convertQuote);
            });
        }
    }

}

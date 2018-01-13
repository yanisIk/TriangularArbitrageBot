import BittrexBroker from "../Brokers/BittrexBroker";
import IBroker, { OPEN_ORDER_EVENTS } from "../Brokers/IBroker";

import * as CONFIG from "../Config/CONFIG";

import BittrexOrderBookEventEmitter from "../MarketDataEventEmitters/BittrexOrderBookEventEmitter";
import BittrexTickEventEmitter from "../MarketDataEventEmitters/BittrexTickEventEmitter";
import IOrderBookEventEmitter from "../MarketDataEventEmitters/IOrderBookEventEmitter";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import BittrexAccountManager from "../Services/BittrexAccountManager";
import IAccountManager from "../Services/IAccountManager";

import OpenOrdersStatusDetector from "../MarketEventDetectors/OpenOrdersStatusDetector";
import TriangularArbitrageDetector from "../MarketEventDetectors/TriangularArbitrageDetector";
import TriangularArbitrageDetectorTick from "../MarketEventDetectors/TriangularArbitrageDetectorTick";
import UnfilleddOrdersDetector from "../MarketEventDetectors/UnfilledOrdersDetector";

import TriangularArbitrageHandler from "../MarketEventHandlers/TriangularArbitrageHandler";
import UnfilledOrderHandler from "../MarketEventHandlers/UnfilledOrderHandler";

import { OrderSide, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import Tick from "../Models/Tick";
import OrderLogger from "../Services/OrdersLogger";

export default class BittrexTriangularArbitrageBot {

    private accountManager: BittrexAccountManager;
    private broker: IBroker;

    private tickEmitter: ITickEventEmitter;
    private orderBookEmitter: IOrderBookEventEmitter;

    private openOrdersStatusDetector: OpenOrdersStatusDetector;
    private triangularArbitrageDetector: TriangularArbitrageDetector;
    private triangularArbitrageDetectorTick: TriangularArbitrageDetectorTick;
    private unfilledOrdersDetector: UnfilleddOrdersDetector;

    private triangularArbitrageHandler: TriangularArbitrageHandler;
    private unfilledOrderHandler: UnfilledOrderHandler;

    private orderLogger: OrderLogger;

    constructor(public readonly pivotMarket: string) {
        // console.log("CHECKING BALANCES...");
        // this.checkBalances();
        this.accountManager = new BittrexAccountManager();

        console.log("SETTING UP EVENTS PIPELINES...");
        this.setUpPipeline();
        console.log("EVENTS PIPELINES READY");
    }

    /**
     *
     */
    public setUpPipeline(): void {

        this.broker = new BittrexBroker();

        this.tickEmitter = new BittrexTickEventEmitter();
        this.orderBookEmitter = new BittrexOrderBookEventEmitter();

        this.openOrdersStatusDetector = new OpenOrdersStatusDetector(this.broker);
        this.triangularArbitrageDetector = new TriangularArbitrageDetector
            (this.broker, this.accountManager, this.openOrdersStatusDetector, this.tickEmitter, this.orderBookEmitter);
        // this.triangularArbitrageDetectorTick = new TriangularArbitrageDetectorTick
        //     (this.broker, this.accountManager, this.openOrdersStatusDetector, this.tickEmitter, this.orderBookEmitter);

        this.unfilledOrdersDetector = new UnfilleddOrdersDetector(this.broker, this.openOrdersStatusDetector);

        // this.triangularArbitrageHandler = new TriangularArbitrageHandler
        //                             (this.triangularArbitrageDetector, this.openOrdersStatusDetector, this.broker);
        // this.triangularArbitrageHandler = new TriangularArbitrageHandler
        //                             (this.triangularArbitrageDetectorTick, this.openOrdersStatusDetector, this.broker);
        // this.unfilledOrderHandler = new UnfilledOrderHandler
        //                     (this.unfilledOrdersDetector, this.openOrdersStatusDetector, this.broker, this.tickEmitter);

        // this.orderLogger = new OrderLogger(this.openOrdersStatusDetector);

    }

    public start() {

        console.log("STARTING !");

        // Loop through coins and detect triangular arbitrage
        let btc_eth_index = 0;
        let usdt_btc_index = 0;
        let usdt_eth_index = 0;

        setInterval(() => {

            if (btc_eth_index >= CONFIG.BITTREX.BTC_ETH_PIVOT_CURRENCIES.length) {
                btc_eth_index = 0;
            }
            if (usdt_btc_index >= CONFIG.BITTREX.USDT_BTC_PIVOT_CURRENCIES.length) {
                usdt_btc_index = 0;
            }
            if (usdt_eth_index >= CONFIG.BITTREX.USDT_ETH_PIVOT_CURRENCIES.length) {
                usdt_eth_index = 0;
            }

            // 3 triangles at a time max
            if (TriangularArbitrageHandler.currentlyOpenedTriangles.size >= 1) {
                return;
            }

            switch (this.pivotMarket) {
                case "BTC-ETH":
                    this.triangularArbitrageDetector.detect(CONFIG.BITTREX.BTC_ETH_PIVOT_CURRENCIES[btc_eth_index], this.pivotMarket);
                    break;
                case "USDT-BTC":
                    this.triangularArbitrageDetector.detect(CONFIG.BITTREX.USDT_BTC_PIVOT_CURRENCIES[usdt_btc_index], this.pivotMarket);
                    break;
                case "USDT-ETH":
                    this.triangularArbitrageDetector.detect(CONFIG.BITTREX.USDT_ETH_PIVOT_CURRENCIES[usdt_eth_index], this.pivotMarket);
                    break;
            }

            btc_eth_index++;
            usdt_btc_index++;
            usdt_eth_index++;

        }, 500);
    }

    /**
     * TODO
     * Checks if balance is as following:
     *  1x PIVOT MARKET
     *  1x EACH PIVOT COIN
     */
    // private async checkBalances() {
    //     const balances: Map<string, number> = await this.accountManager.getBalances();
    //     const pivotCoins: string[] = CONFIG.BITTREX.BTC_ETH_PIVOT_CURRENCIES;
    //     let baseCoin: string;
    //     let convertCoin: string;
    //     [baseCoin, convertCoin] = CONFIG.BITTREX.PIVOT_MARKET.split("-");

    //     const baseCoinQty = balances.get(baseCoin);
    //     const convertCoinQty = balances.get(convertCoin);

    // }
}

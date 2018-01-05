import BittrexBroker from "../Brokers/BittrexBroker";
import IBroker, { OPEN_ORDER_EVENTS } from "../Brokers/IBroker";

import * as CONFIG from "../Config/CONFIG";

import BittrexTickEventEmitter from "../MarketDataEventEmitters/BittrexTickEventEmitter";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";

import OpenOrdersStatusDetector from "../MarketEventDetectors/OpenOrdersStatusDetector";

import BuyFilledEventHandler from "../MarketEventHandlers/BuyFilledEventHandler";
import SellFilledEventHandler from "../MarketEventHandlers/SellFilledEventHandler";
import { OrderSide, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import Tick from "../Models/Tick";
import OrderLogger from "../Services/OrdersLogger";

export default class BittrexTriangularArbitrageBot {

    private broker: IBroker;

    private tickEmitter: ITickEventEmitter;

    private openOrdersStatusDetector: OpenOrdersStatusDetector;

    private buyFilledHandler: BuyFilledEventHandler;
    private sellFilledHandler: SellFilledEventHandler;

    private orderLogger: OrderLogger;

    constructor(public readonly marketName: string) {
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
        this.tickEmitter.subscribe(this.marketName);

        this.openOrdersStatusDetector = new OpenOrdersStatusDetector(this.broker,
                                        CONFIG.BITTREX.ORDER_WATCH_INTERVAL_IN_MS);

        this.buyFilledHandler = new BuyFilledEventHandler(this.openOrdersStatusDetector, this.outAskManager);
        this.sellFilledHandler = new SellFilledEventHandler(this.openOrdersStatusDetector, this.outBidManager);

        // this.orderLogger = new OrderLogger(this.openOrdersStatusDetector);

    }

    public start(): void {

        console.log("STARTING !");

        // Loop through coins

        // Send event to arbitrage detector

    }
}

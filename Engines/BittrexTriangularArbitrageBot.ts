import BittrexBroker from "../Brokers/BittrexBroker";
import IBroker, { OPEN_ORDER_EVENTS } from "../Brokers/IBroker";

import * as CONFIG from "../Config/CONFIG";

import BittrexTickEventEmitter from "../MarketDataEventEmitters/BittrexTickEventEmitter";
import BittrexOrderBookEventEmitter from "../MarketDataEventEmitters/BittrexOrderBookEventEmitter";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import IOrderBookEventEmitter from "./../MarketDataEventEmitters/IOrderBookEventEmitter";

import OpenOrdersStatusDetector from "../MarketEventDetectors/OpenOrdersStatusDetector";

import { OrderSide, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import Tick from "../Models/Tick";
import OrderLogger from "../Services/OrdersLogger";
import TriangularArbitrageDetector from "../MarketEventDetectors/TriangularArbitrageDetector";
import UnfilleddOrdersDetector from "../MarketEventDetectors/UnfilledOrdersDetector";
import TriangularArbitrageHandler from "../MarketEventHandlers/TriangularArbitrageHandler";
import UnfilledOrderHandler from "../MarketEventHandlers/UnfilledOrderHandler";



export default class BittrexTriangularArbitrageBot {

    private broker: IBroker;

    private tickEmitter: ITickEventEmitter;
    private orderBookEmitter: IOrderBookEventEmitter;

    private openOrdersStatusDetector: OpenOrdersStatusDetector;
    private triangularArbitrageDetector: TriangularArbitrageDetector;
    private unfilledOrdersDetector: UnfilleddOrdersDetector;

    private triangularArbitrageHandler: TriangularArbitrageHandler;
    private unfilledOrderHandler: UnfilledOrderHandler;


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
        this.orderBookEmitter = new BittrexOrderBookEventEmitter();

        this.openOrdersStatusDetector = new OpenOrdersStatusDetector(this.broker);
        this.triangularArbitrageDetector = new TriangularArbitrageDetector(this.broker, this.openOrdersStatusDetector, this.tickEmitter, this.orderBookEmitter);
        this.unfilledOrdersDetector = new UnfilleddOrdersDetector(this.broker, this.openOrdersStatusDetector);

        this.triangularArbitrageHandler = new TriangularArbitrageHandler(this.triangularArbitrageDetector, this.openOrdersStatusDetector, this.broker);
        this.unfilledOrderHandler = new UnfilledOrderHandler(this.unfilledOrdersDetector, this.openOrdersStatusDetector, this.broker, this.tickEmitter);

        // this.orderLogger = new OrderLogger(this.openOrdersStatusDetector);

    }

    public start(): void {

        console.log("STARTING !");

        // Loop through coins
        let i = 0;
        setInterval(() => {
            // emit
            if (i >= CONFIG.BITTREX.PIVOT_CURRENCIES.length) {
                i = 0;
            } 
            this.triangularArbitrageDetector.detect(CONFIG.BITTREX.PIVOT_CURRENCIES[i]);
            i++;
        }, 1000)

        // Send event to arbitrage detector

    }
}

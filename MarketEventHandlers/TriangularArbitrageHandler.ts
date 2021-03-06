import * as CONFIG from "../Config/CONFIG";

import { EventEmitter } from "events";
import IBroker from "../Brokers/IBroker";
import OpenOrdersStatusDetector, { UPDATE_ORDER_STATUS_EVENTS } from "../MarketEventDetectors/OpenOrdersStatusDetector";
import TriangularArbitrageDetector from "../MarketEventDetectors/TriangularArbitrageDetector";
import TriangularArbitrageDetectorTick from "../MarketEventDetectors/TriangularArbitrageDetectorTick";
import Order, { OrderSide, OrderStatus, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import TriangularArbitrage from "../Models/TriangularArbitrage";

export default class TriangularArbitrageHandler extends EventEmitter {

    // key: triangle, value: TriangularArbitrage
    public static readonly currentlyOpenedTriangles: Map<string, TriangularArbitrage> = new Map();

    public static readonly OPEN_TRIANGLE_EVENT: string = "OPENED_TRIANGLE";
    public static readonly CLOSE_TRIANGLE_EVENT: string = "CLOSED_TRIANGLE";

    constructor(private triangularTriangularArbitrageDetector: TriangularArbitrageDetector | TriangularArbitrageDetectorTick,
                private openOrdersStatusDetector: OpenOrdersStatusDetector,
                private broker: IBroker) {
        super();
        this.startMonitoring();
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.logEvents();
        }
    }

    private startMonitoring(): void {
        this.triangularTriangularArbitrageDetector.on(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT,
            (triangularArbitrage: TriangularArbitrage) => this.handleTriangularArbitrage(triangularArbitrage));
    }

    /**
     * Hybrid diachronic strategy:
     * BUY AND CONVERT SIMULTANEOUSLY
     * SELL AFTER BUY
     * @param triangularArbitrage
     */
    private async handleTriangularArbitrage(triangularArbitrage: TriangularArbitrage) {

        if (TriangularArbitrageHandler.currentlyOpenedTriangles.has(triangularArbitrage.triangle)) {
            return;
        }

        TriangularArbitrageHandler.currentlyOpenedTriangles.set(triangularArbitrage.triangle, triangularArbitrage);

        // Send buy and convert orders
        const buyOrderPromise = this.broker.buy(triangularArbitrage.buyQuote);
        const convertOrderPromise = triangularArbitrage.convertQuote.side === OrderSide.BUY ?
            this.broker.buy(triangularArbitrage.convertQuote) : this.broker.sell(triangularArbitrage.convertQuote);

        // buy and convert order
        let buyOrder: Order;
        let convertOrder: Order;

        // BUY and CONVERT AT THE SAME TIME
        [buyOrder, convertOrder] = await Promise.all
                                            ([buyOrderPromise, convertOrderPromise]);

        // watch orders
        const filledBuyOrderPromise: Promise<Order> = this.getFilledOrderPromise(buyOrder.id);
        const filledConverPromisetOrderPromise: Promise<Order> = this.getFilledOrderPromise(convertOrder.id);

        // TODO Listen to partial fills
        // const partialFillsListener = (partialFill: Order) => {
        //     const sellQuote: Quote = triangularArbitrage.sellQuote;
        //     sellQuote.quantity = partialFill.partialFill;
        //     this.broker.sell(sellQuote);
        // };

        // this.openOrdersStatusDetector.PARTIALLY_FILLED_BUY_ORDER_EVENT_EMITTER.on(buyOrder.id, partialFillsListener);

        // When buyFilled, Sell
        const filledBuyOrder: Order = await filledBuyOrderPromise;
        // TODO
        // this.openOrdersStatusDetector.PARTIALLY_FILLED_BUY_ORDER_EVENT_EMITTER
        //                              .removeListener(buyOrder.id, partialFillsListener);
        const sellOrder: Order = await this.broker.sell(triangularArbitrage.sellQuote);

        // Watch Sell order
        const filledSellOrderPromise: Promise<Order> = this.getFilledOrderPromise(sellOrder.id);

        // Update triangle
        triangularArbitrage.open(buyOrder, sellOrder, convertOrder);
        TriangularArbitrageHandler.currentlyOpenedTriangles.set(triangularArbitrage.triangle, triangularArbitrage);

        this.emit(TriangularArbitrageHandler.OPEN_TRIANGLE_EVENT, triangularArbitrage);

        let filledSellOrder: Order;
        let filledConvertOrder: Order;

        // TODO sometimes doesnt resolve if already resolved
        const AllFilledOrdersPromise = Promise.all([
                                                    filledSellOrderPromise,
                                                    filledConverPromisetOrderPromise,
                                                ]);
        // TODO: SWITCH ORDERS WHEN NEW ORDER TO REPLACE UNFILLED
        // let cleanListeners: () => void;
        // const buyOrderListener = (newBuyOrder: Order) => {
        //     triangularArbitrage.buyOrder = newBuyOrder;
        // }
        // const sellOrderListener = (newSellOrder: Order) => {
        //     triangularArbitrage.sellOrder = newSellOrder;
        // }
        // const convertOrderListener = (newConvertOrder: Order) => {
        //     triangularArbitrage.convertOrder = newConvertOrder;
        // }

        // this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.once(buyOrder.id, buyOrderListener);
        // this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.once(sellOrder.id, sellOrderListener);
        // this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.once(convertOrder.id, convertOrderListener);

        // cleanListeners = () => {
        //     this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.removeListener(buyOrder.id, buyOrderListener);
        //     this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.removeListener(sellOrder.id, sellOrderListener);
        //     this.unfilledOrderHandler.REPLACE_ORDER_EVENTS.removeListener(convertOrder.id, convertOrderListener);
        // }

        // TODO Doesnt resolve sometimes
        [filledSellOrder, filledConvertOrder] = await AllFilledOrdersPromise;

        triangularArbitrage.close(filledBuyOrder, filledSellOrder, filledConvertOrder);

        // TODO: UNCOMMENT AFTER TEST
        TriangularArbitrageHandler.currentlyOpenedTriangles.delete(triangularArbitrage.triangle);
        this.emit(TriangularArbitrageHandler.CLOSE_TRIANGLE_EVENT, triangularArbitrage);
    }

    private getFilledOrderPromise(orderId: string): Promise<Order> {
        return new Promise((resolve, reject) => {
            this.openOrdersStatusDetector.FILLED_ORDER_EVENT_EMITTER.once(orderId, (order: Order) => resolve(order));
        });
    }

    private logEvents(): void {
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.on(TriangularArbitrageHandler.OPEN_TRIANGLE_EVENT,
                    (triangularArbitrage: TriangularArbitrage) => {
                    console.log(`\n-o-o--o-o- OPENED TRIANGULAR ARBITRAGE [${triangularArbitrage.buyQuote.marketName}] -> ` +
                                                            `[${triangularArbitrage.sellQuote.marketName}] -> ` +
                                                            `[${triangularArbitrage.convertQuote.marketName}] -o-o--o-o-  \n` +
                                `GAP: ${triangularArbitrage.gapPercentage.toFixed(4)}% \n` +
                                `QUANTITY: ${(triangularArbitrage.buyQuote.quantity * triangularArbitrage.buyQuote.rate).toFixed(6)} -> ` +
                                           `${(triangularArbitrage.convertQuote.quantity * triangularArbitrage.convertQuote.rate).toFixed(6)}\n`);
            });

            this.on(TriangularArbitrageHandler.CLOSE_TRIANGLE_EVENT,
                (triangularArbitrage: TriangularArbitrage) => {
                console.log(`\n-o-o--o-o- CLOSED TRIANGULAR ARBITRAGE [${triangularArbitrage.buyQuote.marketName}] -> ` +
                                                        `[${triangularArbitrage.sellQuote.marketName}] -> ` +
                                                        `[${triangularArbitrage.convertQuote.marketName}] -o-o--o-o-  \n` +
                            `GAP: ${triangularArbitrage.gapPercentage.toFixed(4)}% \n` +
                            `QUANTITY: ${(triangularArbitrage.buyOrder.quantity * triangularArbitrage.buyOrder.rate).toFixed(6)} -> ` +
                                       `${(triangularArbitrage.convertOrder.quantity * triangularArbitrage.convertOrder.rate).toFixed(6)}\n`);
            });
        }
    }

}

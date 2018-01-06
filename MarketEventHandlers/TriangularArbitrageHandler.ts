declare const CONFIG: any;
import IBroker from "../Brokers/IBroker";
import OpenOrdersStatusDetector, { UPDATE_ORDER_STATUS_EVENTS } from "../MarketEventDetectors/OpenOrdersStatusDetector";
import Order, { OrderSide, OrderStatus, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import TriangularArbitrageDetector from "../MarketEventDetectors/TriangularArbitrageDetector";
import TriangularArbitrage from "../Models/TriangularArbitrage";
import { EventEmitter } from "events";

/**
 * - Subscribe to sell filled events
 * - check if filled
 * - outbid with quantity sold
 * - ! WAIT FOR COMPLETELY FILLED TO RE OUTBID, OTHERWISE I WILL OUTBID MYSELF WITH MY PARTIAL SELL FILLS !
 */

export default class TriangularArbitrageHandler extends EventEmitter {

    public readonly currentlyOpenedTriangles: Map<string, TriangularArbitrage> = new Map();

    constructor(private triangularTriangularArbitrageDetector: TriangularArbitrageDetector,
                private openOrdersStatusDetector: OpenOrdersStatusDetector,
                private broker: IBroker) {
        super();
        this.startMonitoring();
    }

    private startMonitoring(): void {
        this.triangularTriangularArbitrageDetector.on(TriangularArbitrageDetector.ARBITRAGE_OPPORTUNITY_EVENT,
            (triangularArbitrage: TriangularArbitrage) => this.handleTriangularArbitrage(triangularArbitrage));
    }

    private async handleTriangularArbitrage(triangularArbitrage: TriangularArbitrage) {

        if (this.currentlyOpenedTriangles.has(triangularArbitrage.triangle)) {
            return;
        }

        // Send orders
        const buyOrderPromise = this.broker.buy(triangularArbitrage.buyQuote);
        const sellOrderPromise = this.broker.sell(triangularArbitrage.sellQuote);
        const convertOrderPromise = triangularArbitrage.convertQuote.side === OrderSide.BUY ? 
            this.broker.buy(triangularArbitrage.convertQuote) : this.broker.sell(triangularArbitrage.convertQuote);
        
        // Update triangle
        let buyOrder: Order, sellOrder: Order, convertOrder: Order;
        [buyOrder, sellOrder, convertOrder] = await Promise.all([buyOrderPromise, sellOrderPromise, convertOrderPromise]);
        triangularArbitrage.open(buyOrder, sellOrder, convertOrder);

        this.currentlyOpenedTriangles.set(triangularArbitrage.triangle, triangularArbitrage);

        // watch orders
        let filledBuyOrderPromise: Promise<Order>, filledSellOrderPromise: Promise<Order>, filledConverPromisetOrderPromise: Promise<Order>;
        let filledBuyOrder: Order, filledSellOrder: Order, filledConvertOrder: Order;
        const AllFilledOrdersPromise = Promise.all([
                                                    this.getFilledOrderPromise(buyOrder.id),
                                                    this.getFilledOrderPromise(sellOrder.id),
                                                    this.getFilledOrderPromise(convertOrder.id)
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
        
        [filledBuyOrder, filledSellOrder, filledConvertOrder] = await AllFilledOrdersPromise;
        
        triangularArbitrage.close(filledBuyOrder, filledSellOrder, filledConvertOrder);
        
        this.currentlyOpenedTriangles.delete(triangularArbitrage.triangle);

    }

    private getFilledOrderPromise(orderId: string): Promise<Order> {
        return new Promise((resolve, reject) => {
            this.openOrdersStatusDetector.FILLED_ORDER_EVENT_EMITTER.once(orderId, (order: Order) => resolve(order));
        });
    }

}

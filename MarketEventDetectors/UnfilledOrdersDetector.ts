import { EventEmitter } from "events";
import IBroker, { OPEN_ORDER_EVENTS } from "./../Brokers/IBroker";
import * as CONFIG from "./../Config/CONFIG";
import Order, { OrderSide, OrderStatus } from "./../Models/Order";
import OpenOrdersStatusDetector from "../MarketEventDetectors/OpenOrdersStatusDetector";

/**
 * Subscribe to open orders
 * Watch order every X ms
 * If canceled: Emit to "CANCELED_ORDER"
 * If filled: Emit to "FILLED_ORDER"
 */
export default class UnfilleddOrdersDetector extends EventEmitter {

    public static readonly UNFILLED_ORDER_EVENT: string = "UNSOLD_ORDER";

    private readonly lastPartialOrders: Map<string, Order> = new Map();

    constructor(private broker: IBroker,
                private openOrdersStatusDetector: OpenOrdersStatusDetector) {
        super();
        this.startWatch();
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            this.logEvents();
        }
    }

    /**
     * Starts watching open orders
     * For each open order, check it every ${watchIntervalInMs}
     */
    private startWatch(): void {

        this.broker.on(OPEN_ORDER_EVENTS.OPEN_BUY_ORDER_EVENT, (order: Order) => this.handleOpenOrder(order));
        this.broker.on(OPEN_ORDER_EVENTS.OPEN_SELL_ORDER_EVENT, (order: Order) => this.handleOpenOrder(order));

    }

    private handleOpenOrder(order: Order): void {

        const orderTimeoutId = setTimeout(() => this.emit(UnfilleddOrdersDetector.UNFILLED_ORDER_EVENT, order),
                                                            CONFIG.BITTREX.UNFILLED_ORDERS_TIMEOUT);
        let cleanListeners: () => void;
        
        const cancelListener = (updatedOrder: Order) => {
            cleanListeners();
            clearTimeout(orderTimeoutId);
        }
        const partialFillListener = (updatedOrder: Order) => {
            order = updatedOrder;
        }
        const fillListener = (updatedOrder: Order) => {
            cleanListeners();
            clearTimeout(orderTimeoutId);            
        }

        this.openOrdersStatusDetector.PARTIALLY_FILLED_ORDER_EVENT_EMITTER.on(order.id, partialFillListener);
        this.openOrdersStatusDetector.CANCELED_ORDER_EVENT_EMITTER.once(order.id, cancelListener);
        this.openOrdersStatusDetector.FILLED_ORDER_EVENT_EMITTER.once(order.id, fillListener);

        cleanListeners = () => {
            this.openOrdersStatusDetector.PARTIALLY_FILLED_ORDER_EVENT_EMITTER.removeListener(order.id, partialFillListener);
            this.openOrdersStatusDetector.CANCELED_ORDER_EVENT_EMITTER.removeListener(order.id, cancelListener);
            this.openOrdersStatusDetector.FILLED_ORDER_EVENT_EMITTER.removeListener(order.id, fillListener);
        }

    }

    private logEvents(): void {
        if (CONFIG.GLOBAL.IS_LOG_ACTIVE) {
            
            this.on(UnfilleddOrdersDetector.UNFILLED_ORDER_EVENT, (order: Order) => {
                console.log(`\n--- UNFILLED ORDER [${order.marketName}] --- \nOrderID: ${order.id}\n` +
                            `Remaining Quantity:${order.quantityRemaining} Rate:${order.rate}\n`);
            });
            
        }
    }

}


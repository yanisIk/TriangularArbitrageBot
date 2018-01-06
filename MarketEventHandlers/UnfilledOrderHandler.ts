import IBroker from "../Brokers/IBroker";
import ITickEventEmitter from "../MarketDataEventEmitters/ITickEventEmitter";
import OpenOrdersStatusDetector, { UPDATE_ORDER_STATUS_EVENTS } from "../MarketEventDetectors/OpenOrdersStatusDetector";
import Order, { OrderSide, OrderTimeEffect, OrderType } from "../Models/Order";
import Quote from "../Models/Quote";
import Tick from "../Models/Tick";
import UnfilleddOrdersDetector from "../MarketEventDetectors/UnfilledOrdersDetector";
import { EventEmitter } from "events";

/**
 * 
 */

export default class UnfilledOrderHandler {

    // key: old canceled orderId, value: new Order to replace it 
    public readonly REPLACE_ORDER_EVENTS: EventEmitter = new EventEmitter();

    constructor(private unfilledOrderDetector: UnfilleddOrdersDetector,
                private openOrdersStatusDetector: OpenOrdersStatusDetector,
                private broker: IBroker,
                private ticksEmitter: ITickEventEmitter) {
        this.startMonitoring();
    }

    private startMonitoring(): void {
        this.unfilledOrderDetector.on(UnfilleddOrdersDetector.UNFILLED_ORDER_EVENT, async (order: Order) => {
            
            let canceledOrder: Order, newOrder: Order; 
            try {
                await this.broker.cancelOrder(order.id);
                canceledOrder = order;

                // Rebuy only when it's really canceled
                this.openOrdersStatusDetector.CANCELED_BUY_ORDER_EVENT_EMITTER.once(order.id, async () => {
                    const tick: Tick = await this.ticksEmitter.getTicker(order.marketName);
                    // Reorder at current bid/ask
                    if (order.side === OrderSide.BUY) {
                        const buyQuote = new Quote(order.marketName, tick.ask, order.quantity,
                                                    OrderSide.BUY, OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
                        const newOrder = await this.broker.buy(buyQuote);
                        this.REPLACE_ORDER_EVENTS.emit(order.id, newOrder);
                        
                    } else {
                        const sellQuote = new Quote(order.marketName, tick.bid, order.quantity,
                            OrderSide.SELL, OrderType.LIMIT, OrderTimeEffect.GOOD_UNTIL_CANCELED);
                        const newOrder = await this.broker.sell(sellQuote);
                        this.REPLACE_ORDER_EVENTS.emit(order.id, newOrder);
                    }
                });
                
            } catch (err) {
                if ((err === "ORDER_ALREADY_CLOSED") || (err.message === "ORDER_ALREADY_CLOSED")) {
                    console.log(`!!! [${order.marketName}] ORDER ALREADY CLOSED (Probably Filled ?) =>` +
                                ` NO RE OUTBID !!! \nORDERID: ${order.id}`);
                } else {
                    console.log("!!! CANCEL FAILED IN OUTBIDEVENTHANDLER, NO RE OUTBID !!!\nORDERID:", order.id);
                }
            }
            
        });
    }
}

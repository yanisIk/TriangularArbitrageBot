import { EventEmitter } from "events";
import Order from "./../Models/Order";
import OrderBook from "./../Models/OrderBook";

/**
 * order book stream for a market
 * Emits OrderBook
 */
export default interface IOrderBookEventEmitter extends EventEmitter {
    /**
     * Subscribe to orders and emit them
     * Implementation is dependent on the exchanger adapter
     */
    subscribe(marketName: string): void;
    /**
     * Stops watching orders
     * Implementation is dependent on the exchanger adapter
     */
    unsubscribe(marketName: string): void;

    getOrderBook(marketName: string): Promise<OrderBook>;
}

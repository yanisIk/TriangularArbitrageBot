import * as Bluebird from "bluebird";
import { EventEmitter } from "events";
import { setInterval } from "timers";
import Order from "../Models/Order";
import OrderBook from "../Models/OrderBook";
import * as CONFIG from "./../Config/CONFIG";
import IOrderBookEventEmitter from "./IOrderBookEventEmitter";

const bittrexClient = require("node-bittrex-api");
const bittrex = Bluebird.promisifyAll(bittrexClient);
bittrex.options({
    apikey : process.env.BITTREX_API_KEY,
    apisecret : process.env.BITTREX_API_SECRET,
    verbose : CONFIG.GLOBAL.VERBOSE_CLIENT,
    inverse_callback_arguments : true,
});

export default class BittrexOrderBookEventEmitter extends EventEmitter implements IOrderBookEventEmitter {

    public readonly orderBooks: Map<string, OrderBook> = new Map();
    // Contains the setInterval ids for polling
    // Key: marketName, Value: intervalId
    private readonly pollingIntervalIds: Map<string, any> = new Map();

    constructor() {
        super();
    }

    /**
     * Polling strategy with CONFIG.BITTREX_ORDERBOOK_POLL_INTERVAL_IN_MS
     * @param marketName
     */
    public subscribe(marketName: string) {
        const intervalId = setInterval(async () => {
            const orderBook: OrderBook = await this.getOrderBook(marketName);
            if (orderBook) {
                this.emit(marketName, orderBook);
            }
        }, CONFIG.BITTREX.ORDERBOOK_POLL_INTERVAL_IN_MS);
        this.pollingIntervalIds.set(marketName, intervalId);
    }

    public unsubscribe(marketName: string) {
        clearInterval(this.pollingIntervalIds.get(marketName));
    }

    public async getOrderBook(marketName: string): Promise<OrderBook> {
        const orderBook = await bittrex.getorderbookAsync({market: marketName, type: "both"});
        if (!orderBook.success) {
            throw new Error(orderBook.message);
        }
        if (!orderBook.result) {
            throw new Error(orderBook.message);
        }
        return new OrderBook(marketName, orderBook.result.buy, orderBook.result.sell);
    }

}
